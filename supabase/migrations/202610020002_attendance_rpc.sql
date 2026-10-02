-- MEEHOA TIME — Production Readiness 002: Server-authoritative attendance

create index if not exists attendance_events_shift_event_time_idx
  on public.attendance_events(shift_id, event, occurred_at desc);
create index if not exists attendance_events_employee_time_idx
  on public.attendance_events(employee_id, occurred_at desc);
create index if not exists overtime_requests_shift_status_idx
  on public.overtime_requests(shift_id, status);

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
  where p.id = (select auth.uid()) and p.active = true;
  if not found then raise exception 'ACTIVE_PROFILE_REQUIRED'; end if;

  select * into v_shift
  from public.shifts s
  where s.id = p_shift_id
    and s.employee_id = (select auth.uid())
    and s.organization_id = v_profile.organization_id
  for update;
  if not found or v_shift.status = 'cancelled'::public.shift_status then
    raise exception 'SHIFT_NOT_FOUND_OR_ACCESS_DENIED';
  end if;

  if v_now < v_shift.starts_at - interval '2 hours'
     or v_now > v_shift.ends_at + interval '6 hours' then
    raise exception 'SHIFT_OUTSIDE_ALLOWED_WINDOW';
  end if;

  select * into v_settings
  from public.settings s where s.organization_id = v_shift.organization_id;

  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    raise exception 'VALID_GPS_REQUIRED';
  end if;

  if p_accuracy is null or p_accuracy <= 0
     or p_accuracy > coalesce(v_settings.max_gps_accuracy_meters, 150) then
    raise exception 'GPS_ACCURACY_TOO_LOW';
  end if;

  if v_shift.location_id is null then raise exception 'SHIFT_LOCATION_REQUIRED'; end if;

  select * into v_location
  from public.locations l
  where l.id = v_shift.location_id
    and l.organization_id = v_shift.organization_id
    and l.active = true;
  if not found then raise exception 'ACTIVE_LOCATION_REQUIRED'; end if;

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

  -- Exact retry returns the committed event.
  if nullif(p_idempotency_key, '') is not null then
    select * into v_event
    from public.attendance_events a
    where a.idempotency_key = p_idempotency_key
      and a.employee_id = (select auth.uid())
    limit 1;
    if found then return v_event; end if;
  end if;

  -- One check-in and one check-out per shift. A double tap is harmless.
  select * into v_event
  from public.attendance_events a
  where a.shift_id = v_shift.id
    and a.employee_id = (select auth.uid())
    and a.event = p_event
  order by a.occurred_at asc
  limit 1;
  if found then return v_event; end if;

  if p_event = 'check_out'::public.event_type then
    select * into v_check_in
    from public.attendance_events a
    where a.shift_id = v_shift.id
      and a.employee_id = (select auth.uid())
      and a.event = 'check_in'::public.event_type
    order by a.occurred_at asc
    limit 1;
    if not found then raise exception 'CHECK_IN_REQUIRED_BEFORE_CHECK_OUT'; end if;
  end if;

  insert into public.attendance_events (
    organization_id, employee_id, shift_id, event, occurred_at,
    client_occurred_at, latitude, longitude, accuracy_meters,
    distance_meters, within_geofence, device_id, idempotency_key,
    user_agent, exception_note
  ) values (
    v_shift.organization_id, (select auth.uid()), v_shift.id, p_event, v_now,
    p_client_time, p_lat, p_lng, p_accuracy, v_distance, true, null,
    coalesce(nullif(p_idempotency_key, ''), gen_random_uuid()::text),
    p_user_agent, p_note
  ) returning * into v_event;

  if p_event = 'check_in'::public.event_type then
    v_late_minutes := greatest(0, floor(extract(epoch from (v_now - v_shift.starts_at)) / 60)::integer);

    if v_late_minutes > coalesce(v_settings.grace_minutes, 5) then
      insert into public.attendance_exceptions (
        organization_id, employee_id, shift_id, kind, status, minutes
      ) values (
        v_shift.organization_id, (select auth.uid()), v_shift.id,
        'late'::public.exception_type, 'open'::public.approval_status, v_late_minutes
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
    v_early_minutes := greatest(0, floor(extract(epoch from (v_shift.ends_at - v_now)) / 60)::integer);

    if v_early_minutes > coalesce(v_settings.grace_minutes, 5) then
      insert into public.attendance_exceptions (
        organization_id, employee_id, shift_id, kind, status, minutes
      ) values (
        v_shift.organization_id, (select auth.uid()), v_shift.id,
        'early_leave'::public.exception_type, 'open'::public.approval_status, v_early_minutes
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
    v_ot_minutes := greatest(0, floor(extract(epoch from (v_now - v_shift.ends_at)) / 60)::integer);

    if v_ot_minutes > coalesce(v_settings.grace_minutes, 5)
       and coalesce(v_settings.require_ot_approval, true) then
      select o.id into v_existing_ot
      from public.overtime_requests o
      where o.shift_id = v_shift.id
        and o.employee_id = (select auth.uid())
        and o.status in ('open'::public.approval_status, 'submitted'::public.approval_status)
      order by o.created_at desc limit 1;

      if v_existing_ot is null then
        insert into public.overtime_requests (
          organization_id, shift_id, employee_id, requested_minutes, reason, status
        ) values (
          v_shift.organization_id, v_shift.id, (select auth.uid()), v_ot_minutes,
          'Tự động ghi nhận từ check-out muộn', 'submitted'::public.approval_status
        );
      else
        update public.overtime_requests
        set requested_minutes = v_ot_minutes
        where id = v_existing_ot;
      end if;

      insert into public.attendance_exceptions (
        organization_id, employee_id, shift_id, kind, status, minutes
      ) values (
        v_shift.organization_id, (select auth.uid()), v_shift.id,
        'unscheduled_overtime'::public.exception_type, 'open'::public.approval_status, v_ot_minutes
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
               and not coalesce(v_settings.require_ot_approval, true) then v_ot_minutes
          else 0 end,
        pending_minutes = case
          when v_ot_minutes > coalesce(v_settings.grace_minutes, 5)
               and coalesce(v_settings.require_ot_approval, true) then v_ot_minutes
          else 0 end,
        updated_at = v_now
    where id = v_shift.id;
  end if;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    v_shift.organization_id, (select auth.uid()), p_event::text,
    'attendance_event', v_event.id::text, to_jsonb(v_event)
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
  if not private.is_manager() then raise exception 'PERMISSION_DENIED_NOT_MANAGER'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'INVALID_DECISION'; end if;

  select * into v_ot
  from public.overtime_requests o
  where o.id = p_ot_id and o.organization_id = private.current_org()
  for update;
  if not found then raise exception 'OVERTIME_REQUEST_NOT_FOUND'; end if;

  v_minutes := case
    when p_decision = 'approved'
      then greatest(0, least(coalesce(p_approved_minutes, v_ot.requested_minutes), v_ot.requested_minutes))
    else 0 end;

  update public.overtime_requests
  set status = p_decision::public.approval_status,
      approved_minutes = v_minutes,
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      reason = case when nullif(p_note, '') is not null
                    then concat_ws(' | ', reason, 'Admin: ' || p_note)
                    else reason end
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
    v_ot.organization_id, (select auth.uid()), 'review_overtime:' || p_decision,
    'overtime_requests', v_result.id::text, to_jsonb(v_result)
  );
  return v_result;
end;
$$;
revoke execute on function public.review_overtime(uuid, text, integer, text) from public, anon;
grant execute on function public.review_overtime(uuid, text, integer, text) to authenticated;

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
  if not private.is_manager() then raise exception 'PERMISSION_DENIED_NOT_MANAGER'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'INVALID_DECISION'; end if;

  select * into v_exception
  from public.attendance_exceptions e
  where e.id = p_exception_id and e.organization_id = private.current_org()
  for update;
  if not found then raise exception 'EXCEPTION_NOT_FOUND'; end if;

  update public.attendance_exceptions
  set status = p_decision::public.approval_status,
      resolved_at = now()
  where id = v_exception.id
  returning * into v_result;

  insert into public.audit_logs (
    organization_id, actor_id, action, entity_type, entity_id, metadata, after_data
  ) values (
    v_exception.organization_id, (select auth.uid()),
    'resolve_attendance_exception:' || p_decision,
    'attendance_exception', v_exception.id::text,
    jsonb_build_object('note', p_note), to_jsonb(v_result)
  );
  return v_result;
end;
$$;
revoke execute on function public.resolve_attendance_exception(uuid, text, text) from public, anon;
grant execute on function public.resolve_attendance_exception(uuid, text, text) to authenticated;

-- Existing explanation review remains manager-only.
revoke execute on function public.review_explanation(uuid, text, timestamptz, timestamptz, text)
  from public, anon;
grant execute on function public.review_explanation(uuid, text, timestamptz, timestamptz, text)
  to authenticated;
