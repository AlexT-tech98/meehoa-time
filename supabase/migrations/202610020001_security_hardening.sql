-- MEEHOA TIME — Production Readiness 001: Security hardening

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

-- Public helper RPCs are no longer part of the API surface.
revoke execute on function public.current_org() from public, anon, authenticated;
revoke execute on function public.is_manager() from public, anon, authenticated;

-- Organization
drop policy if exists org_read on public.organizations;
create policy org_read on public.organizations
  for select to authenticated
  using (id = private.current_org());

-- Profiles: employees see only themselves; managers see their organization.
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

-- Locations: never expose another organization's coordinates.
drop policy if exists locations_read on public.locations;
create policy locations_read on public.locations
  for select to authenticated
  using (organization_id = private.current_org() and active = true);

drop policy if exists locations_manage on public.locations;
create policy locations_manage on public.locations
  for all to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

-- Settings
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings
  for select to authenticated
  using (organization_id = private.current_org());

drop policy if exists settings_manage on public.settings;
create policy settings_manage on public.settings
  for all to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

-- Shift templates
drop policy if exists templates_read on public.shift_templates;
create policy templates_read on public.shift_templates
  for select to authenticated
  using (organization_id = private.current_org());

drop policy if exists templates_manage on public.shift_templates;
create policy templates_manage on public.shift_templates
  for all to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

-- Shifts
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

-- Attendance raw log. Direct insert remains temporarily for current frontend
-- compatibility and is removed after the RPC frontend is deployed.
drop policy if exists events_read on public.attendance_events;
create policy events_read on public.attendance_events
  for select to authenticated
  using (
    organization_id = private.current_org()
    and (employee_id = (select auth.uid()) or private.is_manager())
  );

drop policy if exists events_insert on public.attendance_events;
create policy events_insert on public.attendance_events
  for insert to authenticated
  with check (
    organization_id = private.current_org()
    and employee_id = (select auth.uid())
  );

-- Attendance exceptions
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

-- Explanations
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

-- Overtime
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

-- Payroll periods
drop policy if exists payroll_period_read on public.payroll_periods;
create policy payroll_period_read on public.payroll_periods
  for select to authenticated
  using (organization_id = private.current_org() and private.is_manager());

drop policy if exists payroll_period_manage on public.payroll_periods;
create policy payroll_period_manage on public.payroll_periods
  for all to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

-- Payroll lines
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

-- Payroll adjustments are scoped through their parent payroll line.
drop policy if exists adjustment_read on public.payroll_adjustments;
create policy adjustment_read on public.payroll_adjustments
  for select to authenticated
  using (
    exists (
      select 1 from public.payroll_lines l
      where l.id = payroll_line_id
        and l.organization_id = private.current_org()
        and (l.employee_id = (select auth.uid()) or private.is_manager())
    )
  );

drop policy if exists adjustment_manage on public.payroll_adjustments;
create policy adjustment_manage on public.payroll_adjustments
  for all to authenticated
  using (
    private.is_manager()
    and exists (
      select 1 from public.payroll_lines l
      where l.id = payroll_line_id
        and l.organization_id = private.current_org()
    )
  )
  with check (
    private.is_manager()
    and exists (
      select 1 from public.payroll_lines l
      where l.id = payroll_line_id
        and l.organization_id = private.current_org()
    )
  );

-- Wage histories
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

-- Audit and notification outbox
drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs
  for select to authenticated
  using (organization_id = private.current_org() and private.is_manager());

drop policy if exists outbox_manage on public.notification_outbox;
create policy outbox_manage on public.notification_outbox
  for all to authenticated
  using (organization_id = private.current_org() and private.is_manager())
  with check (organization_id = private.current_org() and private.is_manager());

-- Bootstrap is setup-only, never a browser RPC.
revoke execute on function public.bootstrap_organization(
  uuid, text, text, double precision, double precision, integer
) from public, anon, authenticated;
grant execute on function public.bootstrap_organization(
  uuid, text, text, double precision, double precision, integer
) to service_role;
