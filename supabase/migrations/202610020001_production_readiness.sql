-- MEEHOA TIME - production readiness hardening
-- 2026-10-02

-- -----------------------------------------------------------------------------
-- 1. RLS privacy hardening
-- -----------------------------------------------------------------------------

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select
  using (
    organization_id = public.current_org()
    and (id = auth.uid() or public.is_manager())
  );

drop policy if exists locations_read on public.locations;
create policy locations_read on public.locations
  for select
  using (organization_id = public.current_org() and active = true);

-- Raw attendance may no longer be inserted directly from the browser.
-- All punches must go through capture_attendance().
drop policy if exists events_insert on public.attendance_events;

-- Employees need to read their current payroll period so their own payroll line can render.
drop policy if exists payroll_period_read on public.payroll_periods;
create policy payroll_period_read on public.payroll_periods
  for select
  using (organization_id = public.current_org());

-- -----------------------------------------------------------------------------
-- 2. Server-authoritative attendance capture
-- -----------------------------------------------------------------------------

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
  v_shift public.shifts%rowtype;
  v_location public.locations%rowtype;
  v_settings public.settings%rowtype;
  v_profile public.profiles%rowtype;
  v_event public.attendance_events%rowtype;
  v_last_event public.attendance_events%rowtype;
  v_check_in public.attendance_events%rowtype;
  v_distance double precision;
  v_within_geofence boolean;
  v_diff_minutes integer;
  v_regular_minutes integer;
  v_ot_minutes integer;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_profile
  from public.profiles
  where id = auth.uid() and active = true;
  if not found then
    raise exception 'PROFILE_INACTIVE_OR_MISSING';
  end if;

  -- Idempotency retries return the original event.
  select * into v_event
  from public.attendance_events
  where idempotency_key = p_idempotency_key
  limit 1;
  if found then
    return v_event;
  end if;

  select * into v_shift
  from public.shifts
  where id = p_shift_id
    and employee_id = auth.uid()
    and organization_id = v_profile.organization_id
    and status <> 'cancelled';
  if not found then
    raise exception 'SHIFT_NOT_FOUND_OR_ACCESS_DENIED';
  end if;

  select * into v_settings
  from public.settings
  where organization_id = v_shift.organization_id;
  if not found then
    raise exception 'SETTINGS_NOT_FOUND';
  end if;

  if v_shift.location_id is null then
    raise exception 'SHIFT_LOCATION_MISSING';
  end if;

  select * into v_location
  from public.locations
  where id = v_shift.location_id
    and organization_id = v_shift.organization_id
    and active = true;
  if not found then
    raise exception 'LOCATION_NOT_FOUND';
  end if;

  if p_lat is null or p_lng is null then
    raise exception 'GPS_REQUIRED';
  end if;

  if p_accuracy is null or p_accuracy <= 0
     or p_accuracy > coalesce(v_settings.max_gps_accuracy_meters, 150) then
    raise exception 'GPS_ACCURACY_TOO_LOW';
  end if;

  v_distance := 6371000 * 2 * asin(
    sqrt(
      power(sin(radians(p_lat - v_location.latitude) / 2), 2) +
      cos(radians(v_location.latitude)) * cos(radians(p_lat)) *
      power(sin(radians(p_lng - v_location.longitude) / 2), 2)
    )
  );
  v_within_geofence := v_distance <= coalesce(v_location.radius_meters, 120);

  if coalesce(v_settings.require_geofence, true) and not v_within_geofence then
    raise exception 'OUTSIDE_GEOFENCE';
  end if;

  select * into v_last_event
  from public.attendance_events
  where shift_id = v_shift.id
    and employee_id = auth.uid()
  order by occurred_at desc
  limit 1;

  if p_event = 'check_in' then
    if found and v_last_event.event = 'check_in' then
      if now() - v_last_event.occurred_at <= interval '30 seconds' then
        return v_last_event;
      end if;
      raise exception 'ALREADY_CHECKED_IN';
    end if;
    if found and v_last_event.event = 'check_out' then
      raise exception 'SHIFT_ALREADY_COMPLETED';
    end if;
  else
    if not found then
      raise exception 'CHECK_IN_REQUIRED';
    end if;
    if v_last_event.event = 'check_out' then
      if now() - v_last_event.occurred_at <= interval '30 seconds' then
        return v_last_event;
      end if;
      raise exception 'ALREADY_CHECKED_OUT';
    end if;
  end if;

  insert into public.attendance_events(
    organization_id, employee_id, shift_id, event,
    occurred_at, client_occurred_at, latitude, longitude,
    accuracy_meters, distance_meters, within_geofence,
    device_id, idempotency_key, user_agent, exception_note
  )
  values (
    v_shift.organization_id, auth.uid(), v_shift.id, p_event,
    now(), p_client_time, p_lat, p_lng,
    p_accuracy, v_distance, v_within_geofence,
    null, p_idempotency_key, p_user_agent, p_note
  )
  returning * into v_event;

  if p_event = 'check_in' then
    v_diff_minutes := greatest(0, floor(extract(epoch from (v_event.occurred_at - v_shift.starts_at)) / 60));

    if v_diff_minutes > coalesce(v_settings.grace_minutes, 5) then
      insert into public.attendance_exceptions(
        organization_id, employee_id, shift_id, kind, status, minutes
      )
      values (
        v_shift.organization_id, auth.uid(), v_shift.id,
        'late', 'open', v_diff_minutes
      )
      on conflict (shift_id, kind) do update
      set status = 'open', minutes = excluded.minutes, resolved_at = null;
    end if;

    update public.shifts
    set status = 'in_progress', updated_at = now()
    where id = v_shift.id;
  end if;

  if p_event = 'check_out' then
    select * into v_check_in
    from public.attendance_events
    where shift_id = v_shift.id
      and employee_id = auth.uid()
      and event = 'check_in'
      and occurred_at <= v_event.occurred_at
    order by occurred_at desc
    limit 1;

    if not found then
      raise exception 'CHECK_IN_REQUIRED';
    end if;

    v_regular_minutes := greatest(
      0,
      floor(
        extract(epoch from (
          least(v_event.occurred_at, v_shift.ends_at)
          - greatest(v_check_in.occurred_at, v_shift.starts_at)
        )) / 60
      )::integer - coalesce(v_shift.break_minutes, 0)
    );

    v_diff_minutes := greatest(0, floor(extract(epoch from (v_shift.ends_at - v_event.occurred_at)) / 60));
    if v_diff_minutes > coalesce(v_settings.grace_minutes, 5) then
      insert into public.attendance_exceptions(
        organization_id, employee_id, shift_id, kind, status, minutes
      )
      values (
        v_shift.organization_id, auth.uid(), v_shift.id,
        'early_leave', 'open', v_diff_minutes
      )
      on conflict (shift_id, kind) do update
      set status = 'open', minutes = excluded.minutes, resolved_at = null;
    end if;

    v_ot_minutes := greatest(0, floor(extract(epoch from (v_event.occurred_at - v_shift.ends_at)) / 60));

    if v_ot_minutes > coalesce(v_settings.grace_minutes, 5) then
      if coalesce(v_settings.require_ot_approval, true) then
        if not exists (
          select 1 from public.overtime_requests
          where shift_id = v_shift.id
            and employee_id = auth.uid()
            and status in ('open', 'submitted')
        ) then
          insert into public.overtime_requests(
            organization_id, shift_id, employee_id,
            requested_minutes, reason, status
          )
          values (
            v_shift.organization_id, v_shift.id, auth.uid(),
            v_ot_minutes, 'Checkout sau giờ kết thúc ca', 'submitted'
          );
        end if;

        update public.shifts
        set status = 'completed',
            regular_minutes = v_regular_minutes,
            overtime_minutes = 0,
            pending_minutes = v_ot_minutes,
            payable_start = greatest(v_check_in.occurred_at, starts_at),
            payable_end = least(v_event.occurred_at, ends_at),
            updated_at = now()
        where id = v_shift.id;
      else
        update public.shifts
        set status = 'completed',
            regular_minutes = v_regular_minutes,
            overtime_minutes = v_ot_minutes,
            pending_minutes = 0,
            payable_start = greatest(v_check_in.occurred_at, starts_at),
            payable_end = least(v_event.occurred_at, ends_at),
            updated_at = now()
        where id = v_shift.id;
      end if;
    else
      update public.shifts
      set status = 'completed',
          regular_minutes = v_regular_minutes,
          overtime_minutes = 0,
          pending_minutes = 0,
          payable_start = greatest(v_check_in.occurred_at, starts_at),
          payable_end = least(v_event.occurred_at, ends_at),
          updated_at = now()
      where id = v_shift.id;
    end if;
  end if;

  insert into public.audit_logs(
    organization_id, actor_id, action, entity_type, entity_id, after_data
  )
  values (
    v_shift.organization_id, auth.uid(), p_event::text,
    'attendance_event', v_event.id::text, to_jsonb(v_event)
  );

  return v_event;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. OT review updates Payable instead of merely changing request status
