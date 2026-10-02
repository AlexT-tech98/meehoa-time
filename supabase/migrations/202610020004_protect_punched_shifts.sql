-- MEEHOA TIME — Production Readiness 004
-- A shift that already has raw attendance is an operational record.
-- Managers may still update payable/status fields through approved workflows,
-- but may not rewrite the scheduled identity/time or delete the shift.

create or replace function private.protect_punched_shift()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_has_attendance boolean;
begin
  select exists(
    select 1
    from public.attendance_events a
    where a.shift_id = old.id
  ) into v_has_attendance;

  if not v_has_attendance then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'PUNCHED_SHIFT_IMMUTABLE';
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.employee_id is distinct from old.employee_id
     or new.location_id is distinct from old.location_id
     or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at
     or new.break_minutes is distinct from old.break_minutes then
    raise exception 'PUNCHED_SHIFT_SCHEDULE_IMMUTABLE';
  end if;

  return new;
end;
$$;

revoke execute on function private.protect_punched_shift() from public, anon;
grant execute on function private.protect_punched_shift() to authenticated;

drop trigger if exists protect_punched_shift on public.shifts;
create trigger protect_punched_shift
before update or delete on public.shifts
for each row execute function private.protect_punched_shift();
