-- ==============================================================================
-- MEEHOA TIME — Production Readiness Phase A
-- 2026-10-02
--
-- Goals:
--   1) Keep the existing website working while the frontend is upgraded.
--   2) Move authoritative attendance validation to the database.
--   3) Tighten profile/location privacy and SECURITY DEFINER privileges.
--   4) Produce real payroll lines from completed shifts.
--   5) Make payroll locking an immutable snapshot operation.
--
-- NOTE: the legacy direct attendance INSERT policy is intentionally kept in
-- Phase A so the current deployed frontend does not break before the new build
-- is live. A follow-up migration removes that policy after deployment.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Private authorization helpers (not exposed as public RPCs)
-- ------------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.current_org()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.active = true
  limit 1
$$;

create or replace function private.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.role in ('owner'::public.app_role, 'admin'::public.app_role)
    from public.profiles p
    where p.id = (select auth.uid())
      and p.active = true
    limit 1
  ), false)
$$;

revoke execute on function private.current_org() from public, anon;
revoke execute on function private.is_manager() from public, anon;
grant execute on function private.current_org() to authenticated;
grant execute on function private.is_manager() to authenticated;

-- Old public helpers are no longer needed by RLS. Keep them only for backwards
-- compatibility, but remove API execution rights.
revoke execute on function public.current_org() from public, anon, authenticated;
revoke execute on function public.is_manager() from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. Rebuild RLS policies with organization isolation and least privilege
-- ------------------------------------------------------------------------------

drop policy if exists org_read on public.organizations;
create policy org_read on public.organizations
  for select to authenticated
  using (id = private.current_org());

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated
  using (
    organization_id = private.current_org()
    and (id = (select auth.uid()) or private.is_manager())
  );

drop policy if exists profiles_manage on public.profiles;
create policy profiles_manage on public.profiles
  for all to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

drop policy if exists locations_read on public.locations;
create policy locations_read on public.locations
  for select to authenticated
  using (organization_id = private.current_org() and active = true);

drop policy if exists locations_manage on public.locations;
create policy locations_manage on public.locations
  for all to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings
  for select to authenticated
  using (organization_id = private.current_org());

drop policy if exists settings_manage on public.settings;
create policy settings_manage on public.settings
  for all to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

drop policy if exists templates_read on public.shift_templates;
create policy templates_read on public.shift_templates
  for select to authenticated
  using (organization_id = private.current_org());

drop policy if exists templates_manage on public.shift_templates;
create policy templates_manage on public.shift_templates
  for all to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

drop policy if exists shifts_read on public.shifts;
create policy shifts_read on public.shifts
  for select to authenticated
  using (
    organization_id = private.current_org()
    and (employee_id = (select auth.uid()) or private.is_manager())
  );

drop policy if exists shifts_manage on public.shifts;
create policy shifts_manage on public.shifts
  for all to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

drop policy if exists events_read on public.attendance_events;
create policy events_read on public.attendance_events
  for select to authenticated
  using (
    organization_id = private.current_org()
    and (employee_id = (select auth.uid()) or private.is_manager())
  );

-- PHASE A compatibility policy. Removed after the upgraded frontend is live.
drop policy if exists events_insert on public.attendance_events;
create policy events_insert on public.attendance_events
  for insert to authenticated
  with check (
    organization_id = private.current_org()
    and employee_id = (select auth.uid())
  );

drop policy if exists exceptions_read on public.attendance_exceptions;
create policy exceptions_read on public.attendance_exceptions
  for select to authenticated
  using (
    organization_id = private.current_org()
    and (employee_id = (select auth.uid()) or private.is_manager())
  );

drop policy if exists exceptions_manage on public.attendance_exceptions;
create policy exceptions_manage on public.attendance_exceptions
  for all to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

drop policy if exists explanations_read on public.explanations;
create policy explanations_read on public.explanations
  for select to authenticated
  using (
    organization_id = private.current_org()
    and (employee_id = (select auth.uid()) or private.is_manager())
  );

