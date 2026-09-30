-- ==============================================================================
-- MEEHOA TIME V1 - Migration 0003: Comprehensive Enterprise Extensions
-- Adds employee_code, wage history, settings rules, payroll snapshots, RPCs
-- ==============================================================================

-- 1. Extend enums if needed
do $$ begin
  alter type public.exception_type add value if not exists 'low_gps_accuracy';
  alter type public.exception_type add value if not exists 'duplicate_attendance';
exception when others then null;
end $$;

-- 2. Extend profiles table
alter table public.profiles
  add column if not exists employee_code text,
  add column if not exists email text,
  add column if not exists location_id uuid references public.locations(id) on delete set null,
  add column if not exists effective_date date not null default current_date,
  add column if not exists avatar_url text;

create unique index if not exists profiles_org_employee_code_idx
  on public.profiles(organization_id, employee_code)
  where employee_code is not null;

-- 3. Wage History table (tracks employee wage changes over time)
create table if not exists public.wage_histories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  payroll_type public.payroll_type not null default 'hourly',
  hourly_rate numeric(14,2) not null default 0,
  monthly_salary numeric(14,2) not null default 0,
  effective_date date not null default current_date,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists wage_histories_emp_idx
  on public.wage_histories(employee_id, effective_date desc);

-- 4. Extend settings table
alter table public.settings
  add column if not exists standard_monthly_days integer not null default 26 check(standard_monthly_days between 1 and 31),
  add column if not exists standard_daily_hours integer not null default 8 check(standard_daily_hours between 1 and 24),
  add column if not exists rounding_minutes integer not null default 0 check(rounding_minutes in (0, 5, 10, 15, 30)),
  add column if not exists max_gps_accuracy_meters integer not null default 150 check(max_gps_accuracy_meters between 10 and 1000),
  add column if not exists prorate_monthly_salary boolean not null default true;

-- 5. Extend attendance_events table
alter table public.attendance_events
  add column if not exists client_occurred_at timestamptz,
  add column if not exists user_agent text,
  add column if not exists exception_note text;

-- 6. Extend payroll_lines table with snapshot & lock columns
alter table public.payroll_lines
  add column if not exists snapshot_payroll_type public.payroll_type,
  add column if not exists snapshot_rate numeric(14,2),
  add column if not exists snapshot_rules jsonb default '{}'::jsonb,
  add column if not exists is_locked boolean not null default false,
  add column if not exists locked_at timestamptz;

-- 7. Enable RLS on wage_histories
alter table public.wage_histories enable row level security;

create policy wage_histories_read on public.wage_histories
  for select using (organization_id = public.current_org() and (employee_id = auth.uid() or public.is_manager()));

create policy wage_histories_manage on public.wage_histories
  for all using (organization_id = public.current_org() and public.is_manager())
  with check (organization_id = public.current_org() and public.is_manager());

-- 8. Enhanced Attendance Capture RPC
create or replace function public.capture_attendance(
  p_shift_id uuid,
  p_event public.event_type,
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision,
  p_idempotency_key text,
  p_client_time timestamptz default null,
  p_user_agent text default null,
  p_note text default null
)
returns public.attendance_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift record;
  v_location record;
  v_settings record;
  v_distance double precision;
  v_event record;
  v_within_geofence boolean := true;
  v_diff_minutes integer;
