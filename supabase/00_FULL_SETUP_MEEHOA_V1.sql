-- ==============================================================================
-- MEEHOA TIME V1 - COMPLETE DATABASE MIGRATION SCRIPT
-- Run this entire script in Supabase SQL Editor for new or existing project
-- ==============================================================================

-- STEP 1: INITIAL SCHEMA
create extension if not exists pgcrypto;

create type public.app_role as enum ('owner','admin','employee');
create type public.payroll_type as enum ('hourly','monthly');
create type public.shift_status as enum ('scheduled','in_progress','completed','exception','approved','cancelled');
create type public.exception_type as enum ('late','early_leave','missing_check_in','missing_check_out','outside_geofence','unscheduled_work','unscheduled_overtime');
create type public.approval_status as enum ('open','submitted','approved','rejected','cancelled');
create type public.event_type as enum ('check_in','check_out');

create table public.organizations (
  id uuid primary key default gen_random_uuid(), name text not null, timezone text not null default 'Asia/Ho_Chi_Minh',
  currency text not null default 'VND', created_at timestamptz not null default now()
);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text not null, phone text, role public.app_role not null default 'employee', active boolean not null default true,
  payroll_type public.payroll_type not null default 'hourly', hourly_rate numeric(14,2) not null default 0, monthly_salary numeric(14,2) not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.locations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, latitude double precision not null, longitude double precision not null, radius_meters integer not null default 120 check(radius_meters between 20 and 2000), active boolean not null default true
);
create table public.settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade, grace_minutes integer not null default 5,
  require_geofence boolean not null default true, require_ot_approval boolean not null default true, hold_incomplete_attendance boolean not null default true,
  explanation_deadline_hours integer not null default 48, late_policy text not null default 'flag_only', late_block_minutes integer not null default 5,
  late_block_amount numeric(14,2) not null default 0, updated_at timestamptz not null default now()
);
create table public.shift_templates (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null, start_time time not null, end_time time not null, color text not null default '#176448', active boolean not null default true
);
create table public.shifts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade, location_id uuid references public.locations(id), template_id uuid references public.shift_templates(id),
  starts_at timestamptz not null, ends_at timestamptz not null, break_minutes integer not null default 0, note text,
  status public.shift_status not null default 'scheduled', payable_start timestamptz, payable_end timestamptz, regular_minutes integer not null default 0,
  overtime_minutes integer not null default 0, pending_minutes integer not null default 0, source text not null default 'manual',
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint shift_time_order check(ends_at > starts_at)
);
create index shifts_employee_starts_idx on public.shifts(employee_id, starts_at);
create table public.attendance_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade, shift_id uuid references public.shifts(id) on delete set null,
  event public.event_type not null, occurred_at timestamptz not null default now(), latitude double precision, longitude double precision,
  accuracy_meters double precision, distance_meters double precision, within_geofence boolean, device_id text, idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create table public.attendance_exceptions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade, shift_id uuid not null references public.shifts(id) on delete cascade,
  kind public.exception_type not null, status public.approval_status not null default 'open', minutes integer, amount numeric(14,2),
  detected_at timestamptz not null default now(), resolved_at timestamptz, unique(shift_id, kind)
);
create table public.explanations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  exception_id uuid not null references public.attendance_exceptions(id) on delete cascade, employee_id uuid not null references public.profiles(id) on delete cascade,
  message text not null, proposed_start timestamptz, proposed_end timestamptz, attachment_url text, status public.approval_status not null default 'submitted',
  submitted_at timestamptz not null default now(), reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, review_note text
);
create table public.overtime_requests (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade, employee_id uuid not null references public.profiles(id) on delete cascade,
  requested_minutes integer not null check(requested_minutes > 0), approved_minutes integer check(approved_minutes >= 0), reason text,
  status public.approval_status not null default 'submitted', reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, created_at timestamptz not null default now()
);
create table public.payroll_periods (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  starts_on date not null, ends_on date not null, status text not null default 'draft' check(status in ('draft','review','locked','paid')),
  locked_at timestamptz, locked_by uuid references public.profiles(id), unique(organization_id, starts_on, ends_on)
);
create table public.payroll_lines (
  id uuid primary key default gen_random_uuid(), period_id uuid not null references public.payroll_periods(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade, employee_id uuid not null references public.profiles(id) on delete cascade,
  regular_minutes integer not null default 0, overtime_minutes integer not null default 0, pending_minutes integer not null default 0,
  base_amount numeric(14,2) not null default 0, adjustment_amount numeric(14,2) not null default 0, pending_amount numeric(14,2) not null default 0,
  gross_amount numeric(14,2) generated always as (base_amount + adjustment_amount) stored, confidence text not null default 'pending' check(confidence in ('ready','pending')),
  unique(period_id, employee_id)
);
create table public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(), payroll_line_id uuid not null references public.payroll_lines(id) on delete cascade,
  label text not null, amount numeric(14,2) not null, category text not null check(category in ('bonus','allowance','commission','correction','attendance_violation')),
  created_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create table public.audit_logs (
  id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id), action text not null, entity_type text not null, entity_id text not null,
  before_data jsonb, after_data jsonb, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.notification_outbox (
  id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete cascade, channel text not null default 'in_app', template text not null,
  payload jsonb not null default '{}', status text not null default 'pending', attempts integer not null default 0, available_at timestamptz not null default now(), sent_at timestamptz
);

create or replace function public.current_org() returns uuid language sql stable security definer set search_path=public as $$ select organization_id from public.profiles where id=auth.uid() $$;
create or replace function public.is_manager() returns boolean language sql stable security definer set search_path=public as $$ select coalesce((select role in ('owner','admin') from public.profiles where id=auth.uid()),false) $$;

alter table public.organizations enable row level security; alter table public.profiles enable row level security; alter table public.locations enable row level security;
alter table public.settings enable row level security; alter table public.shift_templates enable row level security; alter table public.shifts enable row level security;
alter table public.attendance_events enable row level security; alter table public.attendance_exceptions enable row level security; alter table public.explanations enable row level security;
alter table public.overtime_requests enable row level security; alter table public.payroll_periods enable row level security; alter table public.payroll_lines enable row level security;
alter table public.payroll_adjustments enable row level security; alter table public.audit_logs enable row level security; alter table public.notification_outbox enable row level security;

create policy org_read on public.organizations for select using(id=public.current_org());
create policy profiles_read on public.profiles for select using(organization_id=public.current_org());
create policy profiles_manage on public.profiles for all using(organization_id=public.current_org() and public.is_manager()) with check(organization_id=public.current_org() and public.is_manager());
create policy locations_read on public.locations for select using(organization_id=public.current_org());
create policy locations_manage on public.locations for all using(organization_id=public.current_org() and public.is_manager()) with check(organization_id=public.current_org() and public.is_manager());
create policy settings_read on public.settings for select using(organization_id=public.current_org());
create policy settings_manage on public.settings for all using(organization_id=public.current_org() and public.is_manager()) with check(organization_id=public.current_org() and public.is_manager());
create policy templates_read on public.shift_templates for select using(organization_id=public.current_org());
create policy templates_manage on public.shift_templates for all using(organization_id=public.current_org() and public.is_manager()) with check(organization_id=public.current_org() and public.is_manager());
create policy shifts_read on public.shifts for select using(organization_id=public.current_org() and (employee_id=auth.uid() or public.is_manager()));
create policy shifts_manage on public.shifts for all using(organization_id=public.current_org() and public.is_manager()) with check(organization_id=public.current_org() and public.is_manager());
create policy events_read on public.attendance_events for select using(organization_id=public.current_org() and (employee_id=auth.uid() or public.is_manager()));
create policy events_insert on public.attendance_events for insert with check(organization_id=public.current_org() and employee_id=auth.uid());
create policy exceptions_read on public.attendance_exceptions for select using(organization_id=public.current_org() and (employee_id=auth.uid() or public.is_manager()));
create policy exceptions_manage on public.attendance_exceptions for all using(organization_id=public.current_org() and public.is_manager()) with check(organization_id=public.current_org() and public.is_manager());
create policy explanations_read on public.explanations for select using(organization_id=public.current_org() and (employee_id=auth.uid() or public.is_manager()));
create policy explanations_insert on public.explanations for insert with check(organization_id=public.current_org() and employee_id=auth.uid());
create policy explanations_review on public.explanations for update using(organization_id=public.current_org() and public.is_manager());
create policy ot_read on public.overtime_requests for select using(organization_id=public.current_org() and (employee_id=auth.uid() or public.is_manager()));
create policy ot_insert on public.overtime_requests for insert with check(organization_id=public.current_org() and employee_id=auth.uid());
create policy ot_review on public.overtime_requests for update using(organization_id=public.current_org() and public.is_manager());
create policy payroll_period_read on public.payroll_periods for select using(organization_id=public.current_org() and public.is_manager());
create policy payroll_period_manage on public.payroll_periods for all using(organization_id=public.current_org() and public.is_manager()) with check(organization_id=public.current_org() and public.is_manager());
create policy payroll_line_read on public.payroll_lines for select using(organization_id=public.current_org() and (employee_id=auth.uid() or public.is_manager()));
create policy payroll_line_manage on public.payroll_lines for all using(organization_id=public.current_org() and public.is_manager()) with check(organization_id=public.current_org() and public.is_manager());
create policy adjustment_read on public.payroll_adjustments for select using(exists(select 1 from public.payroll_lines l where l.id=payroll_line_id and l.organization_id=public.current_org() and (l.employee_id=auth.uid() or public.is_manager())));
create policy adjustment_manage on public.payroll_adjustments for all using(public.is_manager()) with check(public.is_manager());
create policy audit_read on public.audit_logs for select using(organization_id=public.current_org() and public.is_manager());
create policy outbox_manage on public.notification_outbox for all using(organization_id=public.current_org() and public.is_manager()) with check(organization_id=public.current_org() and public.is_manager());

alter publication supabase_realtime add table public.shifts, public.attendance_events, public.attendance_exceptions, public.explanations, public.overtime_requests, public.payroll_lines;


-- STEP 2: FUNCTIONS & REALTIME VIEW
create or replace function public.capture_attendance(p_shift_id uuid, p_event public.event_type, p_lat double precision, p_lng double precision, p_accuracy double precision, p_idempotency_key text)
returns public.attendance_events language plpgsql security definer set search_path=public as $$
declare v_shift public.shifts; v_location public.locations; v_distance double precision; v_event public.attendance_events;
begin
  select * into v_shift from public.shifts where id=p_shift_id and employee_id=auth.uid();
  if not found then raise exception 'SHIFT_NOT_FOUND'; end if;
  select * into v_location from public.locations where id=v_shift.location_id;
  if found and p_lat is not null and p_lng is not null then
    v_distance := 6371000 * 2 * asin(sqrt(power(sin(radians(p_lat-v_location.latitude)/2),2)+cos(radians(v_location.latitude))*cos(radians(p_lat))*power(sin(radians(p_lng-v_location.longitude)/2),2)));
  end if;
  insert into public.attendance_events(organization_id,employee_id,shift_id,event,latitude,longitude,accuracy_meters,distance_meters,within_geofence,idempotency_key)
  values(v_shift.organization_id,auth.uid(),p_shift_id,p_event,p_lat,p_lng,p_accuracy,v_distance,(v_distance is null or v_distance<=v_location.radius_meters),p_idempotency_key)
  returning * into v_event;
  update public.shifts set status=case when p_event='check_in' then 'in_progress'::public.shift_status else 'completed'::public.shift_status end, updated_at=now() where id=p_shift_id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(v_shift.organization_id,auth.uid(),p_event::text,'attendance_event',v_event.id::text,to_jsonb(v_event));
  return v_event;
end $$;
grant execute on function public.capture_attendance(uuid,public.event_type,double precision,double precision,double precision,text) to authenticated;

create or replace view public.payroll_fund_realtime with (security_invoker=true) as
select organization_id, period_id, coalesce(sum(gross_amount),0) confirmed_amount, coalesce(sum(pending_amount),0) pending_amount,
       count(*) filter(where confidence='pending') pending_people
from public.payroll_lines group by organization_id,period_id;


-- STEP 3: V1 COMPLETE ENTERPRISE EXTENSIONS
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
  v_shift public.shifts;
  v_location public.locations;
  v_settings public.settings;
  v_distance double precision;
  v_event public.attendance_events;
  v_within_geofence boolean := true;
  v_diff_minutes integer;
  v_existing public.attendance_events;
begin
  -- Idempotency check: return existing punch if same key
  select * into v_existing from public.attendance_events where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
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
  v_explanation public.explanations;
  v_exception public.attendance_exceptions;
  v_shift public.shifts;
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
  returning * into v_explanation;

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

  return v_explanation;
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
  v_ot public.overtime_requests;
  v_shift public.shifts;
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
  returning * into v_ot;

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

  return v_ot;
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
  v_period public.payroll_periods;
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
  returning * into v_period;

  -- Audit log
  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, after_data)
  values (
    v_period.organization_id, auth.uid(), 'lock_payroll_period',
    'payroll_periods', v_period.id::text, to_jsonb(v_period)
  );

  return v_period;