drop policy if exists explanations_insert on public.explanations;
create policy explanations_insert on public.explanations
  for insert to authenticated
  with check (
    organization_id = private.current_org()
    and employee_id = (select auth.uid())
  );

drop policy if exists explanations_review on public.explanations;
create policy explanations_review on public.explanations
  for update to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

drop policy if exists ot_read on public.overtime_requests;
create policy ot_read on public.overtime_requests
  for select to authenticated
  using (
    organization_id = private.current_org()
    and (employee_id = (select auth.uid()) or private.is_manager())
  );

drop policy if exists ot_insert on public.overtime_requests;
create policy ot_insert on public.overtime_requests
  for insert to authenticated
  with check (
    organization_id = private.current_org()
    and employee_id = (select auth.uid())
  );

drop policy if exists ot_review on public.overtime_requests;
create policy ot_review on public.overtime_requests
  for update to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

drop policy if exists payroll_period_read on public.payroll_periods;
create policy payroll_period_read on public.payroll_periods
  for select to authenticated
  using (organization_id = private.current_org() and private.is_manager());

drop policy if exists payroll_period_manage on public.payroll_periods;
create policy payroll_period_manage on public.payroll_periods
  for all to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

drop policy if exists payroll_line_read on public.payroll_lines;
create policy payroll_line_read on public.payroll_lines
  for select to authenticated
  using (
    organization_id = private.current_org()
    and (employee_id = (select auth.uid()) or private.is_manager())
  );

drop policy if exists payroll_line_manage on public.payroll_lines;
create policy payroll_line_manage on public.payroll_lines
  for all to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

drop policy if exists adjustment_read on public.payroll_adjustments;
create policy adjustment_read on public.payroll_adjustments
  for select to authenticated
  using (
    exists (
      select 1
      from public.payroll_lines l
      where l.id = payroll_line_id
        and l.organization_id = private.current_org()
        and (l.employee_id = (select auth.uid()) or private.is_manager())
    )
  );

drop policy if exists adjustment_manage on public.payroll_adjustments;
create policy adjustment_manage on public.payroll_adjustments
  for all to authenticated
  using (private.is_manager())
  with check (private.is_manager());

drop policy if exists wage_histories_read on public.wage_histories;
create policy wage_histories_read on public.wage_histories
  for select to authenticated
  using (
    organization_id = private.current_org()
    and (employee_id = (select auth.uid()) or private.is_manager())
  );

drop policy if exists wage_histories_manage on public.wage_histories;
create policy wage_histories_manage on public.wage_histories
  for all to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs
  for select to authenticated
  using (organization_id = private.current_org() and private.is_manager());

drop policy if exists outbox_manage on public.notification_outbox;
create policy outbox_manage on public.notification_outbox
  for all to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

-- ------------------------------------------------------------------------------
-- 3. Helpful indexes for attendance/payroll lookups
-- ------------------------------------------------------------------------------
create index if not exists attendance_events_shift_event_time_idx
  on public.attendance_events(shift_id, event, occurred_at desc);

create index if not exists attendance_events_employee_time_idx
  on public.attendance_events(employee_id, occurred_at desc);

create index if not exists overtime_requests_shift_status_idx
  on public.overtime_requests(shift_id, status);

