create or replace function public.review_attendance_exception(
  p_exception_id uuid,
  p_decision text,
  p_review_note text default null
)
returns public.attendance_exceptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exc public.attendance_exceptions%rowtype;
  v_shift public.shifts%rowtype;
  v_result public.attendance_exceptions%rowtype;
  v_check_in timestamptz;
  v_check_out timestamptz;
  v_payable_start timestamptz;
  v_payable_end timestamptz;
  v_regular integer;
begin
  if not public.is_manager() then
    raise exception 'PERMISSION_DENIED_NOT_MANAGER';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'INVALID_DECISION';
  end if;

  select * into v_exc
  from public.attendance_exceptions
  where id = p_exception_id
    and organization_id = public.current_org();
  if not found then
    raise exception 'ATTENDANCE_EXCEPTION_NOT_FOUND';
  end if;

  select * into v_shift
  from public.shifts
  where id = v_exc.shift_id
    and organization_id = public.current_org();
  if not found then
    raise exception 'SHIFT_NOT_FOUND';
  end if;

  update public.attendance_exceptions
  set status = p_decision::public.approval_status,
      resolved_at = now()
  where id = p_exception_id
  returning * into v_result;

  if p_decision = 'approved' then
    select min(occurred_at) filter (where event = 'check_in'),
           max(occurred_at) filter (where event = 'check_out')
    into v_check_in, v_check_out
    from public.attendance_events
    where shift_id = v_shift.id
      and employee_id = v_shift.employee_id;

    if v_exc.kind = 'missing_check_in' then
      if v_check_out is null then
        raise exception 'CANNOT_APPROVE_WITHOUT_CHECK_OUT';
      end if;
      v_payable_start := v_shift.starts_at;
      v_payable_end := least(v_check_out, v_shift.ends_at);
    elsif v_exc.kind = 'missing_check_out' then
      if v_check_in is null then
        raise exception 'CANNOT_APPROVE_WITHOUT_CHECK_IN';
      end if;
      v_payable_start := greatest(v_check_in, v_shift.starts_at);
      v_payable_end := v_shift.ends_at;
    elsif v_exc.kind = 'late' then
      if v_check_out is null then
        raise exception 'CANNOT_APPROVE_LATE_WITHOUT_CHECK_OUT';
      end if;
      v_payable_start := v_shift.starts_at;
      v_payable_end := least(v_check_out, v_shift.ends_at);
    elsif v_exc.kind = 'early_leave' then
      if v_check_in is null then
        raise exception 'CANNOT_APPROVE_EARLY_LEAVE_WITHOUT_CHECK_IN';
      end if;
      v_payable_start := greatest(v_check_in, v_shift.starts_at);
      v_payable_end := v_shift.ends_at;
    else
      if v_check_in is not null and v_check_out is not null then
        v_payable_start := greatest(v_check_in, v_shift.starts_at);
        v_payable_end := least(v_check_out, v_shift.ends_at);
      else
        v_payable_start := v_shift.payable_start;
        v_payable_end := v_shift.payable_end;
      end if;
    end if;

    if v_payable_start is not null and v_payable_end is not null and v_payable_end >= v_payable_start then
      v_regular := greatest(
        0,
        floor(extract(epoch from (v_payable_end - v_payable_start)) / 60)::integer
        - coalesce(v_shift.break_minutes, 0)
      );

      update public.shifts
      set payable_start = v_payable_start,
          payable_end = v_payable_end,
          regular_minutes = v_regular,
          status = 'approved',
          updated_at = now()
      where id = v_shift.id;
    end if;
  end if;

  insert into public.audit_logs(
    organization_id, actor_id, action, entity_type, entity_id, after_data, metadata
  ) values (
    v_exc.organization_id, auth.uid(), 'review_attendance_exception:' || p_decision,
    'attendance_exceptions', v_result.id::text, to_jsonb(v_result),
    jsonb_build_object('note', p_review_note, 'shift_id', v_exc.shift_id)
  );

  return v_result;
end;
$$;

revoke execute on function public.review_attendance_exception(uuid, text, text) from public, anon;
grant execute on function public.review_attendance_exception(uuid, text, text) to authenticated;
