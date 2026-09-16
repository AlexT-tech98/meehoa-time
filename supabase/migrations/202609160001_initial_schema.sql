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