-- ------------------------------------------------------------------------------
-- 4. Authoritative attendance capture
-- ------------------------------------------------------------------------------
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
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_profile public.profiles%rowtype;
  v_shift public.shifts%rowtype;
  v_location public.locations%rowtype;
  v_settings public.settings%rowtype;
  v_event public.attendance_events%rowtype;
  v_check_in public.attendance_events%rowtype;
  v_distance double precision;
  v_late_minutes integer := 0;
  v_early_minutes integer := 0;
  v_ot_minutes integer := 0;
  v_regular_minutes integer := 0;
  v_existing_ot uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_profile
  from public.profiles p
  where p.id = (select auth.uid())
    and p.active = true;

  if not found then
    raise exception 'ACTIVE_PROFILE_REQUIRED';
  end if;

  if p_shift_id is null then
    raise exception 'SHIFT_REQUIRED';
  end if;

  select * into v_shift
  from public.shifts s
  where s.id = p_shift_id
    and s.employee_id = (select auth.uid())
    and s.organization_id = v_profile.organization_id
  for update;

  if not found or v_shift.status = 'cancelled'::public.shift_status then
    raise exception 'SHIFT_NOT_FOUND_OR_ACCESS_DENIED';
  end if;

  -- A punch is only valid around the assigned shift. This prevents reusing old
  -- or future shift IDs from a modified browser request.
  if v_now < v_shift.starts_at - interval '2 hours'
     or v_now > v_shift.ends_at + interval '6 hours' then
    raise exception 'SHIFT_OUTSIDE_ALLOWED_WINDOW';
  end if;

  select * into v_settings
  from public.settings s
  where s.organization_id = v_shift.organization_id;

  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    raise exception 'VALID_GPS_REQUIRED';
  end if;

  if p_accuracy is null
     or p_accuracy <= 0
     or p_accuracy > coalesce(v_settings.max_gps_accuracy_meters, 150) then
    raise exception 'GPS_ACCURACY_TOO_LOW';
  end if;

  if v_shift.location_id is null then
    raise exception 'SHIFT_LOCATION_REQUIRED';
  end if;

  select * into v_location
  from public.locations l
  where l.id = v_shift.location_id
    and l.organization_id = v_shift.organization_id
    and l.active = true;

  if not found then
    raise exception 'ACTIVE_LOCATION_REQUIRED';
  end if;

  v_distance := 6371000 * 2 * asin(
    sqrt(
      power(sin(radians(p_lat - v_location.latitude) / 2), 2) +
      cos(radians(v_location.latitude)) * cos(radians(p_lat)) *
      power(sin(radians(p_lng - v_location.longitude) / 2), 2)
    )
  );

  if coalesce(v_settings.require_geofence, true)
     and v_distance > coalesce(v_location.radius_meters, 120) then
    raise exception 'OUTSIDE_GEOFENCE';
  end if;

  -- Exact request retry: return the previously committed row.
  if p_idempotency_key is not null then
    select * into v_event
    from public.attendance_events a
    where a.idempotency_key = p_idempotency_key
      and a.employee_id = (select auth.uid())
    limit 1;
    if found then
      return v_event;
    end if;
  end if;

  -- A shift has at most one check-in and one check-out. Returning the prior row
  -- makes accidental double taps harmless.
  select * into v_event
  from public.attendance_events a
  where a.shift_id = v_shift.id
    and a.employee_id = (select auth.uid())
    and a.event = p_event
  order by a.occurred_at asc
  limit 1;

  if found then
    return v_event;
  end if;

  if p_event = 'check_out'::public.event_type then
    select * into v_check_in
    from public.attendance_events a
    where a.shift_id = v_shift.id
      and a.employee_id = (select auth.uid())
      and a.event = 'check_in'::public.event_type
    order by a.occurred_at asc
    limit 1;

    if not found then
      raise exception 'CHECK_IN_REQUIRED_BEFORE_CHECK_OUT';
    end if;
  end if;

  insert into public.attendance_events (
    organization_id,
    employee_id,
    shift_id,
    event,
    occurred_at,
    client_occurred_at,
    latitude,
    longitude,
    accuracy_meters,
    distance_meters,
    within_geofence,
    device_id,
    idempotency_key,
    user_agent,
    exception_note
  ) values (
    v_shift.organization_id,
    (select auth.uid()),
    v_shift.id,
    p_event,
    v_now,
    p_client_time,
    p_lat,
    p_lng,
    p_accuracy,
    v_distance,
    true,
    null,
    coalesce(nullif(p_idempotency_key, ''), gen_random_uuid()::text),
    p_user_agent,
    p_note
  )
  returning * into v_event;

  if p_event = 'check_in'::public.event_type then
    v_late_minutes := greatest(
      0,
      floor(extract(epoch from (v_now - v_shift.starts_at)) / 60)::integer
    );

    if v_late_minutes > coalesce(v_settings.grace_minutes, 5) then
      insert into public.attendance_exceptions (
        organization_id, employee_id, shift_id, kind, status, minutes
      ) values (
        v_shift.organization_id,
        (select auth.uid()),
        v_shift.id,
        'late'::public.exception_type,
        'open'::public.approval_status,
        v_late_minutes
      )
      on conflict (shift_id, kind) do update
      set minutes = excluded.minutes,
          status = 'open'::public.approval_status,
          resolved_at = null;
    end if;

    update public.shifts
    set status = 'in_progress'::public.shift_status,
        payable_start = greatest(v_now, starts_at),
        updated_at = v_now
    where id = v_shift.id;
  else
    v_early_minutes := greatest(
      0,
      floor(extract(epoch from (v_shift.ends_at - v_now)) / 60)::integer
    );

    if v_early_minutes > coalesce(v_settings.grace_minutes, 5) then
      insert into public.attendance_exceptions (
        organization_id, employee_id, shift_id, kind, status, minutes
      ) values (
        v_shift.organization_id,
        (select auth.uid()),
        v_shift.id,
        'early_leave'::public.exception_type,
        'open'::public.approval_status,
        v_early_minutes
      )
      on conflict (shift_id, kind) do update
      set minutes = excluded.minutes,
          status = 'open'::public.approval_status,
          resolved_at = null;
    end if;

    v_regular_minutes := greatest(
      0,
      floor(extract(epoch from (
        least(v_now, v_shift.ends_at) - greatest(v_check_in.occurred_at, v_shift.starts_at)
      )) / 60)::integer - coalesce(v_shift.break_minutes, 0)
    );

    v_ot_minutes := greatest(
      0,
      floor(extract(epoch from (v_now - v_shift.ends_at)) / 60)::integer
    );

    if v_ot_minutes > coalesce(v_settings.grace_minutes, 5)
       and coalesce(v_settings.require_ot_approval, true) then
      select o.id into v_existing_ot
      from public.overtime_requests o
      where o.shift_id = v_shift.id
        and o.employee_id = (select auth.uid())
        and o.status in ('open'::public.approval_status, 'submitted'::public.approval_status)
      order by o.created_at desc
      limit 1;

      if v_existing_ot is null then
        insert into public.overtime_requests (
          organization_id,
          shift_id,
          employee_id,
          requested_minutes,
          reason,
          status
        ) values (
          v_shift.organization_id,
          v_shift.id,
          (select auth.uid()),
          v_ot_minutes,
          'Tự động ghi nhận từ check-out muộn',
          'submitted'::public.approval_status
        );
      else
        update public.overtime_requests
        set requested_minutes = v_ot_minutes,
            reason = coalesce(reason, 'Tự động ghi nhận từ check-out muộn')
        where id = v_existing_ot;
      end if;

      insert into public.attendance_exceptions (
        organization_id, employee_id, shift_id, kind, status, minutes
      ) values (
        v_shift.organization_id,
        (select auth.uid()),
        v_shift.id,
        'unscheduled_overtime'::public.exception_type,
        'open'::public.approval_status,
        v_ot_minutes
      )
      on conflict (shift_id, kind) do update
      set minutes = excluded.minutes,
          status = 'open'::public.approval_status,
          resolved_at = null;
    end if;

    update public.shifts
    set status = 'completed'::public.shift_status,
        payable_start = greatest(v_check_in.occurred_at, starts_at),
        payable_end = least(v_now, ends_at),
        regular_minutes = v_regular_minutes,
        overtime_minutes = case
          when v_ot_minutes > coalesce(v_settings.grace_minutes, 5)
               and not coalesce(v_settings.require_ot_approval, true)
            then v_ot_minutes
          else 0
        end,
        pending_minutes = case
          when v_ot_minutes > coalesce(v_settings.grace_minutes, 5)
               and coalesce(v_settings.require_ot_approval, true)
            then v_ot_minutes
          else 0
        end,
        updated_at = v_now
    where id = v_shift.id;
  end if;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    v_shift.organization_id,
    (select auth.uid()),
    p_event::text,
    'attendance_event',
    v_event.id::text,
    to_jsonb(v_event)
  );

  return v_event;