-- -----------------------------------------------------------------------------

create or replace function public.review_overtime(
  p_ot_id uuid,
  p_decision text,
  p_approved_minutes integer default null,
  p_note text default null
)
returns public.overtime_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ot public.overtime_requests%rowtype;
  v_result public.overtime_requests%rowtype;
begin
  if not public.is_manager() then
    raise exception 'PERMISSION_DENIED_NOT_MANAGER';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'INVALID_DECISION';
  end if;

  select * into v_ot
  from public.overtime_requests
  where id = p_ot_id
    and organization_id = public.current_org();
  if not found then
    raise exception 'OVERTIME_REQUEST_NOT_FOUND';
  end if;

  update public.overtime_requests
  set status = p_decision::public.approval_status,
      approved_minutes = case
        when p_decision = 'approved'
          then least(requested_minutes, greatest(0, coalesce(p_approved_minutes, requested_minutes)))
        else 0
      end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_ot_id
  returning * into v_result;

  update public.shifts
  set overtime_minutes = case when p_decision = 'approved' then v_result.approved_minutes else 0 end,
      pending_minutes = 0,
      updated_at = now()
  where id = v_ot.shift_id;

  insert into public.audit_logs(
    organization_id, actor_id, action, entity_type, entity_id, after_data, metadata
  )
  values (
    v_ot.organization_id, auth.uid(), 'review_overtime:' || p_decision,
    'overtime_requests', v_result.id::text, to_jsonb(v_result),
    jsonb_build_object('note', p_note)
  );

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Real payroll refresh from Payable shifts
-- -----------------------------------------------------------------------------