begin
  -- Idempotency check: return existing punch if same key
  if exists (select 1 from public.attendance_events a where a.idempotency_key = p_idempotency_key) then
    select * into v_event from public.attendance_events a where a.idempotency_key = p_idempotency_key limit 1;
    return v_event;
  end if;

  -- Verify shift belongs to authenticated user
  select * into v_shift from public.shifts where id = p_shift_id and employee_id = auth.uid();
  if not found then
    raise exception 'SHIFT_NOT_FOUND_OR_ACCESS_DENIED';
  end if;

  -- Load organization settings
  select * into v_settings from public.settings where organization_id = v_shift.organization_id;

  -- Calculate distance to shop
  select * into v_location from public.locations where id = v_shift.location_id;
  if found and p_lat is not null and p_lng is not null then
    v_distance := 6371000 * 2 * asin(
      sqrt(
        power(sin(radians(p_lat - v_location.latitude) / 2), 2) +
        cos(radians(v_location.latitude)) * cos(radians(p_lat)) *
        power(sin(radians(p_lng - v_location.longitude) / 2), 2)
      )
    );
    v_within_geofence := (v_distance <= coalesce(v_location.radius_meters, 120));
  end if;

  -- Record raw attendance punch (Append-only, immutable)
  insert into public.attendance_events(
    organization_id, employee_id, shift_id, event,
    occurred_at, client_occurred_at, latitude, longitude,
    accuracy_meters, distance_meters, within_geofence,
    device_id, idempotency_key, user_agent, exception_note
  )
  values (
    v_shift.organization_id, auth.uid(), p_shift_id, p_event,
    now(), p_client_time, p_lat, p_lng,
    p_accuracy, v_distance, v_within_geofence,
    null, p_idempotency_key, p_user_agent, p_note
  )
  returning * into v_event;

  -- Automatic exception detections
  -- A. Outside geofence
  if not v_within_geofence and coalesce(v_settings.require_geofence, true) then
    insert into public.attendance_exceptions (
      organization_id, employee_id, shift_id, kind, status, minutes
    )
    values (v_shift.organization_id, auth.uid(), p_shift_id, 'outside_geofence', 'open', null)
    on conflict (shift_id, kind) do nothing;
  end if;

  -- B. Check-in lateness detection
  if p_event = 'check_in' then
    v_diff_minutes := extract(epoch from (now() - v_shift.starts_at)) / 60;
    if v_diff_minutes > coalesce(v_settings.grace_minutes, 5) then
      insert into public.attendance_exceptions (
        organization_id, employee_id, shift_id, kind, status, minutes
      )
      values (v_shift.organization_id, auth.uid(), p_shift_id, 'late', 'open', v_diff_minutes)
      on conflict (shift_id, kind) do nothing;
    end if;

    update public.shifts
      set status = 'in_progress', updated_at = now()
      where id = p_shift_id;
  end if;

  -- C. Check-out early leave / unapproved OT detection
  if p_event = 'check_out' then
    v_diff_minutes := extract(epoch from (v_shift.ends_at - now())) / 60;
    if v_diff_minutes > coalesce(v_settings.grace_minutes, 5) then
      insert into public.attendance_exceptions (
        organization_id, employee_id, shift_id, kind, status, minutes
      )
      values (v_shift.organization_id, auth.uid(), p_shift_id, 'early_leave', 'open', v_diff_minutes)
      on conflict (shift_id, kind) do nothing;
    end if;

    update public.shifts
      set status = 'completed', updated_at = now()
      where id = p_shift_id;
  end if;

  -- Write immutable audit log
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, after_data)
  values (
    v_shift.organization_id, auth.uid(), p_event::text,
    'attendance_event', v_event.id::text, to_jsonb(v_event)
  );

  return v_event;
end;
$$;

grant execute on function public.capture_attendance(
  uuid, public.event_type, double precision, double precision, double precision, text, timestamptz, text, text
) to authenticated;

-- 9. RPC to review an explanation and adjust shift without touching raw attendance
create or replace function public.review_explanation(
  p_explanation_id uuid,
  p_decision text, -- 'approved' or 'rejected'
  p_payable_start timestamptz default null,
  p_payable_end timestamptz default null,
  p_review_note text default null
)
returns public.explanations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_explanation record;
  v_exception record;
  v_shift record;
  v_result record;