end;
$$;

revoke execute on function public.capture_attendance(
  uuid, public.event_type, double precision, double precision, double precision,
  text, timestamptz, text, text
) from public, anon;
grant execute on function public.capture_attendance(
  uuid, public.event_type, double precision, double precision, double precision,
  text, timestamptz, text, text
) to authenticated;

-- ------------------------------------------------------------------------------
-- 5. Approval RPCs
-- ------------------------------------------------------------------------------
create or replace function public.review_overtime(
  p_ot_id uuid,
  p_decision text,
  p_approved_minutes integer default null,
  p_note text default null
)
returns public.overtime_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ot public.overtime_requests%rowtype;
  v_result public.overtime_requests%rowtype;
  v_minutes integer;
begin
  if not private.is_manager() then
    raise exception 'PERMISSION_DENIED_NOT_MANAGER';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'INVALID_DECISION';
  end if;

  select * into v_ot
  from public.overtime_requests o
  where o.id = p_ot_id
    and o.organization_id = private.current_org()
  for update;

  if not found then
    raise exception 'OVERTIME_REQUEST_NOT_FOUND';
  end if;

  v_minutes := case
    when p_decision = 'approved'
      then greatest(0, least(coalesce(p_approved_minutes, v_ot.requested_minutes), v_ot.requested_minutes))
    else 0
  end;

  update public.overtime_requests
  set status = p_decision::public.approval_status,
      approved_minutes = v_minutes,
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      reason = case
        when nullif(p_note, '') is not null then coalesce(reason, '') || ' | Admin: ' || p_note
        else reason
      end
  where id = v_ot.id
  returning * into v_result;

  update public.shifts
  set overtime_minutes = v_minutes,
      pending_minutes = 0,
      updated_at = now()
  where id = v_ot.shift_id;

  update public.attendance_exceptions
  set status = p_decision::public.approval_status,
      resolved_at = now()
  where shift_id = v_ot.shift_id
    and kind = 'unscheduled_overtime'::public.exception_type;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    v_ot.organization_id,
    (select auth.uid()),
    'review_overtime:' || p_decision,
    'overtime_requests',
    v_result.id::text,
    to_jsonb(v_result)
  );

  return v_result;
