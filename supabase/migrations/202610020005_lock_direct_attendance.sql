-- MEEHOA TIME — Production Readiness 005
-- APPLY ONLY AFTER the RPC-based frontend has been deployed and verified.
-- This closes the temporary compatibility path left during rollout.

-- Browser users can no longer write attendance rows directly.
drop policy if exists events_insert on public.attendance_events;
revoke insert, update, delete on table public.attendance_events from anon, authenticated;

-- The SECURITY DEFINER capture_attendance() RPC remains the only supported
-- attendance write path for signed-in employees.
revoke execute on function public.capture_attendance(
  uuid, public.event_type, double precision, double precision, double precision,
  text, timestamptz, text, text
) from public, anon;
grant execute on function public.capture_attendance(
  uuid, public.event_type, double precision, double precision, double precision,
  text, timestamptz, text, text
) to authenticated;