create or replace function public.refresh_payroll_period(p_period_id uuid default null)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_tz text;
  v_today date;
  v_start date;
  v_end date;
  v_period public.payroll_periods%rowtype;
  v_settings public.settings%rowtype;
begin
  if not public.is_manager() then
    raise exception 'PERMISSION_DENIED_NOT_MANAGER';
  end if;

  v_org := public.current_org();
  select timezone into v_tz from public.organizations where id = v_org;
  v_today := (now() at time zone coalesce(v_tz, 'Asia/Ho_Chi_Minh'))::date;

  if p_period_id is null then
    v_start := date_trunc('month', v_today)::date;
    v_end := (date_trunc('month', v_today) + interval '1 month - 1 day')::date;

    insert into public.payroll_periods(organization_id, starts_on, ends_on, status)
    values (v_org, v_start, v_end, 'draft')
    on conflict (organization_id, starts_on, ends_on) do nothing;

    select * into v_period
    from public.payroll_periods
    where organization_id = v_org
      and starts_on = v_start
      and ends_on = v_end;
  else
    select * into v_period
    from public.payroll_periods
    where id = p_period_id and organization_id = v_org;
  end if;

  if not found then
    raise exception 'PAYROLL_PERIOD_NOT_FOUND';
  end if;

  if v_period.status in ('locked', 'paid') then
    return v_period;
  end if;

  select * into v_settings
  from public.settings
  where organization_id = v_org;

  insert into public.payroll_lines(
    period_id, organization_id, employee_id,
    regular_minutes, overtime_minutes, pending_minutes,
    base_amount, pending_amount, confidence
  )
  select
    v_period.id,
    p.organization_id,
    p.id,
    coalesce(sum(s.regular_minutes), 0)::integer,
    coalesce(sum(s.overtime_minutes), 0)::integer,
    coalesce(sum(s.pending_minutes), 0)::integer,
    case
      when p.payroll_type = 'hourly' then
        round(
          (coalesce(sum(s.regular_minutes), 0) / 60.0) * p.hourly_rate
          + (coalesce(sum(s.overtime_minutes), 0) / 60.0) * p.hourly_rate * 1.5
        )
      else
        round(
          least(
            1.0,
            coalesce(sum(s.regular_minutes), 0)::numeric
            / nullif(v_settings.standard_monthly_days * v_settings.standard_daily_hours * 60, 0)
          ) * p.monthly_salary
          + (coalesce(sum(s.overtime_minutes), 0) / 60.0)
            * (p.monthly_salary / nullif(v_settings.standard_monthly_days * v_settings.standard_daily_hours, 0))
            * 1.5
        )
    end as base_amount,
    case
      when p.payroll_type = 'hourly' then
        round((coalesce(sum(s.pending_minutes), 0) / 60.0) * p.hourly_rate)
      else
        round(
          (coalesce(sum(s.pending_minutes), 0) / 60.0)
          * (p.monthly_salary / nullif(v_settings.standard_monthly_days * v_settings.standard_daily_hours, 0))
        )
    end as pending_amount,
    case
      when coalesce(sum(s.pending_minutes), 0) > 0
        or exists (
          select 1
          from public.attendance_exceptions ae
          join public.shifts es on es.id = ae.shift_id
          where ae.employee_id = p.id
            and ae.status in ('open', 'submitted')
            and es.starts_at >= v_period.starts_on::timestamptz
            and es.starts_at < (v_period.ends_on + 1)::timestamptz
        )
      then 'pending'
      else 'ready'
    end
  from public.profiles p
  left join public.shifts s
    on s.employee_id = p.id
    and s.organization_id = p.organization_id
    and s.status <> 'cancelled'
    and s.starts_at >= v_period.starts_on::timestamptz
    and s.starts_at < (v_period.ends_on + 1)::timestamptz
  where p.organization_id = v_org
    and p.active = true
  group by p.id, p.organization_id, p.payroll_type, p.hourly_rate, p.monthly_salary
  on conflict (period_id, employee_id) do update
  set regular_minutes = excluded.regular_minutes,
      overtime_minutes = excluded.overtime_minutes,
      pending_minutes = excluded.pending_minutes,
      base_amount = excluded.base_amount,
      pending_amount = excluded.pending_amount,
      confidence = excluded.confidence;

  return v_period;