end;
$$;

revoke execute on function public.review_overtime(uuid, text, integer, text)
  from public, anon;
grant execute on function public.review_overtime(uuid, text, integer, text)
  to authenticated;

create or replace function public.resolve_attendance_exception(
  p_exception_id uuid,
  p_decision text,
  p_note text default null
)
returns public.attendance_exceptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exception public.attendance_exceptions%rowtype;
  v_result public.attendance_exceptions%rowtype;
begin
  if not private.is_manager() then
    raise exception 'PERMISSION_DENIED_NOT_MANAGER';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'INVALID_DECISION';
  end if;

  select * into v_exception
  from public.attendance_exceptions e
  where e.id = p_exception_id
    and e.organization_id = private.current_org()
  for update;

  if not found then
    raise exception 'EXCEPTION_NOT_FOUND';
  end if;

  update public.attendance_exceptions
  set status = p_decision::public.approval_status,
      resolved_at = now()
  where id = v_exception.id
  returning * into v_result;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, metadata, after_data
  ) values (
    v_exception.organization_id,
    (select auth.uid()),
    'resolve_attendance_exception:' || p_decision,
    'attendance_exception',
    v_exception.id::text,
    jsonb_build_object('note', p_note),
    to_jsonb(v_result)
  );

  return v_result;
end;
$$;

revoke execute on function public.resolve_attendance_exception(uuid, text, text)
  from public, anon;
grant execute on function public.resolve_attendance_exception(uuid, text, text)
  to authenticated;

-- Existing explanation review remains manager-only.
create or replace function public.review_explanation(
  p_explanation_id uuid,
  p_decision text,
  p_payable_start timestamptz default null,
  p_payable_end timestamptz default null,
  p_review_note text default null
)
returns public.explanations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_explanation public.explanations%rowtype;
  v_exception public.attendance_exceptions%rowtype;
  v_shift public.shifts%rowtype;
  v_result public.explanations%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_regular integer;