end;
$$;

grant execute on function public.lock_payroll_period(uuid) to authenticated;

-- 12. Add wage_histories to Supabase Realtime
do $$ begin
  alter publication supabase_realtime add table public.wage_histories;
exception when others then null;
end $$;


-- ==============================================================================
-- BOOTSTRAP HELPER FUNCTION (Optional convenience for initial organization setup)
-- Run public.bootstrap_organization(your_user_id, 'MEEHOA SHOP', 'Cửa hàng MEEHOA', 10.7769, 106.7009)
-- ==============================================================================
create or replace function public.bootstrap_organization(
  p_owner_user_id uuid,
  p_org_name text default 'MEEHOA TIME',
  p_store_name text default 'Cửa hàng MEEHOA',
  p_lat double precision default 10.7769,
  p_lng double precision default 106.7009,
  p_radius integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations;
  v_loc public.locations;
  v_prof public.profiles;
begin
  -- 1. Create or load organization
  insert into public.organizations(name, timezone, currency)
  values(p_org_name, 'Asia/Ho_Chi_Minh', 'VND')
  returning * into v_org;

  -- 2. Create store location
  insert into public.locations(organization_id, name, latitude, longitude, radius_meters)
  values(v_org.id, p_store_name, p_lat, p_lng, p_radius)
  returning * into v_loc;

  -- 3. Create settings
  insert into public.settings(
    organization_id, grace_minutes, require_geofence, require_ot_approval,
    hold_incomplete_attendance, standard_monthly_days, standard_daily_hours,
    rounding_minutes, max_gps_accuracy_meters
  )
  values(
    v_org.id, 5, true, true, true, 26, 8, 0, 150
  )
  on conflict (organization_id) do nothing;

  -- 4. Create owner profile for the auth user
  insert into public.profiles(
    id, organization_id, full_name, role, active, payroll_type, hourly_rate, monthly_salary, location_id
  )
  values(
    p_owner_user_id, v_org.id, 'Quản lý MEEHOA', 'owner', true, 'monthly', 0, 15000000, v_loc.id
  )
  on conflict (id) do update
  set organization_id = v_org.id, role = 'owner', location_id = v_loc.id
  returning * into v_prof;

  return jsonb_build_object(
    'organization_id', v_org.id,
    'location_id', v_loc.id,
    'owner_profile_id', v_prof.id,
    'status', 'success'
  );
end;
$$;