end;
$$;

-- Lock always refreshes first and refuses unresolved Payable items.
create or replace function public.lock_payroll_period(p_period_id uuid)
returns public.payroll_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period public.payroll_periods%rowtype;
  v_result public.payroll_periods%rowtype;
begin
  if not public.is_manager() then
    raise exception 'PERMISSION_DENIED_NOT_MANAGER';
  end if;

  select * into v_period
  from public.payroll_periods
  where id = p_period_id and organization_id = public.current_org();
  if not found then
    raise exception 'PERIOD_NOT_FOUND';
  end if;

  if v_period.status in ('locked', 'paid') then
    return v_period;
  end if;

  perform public.refresh_payroll_period(p_period_id);

  if exists (
    select 1 from public.payroll_lines
    where period_id = p_period_id and confidence = 'pending'
  ) then
    raise exception 'PAYROLL_HAS_PENDING_ITEMS';
  end if;

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

  update public.payroll_periods
  set status = 'locked', locked_at = now(), locked_by = auth.uid()
  where id = p_period_id
  returning * into v_result;

  insert into public.audit_logs(organization_id, actor_id, action, entity_type, entity_id, after_data)
  values (
    v_period.organization_id, auth.uid(), 'lock_payroll_period',
    'payroll_periods', v_result.id::text, to_jsonb(v_result)
  );

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. RPC permissions: no privileged RPC is callable anonymously
-- -----------------------------------------------------------------------------

revoke execute on function public.capture_attendance(uuid, public.event_type, double precision, double precision, double precision, text, timestamptz, text, text) from public, anon;
grant execute on function public.capture_attendance(uuid, public.event_type, double precision, double precision, double precision, text, timestamptz, text, text) to authenticated;

revoke execute on function public.review_overtime(uuid, text, integer, text) from public, anon;
grant execute on function public.review_overtime(uuid, text, integer, text) to authenticated;

revoke execute on function public.review_explanation(uuid, text, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.review_explanation(uuid, text, timestamptz, timestamptz, text) to authenticated;

revoke execute on function public.refresh_payroll_period(uuid) from public, anon;
grant execute on function public.refresh_payroll_period(uuid) to authenticated;

revoke execute on function public.lock_payroll_period(uuid) from public, anon;
grant execute on function public.lock_payroll_period(uuid) to authenticated;

-- bootstrap is an installation-only function, never a client API.
revoke execute on function public.bootstrap_organization(uuid, text, text, double precision, double precision, integer) from public, anon, authenticated;

-- RLS helper functions are required by authenticated policies but not anonymous clients.
revoke execute on function public.current_org() from public, anon;
revoke execute on function public.is_manager() from public, anon;
grant execute on function public.current_org() to authenticated;
grant execute on function public.is_manager() to authenticated;