begin
  if not private.is_manager() then
    raise exception 'PERMISSION_DENIED_NOT_MANAGER';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'INVALID_DECISION';
  end if;

  select * into v_explanation
  from public.explanations e
  where e.id = p_explanation_id
    and e.organization_id = private.current_org()
  for update;

  if not found then
    raise exception 'EXPLANATION_NOT_FOUND';
  end if;

  select * into v_exception
  from public.attendance_exceptions e
  where e.id = v_explanation.exception_id
    and e.organization_id = private.current_org();

  update public.explanations
  set status = p_decision::public.approval_status,
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      review_note = p_review_note
  where id = v_explanation.id
  returning * into v_result;

  update public.attendance_exceptions
  set status = p_decision::public.approval_status,
      resolved_at = now()
  where id = v_explanation.exception_id;

  if p_decision = 'approved' and v_exception.shift_id is not null then
    select * into v_shift
    from public.shifts s
    where s.id = v_exception.shift_id;

    v_start := greatest(
      coalesce(p_payable_start, v_explanation.proposed_start, v_shift.starts_at),
      v_shift.starts_at
    );
    v_end := least(
      coalesce(p_payable_end, v_explanation.proposed_end, v_shift.ends_at),
      v_shift.ends_at
    );
    v_regular := greatest(
      0,
      floor(extract(epoch from (v_end - v_start)) / 60)::integer - coalesce(v_shift.break_minutes, 0)
    );

    update public.shifts
    set payable_start = v_start,
        payable_end = v_end,
        regular_minutes = v_regular,
        pending_minutes = 0,
        status = 'approved'::public.shift_status,
        updated_at = now()
    where id = v_exception.shift_id;
  end if;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    v_explanation.organization_id,
    (select auth.uid()),
    'review_explanation:' || p_decision,
    'explanations',
    v_result.id::text,
    to_jsonb(v_result)
  );

  return v_result;
end;
$$;

revoke execute on function public.review_explanation(uuid, text, timestamptz, timestamptz, text)
  from public, anon;
grant execute on function public.review_explanation(uuid, text, timestamptz, timestamptz, text)
  to authenticated;

-- ------------------------------------------------------------------------------
-- 6. Real payroll preparation
-- ------------------------------------------------------------------------------
create or replace function public.prepare_payroll_period(
  p_starts_on date,
  p_ends_on date
)
returns public.payroll_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_period public.payroll_periods%rowtype;
  v_settings public.settings%rowtype;