begin
  if not public.is_manager() then
    raise exception 'PERMISSION_DENIED_NOT_MANAGER';
  end if;

  select * into v_explanation from public.explanations
  where id = p_explanation_id and organization_id = public.current_org();
  if not found then
    raise exception 'EXPLANATION_NOT_FOUND';
  end if;

  select * into v_exception from public.attendance_exceptions
  where id = v_explanation.exception_id and organization_id = public.current_org();

  -- Update explanation record
  update public.explanations
  set status = p_decision::public.approval_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = p_review_note
  where id = p_explanation_id
  returning * into v_result;

  -- Update exception record
  update public.attendance_exceptions
  set status = p_decision::public.approval_status,
      resolved_at = now()
  where id = v_explanation.exception_id;

  -- If approved, update shift payable boundaries and regular minutes
  if p_decision = 'approved' and v_exception.shift_id is not null then
    select * into v_shift from public.shifts where id = v_exception.shift_id;
    update public.shifts
    set payable_start = coalesce(p_payable_start, v_explanation.proposed_start, v_shift.starts_at),
        payable_end = coalesce(p_payable_end, v_explanation.proposed_end, v_shift.ends_at),
        regular_minutes = greatest(0, round(extract(epoch from (
          least(coalesce(p_payable_end, v_explanation.proposed_end, v_shift.ends_at), v_shift.ends_at) -
          greatest(coalesce(p_payable_start, v_explanation.proposed_start, v_shift.starts_at), v_shift.starts_at)
        )) / 60)),
        status = 'approved',
        updated_at = now()
    where id = v_exception.shift_id;
  end if;

  -- Audit log
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, after_data)
  values (
    v_explanation.organization_id, auth.uid(), 'review_explanation:' || p_decision,
    'explanations', v_explanation.id::text, to_jsonb(v_explanation)
  );

  return v_result;
end;
$$;

grant execute on function public.review_explanation(uuid, text, timestamptz, timestamptz, text) to authenticated;

-- 10. RPC to review overtime request
create or replace function public.review_overtime(
  p_ot_id uuid,
  p_decision text, -- 'approved' or 'rejected'
  p_approved_minutes integer default null,
  p_note text default null
)
returns public.overtime_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ot record;
  v_result record;
begin
  if not public.is_manager() then
    raise exception 'PERMISSION_DENIED_NOT_MANAGER';
  end if;

  select * into v_ot from public.overtime_requests
  where id = p_ot_id and organization_id = public.current_org();
  if not found then
    raise exception 'OVERTIME_REQUEST_NOT_FOUND';
  end if;

  update public.overtime_requests
  set status = p_decision::public.approval_status,
      approved_minutes = case when p_decision = 'approved' then coalesce(p_approved_minutes, requested_minutes) else 0 end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_ot_id
  returning * into v_result;

  if p_decision = 'approved' and v_ot.shift_id is not null then
    update public.shifts
    set overtime_minutes = v_ot.approved_minutes,
        updated_at = now()
    where id = v_ot.shift_id;
  end if;

  -- Audit log
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, after_data)
  values (
    v_ot.organization_id, auth.uid(), 'review_overtime:' || p_decision,
    'overtime_requests', v_ot.id::text, to_jsonb(v_ot)
  );

  return v_result;
end;
$$;

grant execute on function public.review_overtime(uuid, text, integer, text) to authenticated;

-- 11. RPC to lock and snapshot a payroll period
create or replace function public.lock_payroll_period(p_period_id uuid)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period record;
  v_result record;
begin
  if not public.is_manager() then
    raise exception 'PERMISSION_DENIED_NOT_MANAGER';
  end if;

  select * into v_period from public.payroll_periods
  where id = p_period_id and organization_id = public.current_org();
  if not found then
    raise exception 'PERIOD_NOT_FOUND';
  end if;

  -- Snapshot current rate and rules for each employee line in this period
  update public.payroll_lines l
  set snapshot_payroll_type = p.payroll_type,
      snapshot_rate = case when p.payroll_type = 'hourly' then p.hourly_rate else p.monthly_salary end,
      snapshot_rules = jsonb_build_object(
        'standard_monthly_days', s.standard_monthly_days,
        'standard_daily_hours', s.standard_daily_hours,
        'rounding_minutes', s.rounding_minutes
      ),
      is_locked = true,
      locked_at = now()
  from public.profiles p
  cross join public.settings s
  where l.period_id = p_period_id
    and l.employee_id = p.id
    and s.organization_id = l.organization_id;

  -- Mark period locked
  update public.payroll_periods
  set status = 'locked',
      locked_at = now(),
      locked_by = auth.uid()
  where id = p_period_id
  returning * into v_result;

  -- Audit log
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, after_data)
  values (
    v_period.organization_id, auth.uid(), 'lock_payroll_period',
    'payroll_periods', v_period.id::text, to_jsonb(v_period)
  );

  return v_result;
end;
$$;

grant execute on function public.lock_payroll_period(uuid) to authenticated;

-- 12. Add wage_histories to Supabase Realtime
do $$ begin
  alter publication supabase_realtime add table public.wage_histories;
exception when others then null;
end $$;