begin
  if not private.is_manager() then
    raise exception 'PERMISSION_DENIED_NOT_MANAGER';
  end if;

  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    raise exception 'INVALID_PAYROLL_PERIOD';
  end if;

  v_org := private.current_org();

  select * into v_settings
  from public.settings s
  where s.organization_id = v_org;

  select * into v_period
  from public.payroll_periods pp
  where pp.organization_id = v_org
    and pp.starts_on = p_starts_on
    and pp.ends_on = p_ends_on
  limit 1;

  if found and v_period.status in ('locked', 'paid') then
    return v_period;
  end if;

  if not found then
    insert into public.payroll_periods (
      organization_id, starts_on, ends_on, status
    ) values (
      v_org, p_starts_on, p_ends_on, 'draft'
    )
    returning * into v_period;
  end if;

  -- Ended shifts with a missing punch are held entirely until explanation.
  insert into public.attendance_exceptions (
    organization_id, employee_id, shift_id, kind, status, minutes
  )
  select
    s.organization_id,
    s.employee_id,
    s.id,
    'missing_check_in'::public.exception_type,
    'open'::public.approval_status,
    greatest(0, floor(extract(epoch from (s.ends_at - s.starts_at)) / 60)::integer - coalesce(s.break_minutes, 0))
  from public.shifts s
  where s.organization_id = v_org
    and s.starts_at::date between p_starts_on and p_ends_on
    and s.ends_at < now()
    and s.status <> 'cancelled'::public.shift_status
    and not exists (
      select 1 from public.attendance_events a
      where a.shift_id = s.id and a.event = 'check_in'::public.event_type
    )
  on conflict (shift_id, kind) do nothing;

  insert into public.attendance_exceptions (
    organization_id, employee_id, shift_id, kind, status, minutes
  )
  select
    s.organization_id,
    s.employee_id,
    s.id,
    'missing_check_out'::public.exception_type,
    'open'::public.approval_status,
    greatest(0, floor(extract(epoch from (s.ends_at - s.starts_at)) / 60)::integer - coalesce(s.break_minutes, 0))
  from public.shifts s
  where s.organization_id = v_org
    and s.starts_at::date between p_starts_on and p_ends_on
    and s.ends_at < now()
    and s.status <> 'cancelled'::public.shift_status
    and exists (
      select 1 from public.attendance_events a
      where a.shift_id = s.id and a.event = 'check_in'::public.event_type
    )
    and not exists (
      select 1 from public.attendance_events a
      where a.shift_id = s.id and a.event = 'check_out'::public.event_type
    )
  on conflict (shift_id, kind) do nothing;

  with shift_calc as (
    select
      s.employee_id,
      sum(s.regular_minutes)::integer as regular_minutes,
      sum(s.overtime_minutes)::integer as overtime_minutes,
      sum(
        case
          when s.ends_at < now()
               and (
                 not exists (
                   select 1 from public.attendance_events ai
                   where ai.shift_id = s.id and ai.event = 'check_in'::public.event_type
                 )
                 or not exists (
                   select 1 from public.attendance_events ao
                   where ao.shift_id = s.id and ao.event = 'check_out'::public.event_type
                 )
               )
            then greatest(
              0,
              floor(extract(epoch from (s.ends_at - s.starts_at)) / 60)::integer
              - coalesce(s.break_minutes, 0)
            )
          else s.pending_minutes
        end
      )::integer as pending_minutes
    from public.shifts s
    where s.organization_id = v_org
      and s.starts_at::date between p_starts_on and p_ends_on
      and s.status <> 'cancelled'::public.shift_status
    group by s.employee_id
  ), staff_calc as (
    select
      p.id as employee_id,
      coalesce(sc.regular_minutes, 0) as regular_minutes,
      coalesce(sc.overtime_minutes, 0) as overtime_minutes,
      coalesce(sc.pending_minutes, 0) as pending_minutes,
      p.payroll_type,
      p.hourly_rate,
      p.monthly_salary,
      case
        when p.payroll_type = 'hourly'::public.payroll_type then p.hourly_rate
        else p.monthly_salary / greatest(1, v_settings.standard_monthly_days * v_settings.standard_daily_hours)
      end as hourly_equivalent
    from public.profiles p
    left join shift_calc sc on sc.employee_id = p.id
    where p.organization_id = v_org
      and p.active = true
  )
  insert into public.payroll_lines (
    period_id,
    organization_id,
    employee_id,
    regular_minutes,
    overtime_minutes,
    pending_minutes,
    base_amount,
    adjustment_amount,
    pending_amount,
    confidence,
    snapshot_payroll_type,
    snapshot_rate,
    snapshot_rules,
    is_locked,
    locked_at
  )
  select
    v_period.id,
    v_org,
    s.employee_id,
    s.regular_minutes,
    s.overtime_minutes,
    s.pending_minutes,
    round((s.regular_minutes / 60.0) * s.hourly_equivalent, 2),
    round((s.overtime_minutes / 60.0) * s.hourly_equivalent * 1.5, 2),
    round((s.pending_minutes / 60.0) * s.hourly_equivalent, 2),
    case when s.pending_minutes > 0 then 'pending' else 'ready' end,
    null,
    null,
    '{}'::jsonb,
    false,
    null
  from staff_calc s
  on conflict (period_id, employee_id) do update
  set regular_minutes = excluded.regular_minutes,
      overtime_minutes = excluded.overtime_minutes,
      pending_minutes = excluded.pending_minutes,
      base_amount = excluded.base_amount,
      adjustment_amount = excluded.adjustment_amount,
      pending_amount = excluded.pending_amount,
      confidence = excluded.confidence,
      snapshot_payroll_type = null,
      snapshot_rate = null,
      snapshot_rules = '{}'::jsonb,
      is_locked = false,
      locked_at = null;

  select * into v_period
  from public.payroll_periods pp
  where pp.id = v_period.id;

  return v_period;
end;
$$;

revoke execute on function public.prepare_payroll_period(date, date)
  from public, anon;
grant execute on function public.prepare_payroll_period(date, date)
  to authenticated;

-- ------------------------------------------------------------------------------
-- 7. Immutable payroll lock snapshot
-- ------------------------------------------------------------------------------
create or replace function public.lock_payroll_period(p_period_id uuid)
returns public.payroll_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.payroll_periods%rowtype;
  v_result public.payroll_periods%rowtype;
begin
  if not private.is_manager() then
    raise exception 'PERMISSION_DENIED_NOT_MANAGER';
  end if;

  select * into v_period
  from public.payroll_periods pp
  where pp.id = p_period_id
    and pp.organization_id = private.current_org()
  for update;

  if not found then
    raise exception 'PERIOD_NOT_FOUND';
  end if;

  if v_period.status = 'paid' then
    raise exception 'PAYROLL_ALREADY_PAID';
  end if;

  if v_period.status = 'locked' then
    return v_period;
  end if;

  if exists (
    select 1
    from public.payroll_lines l
    where l.period_id = p_period_id
      and (l.confidence = 'pending' or l.pending_minutes > 0)
  ) then
    raise exception 'PAYROLL_HAS_PENDING_ITEMS';
  end if;

  update public.payroll_lines l
  set snapshot_payroll_type = p.payroll_type,
      snapshot_rate = case
        when p.payroll_type = 'hourly'::public.payroll_type then p.hourly_rate
        else p.monthly_salary
      end,
      snapshot_rules = jsonb_build_object(
        'standard_monthly_days', s.standard_monthly_days,
        'standard_daily_hours', s.standard_daily_hours,
        'rounding_minutes', s.rounding_minutes,
        'grace_minutes', s.grace_minutes,
        'ot_multiplier', 1.5
      ),
      is_locked = true,
      locked_at = now()
  from public.profiles p
  cross join public.settings s
  where l.period_id = p_period_id
    and l.employee_id = p.id
    and s.organization_id = l.organization_id;

  update public.payroll_periods
  set status = 'locked',
      locked_at = now(),
      locked_by = (select auth.uid())
  where id = p_period_id
  returning * into v_result;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    v_period.organization_id,
    (select auth.uid()),
    'lock_payroll_period',
    'payroll_periods',
    v_result.id::text,
    to_jsonb(v_result)
  );

  return v_result;
end;
$$;

revoke execute on function public.lock_payroll_period(uuid) from public, anon;
grant execute on function public.lock_payroll_period(uuid) to authenticated;

-- Protect locked payroll line snapshots even from accidental manager edits.
create or replace function private.prevent_locked_payroll_line_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.is_locked then
    raise exception 'PAYROLL_LINE_LOCKED';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function private.prevent_locked_payroll_line_change()
  from public, anon;
grant execute on function private.prevent_locked_payroll_line_change()
  to authenticated;

drop trigger if exists payroll_lines_locked_guard on public.payroll_lines;
create trigger payroll_lines_locked_guard
before update or delete on public.payroll_lines
for each row execute function private.prevent_locked_payroll_line_change();

-- ------------------------------------------------------------------------------
-- 8. Bootstrap is an administrative setup utility, never a browser API.
-- ------------------------------------------------------------------------------
revoke execute on function public.bootstrap_organization(
  uuid, text, text, double precision, double precision, integer
) from public, anon, authenticated;
grant execute on function public.bootstrap_organization(
  uuid, text, text, double precision, double precision, integer
) to service_role;
