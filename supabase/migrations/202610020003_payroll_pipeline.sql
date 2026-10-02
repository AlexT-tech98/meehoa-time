-- MEEHOA TIME — Production Readiness 003: Real payroll pipeline

-- Employees may read period metadata; line-level RLS still protects individual pay.
drop policy if exists payroll_period_read on public.payroll_periods;
create policy payroll_period_read on public.payroll_periods
  for select to authenticated
  using (organization_id = private.current_org());

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
  if not private.is_manager() then raise exception 'PERMISSION_DENIED_NOT_MANAGER'; end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    raise exception 'INVALID_PAYROLL_PERIOD';
  end if;

  v_org := private.current_org();
  select * into v_settings from public.settings s where s.organization_id = v_org;

  select * into v_period
  from public.payroll_periods pp
  where pp.organization_id = v_org
    and pp.starts_on = p_starts_on
    and pp.ends_on = p_ends_on
  limit 1;

  if found and v_period.status in ('locked','paid') then return v_period; end if;
  if not found then
    insert into public.payroll_periods(organization_id,starts_on,ends_on,status)
    values(v_org,p_starts_on,p_ends_on,'draft')
    returning * into v_period;
  end if;

  -- Ended shifts missing a punch are held until reviewed.
  insert into public.attendance_exceptions(organization_id,employee_id,shift_id,kind,status,minutes)
  select s.organization_id,s.employee_id,s.id,'missing_check_in'::public.exception_type,
         'open'::public.approval_status,
         greatest(0,floor(extract(epoch from (s.ends_at-s.starts_at))/60)::integer-coalesce(s.break_minutes,0))
  from public.shifts s
  where s.organization_id=v_org
    and s.starts_at::date between p_starts_on and p_ends_on
    and s.ends_at < now()
    and s.status <> 'cancelled'::public.shift_status
    and not exists(select 1 from public.attendance_events a where a.shift_id=s.id and a.event='check_in'::public.event_type)
  on conflict(shift_id,kind) do nothing;

  insert into public.attendance_exceptions(organization_id,employee_id,shift_id,kind,status,minutes)
  select s.organization_id,s.employee_id,s.id,'missing_check_out'::public.exception_type,
         'open'::public.approval_status,
         greatest(0,floor(extract(epoch from (s.ends_at-s.starts_at))/60)::integer-coalesce(s.break_minutes,0))
  from public.shifts s
  where s.organization_id=v_org
    and s.starts_at::date between p_starts_on and p_ends_on
    and s.ends_at < now()
    and s.status <> 'cancelled'::public.shift_status
    and exists(select 1 from public.attendance_events a where a.shift_id=s.id and a.event='check_in'::public.event_type)
    and not exists(select 1 from public.attendance_events a where a.shift_id=s.id and a.event='check_out'::public.event_type)
  on conflict(shift_id,kind) do nothing;

  with shift_calc as (
    select s.employee_id,
      sum(s.regular_minutes)::integer regular_minutes,
      sum(s.overtime_minutes)::integer overtime_minutes,
      sum(case
        when s.ends_at < now() and (
          not exists(select 1 from public.attendance_events ai where ai.shift_id=s.id and ai.event='check_in'::public.event_type)
          or not exists(select 1 from public.attendance_events ao where ao.shift_id=s.id and ao.event='check_out'::public.event_type)
        ) then greatest(0,floor(extract(epoch from (s.ends_at-s.starts_at))/60)::integer-coalesce(s.break_minutes,0))
        else s.pending_minutes end)::integer pending_minutes
    from public.shifts s
    where s.organization_id=v_org
      and s.starts_at::date between p_starts_on and p_ends_on
      and s.status <> 'cancelled'::public.shift_status
    group by s.employee_id
  ), staff_calc as (
    select p.id employee_id,
      coalesce(sc.regular_minutes,0) regular_minutes,
      coalesce(sc.overtime_minutes,0) overtime_minutes,
      coalesce(sc.pending_minutes,0) pending_minutes,
      p.payroll_type,p.hourly_rate,p.monthly_salary,
      case when p.payroll_type='hourly'::public.payroll_type then p.hourly_rate
           else p.monthly_salary / greatest(1,v_settings.standard_monthly_days*v_settings.standard_daily_hours)
      end hourly_equivalent
    from public.profiles p
    left join shift_calc sc on sc.employee_id=p.id
    where p.organization_id=v_org and p.active=true
  )
  insert into public.payroll_lines(
    period_id,organization_id,employee_id,regular_minutes,overtime_minutes,pending_minutes,
    base_amount,adjustment_amount,pending_amount,confidence,
    snapshot_payroll_type,snapshot_rate,snapshot_rules,is_locked,locked_at
  )
  select v_period.id,v_org,s.employee_id,s.regular_minutes,s.overtime_minutes,s.pending_minutes,
    round((s.regular_minutes/60.0)*s.hourly_equivalent,2),
    round((s.overtime_minutes/60.0)*s.hourly_equivalent*1.5,2),
    round((s.pending_minutes/60.0)*s.hourly_equivalent,2),
    case when s.pending_minutes>0 then 'pending' else 'ready' end,
    null,null,'{}'::jsonb,false,null
  from staff_calc s
  on conflict(period_id,employee_id) do update
  set regular_minutes=excluded.regular_minutes,
      overtime_minutes=excluded.overtime_minutes,
      pending_minutes=excluded.pending_minutes,
      base_amount=excluded.base_amount,
      adjustment_amount=excluded.adjustment_amount,
      pending_amount=excluded.pending_amount,
      confidence=excluded.confidence,
      snapshot_payroll_type=null,snapshot_rate=null,snapshot_rules='{}'::jsonb,
      is_locked=false,locked_at=null;

  select * into v_period from public.payroll_periods pp where pp.id=v_period.id;
  return v_period;
end;
$$;
revoke execute on function public.prepare_payroll_period(date,date) from public,anon;
grant execute on function public.prepare_payroll_period(date,date) to authenticated;

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
  if not private.is_manager() then raise exception 'PERMISSION_DENIED_NOT_MANAGER'; end if;
  select * into v_period from public.payroll_periods pp
  where pp.id=p_period_id and pp.organization_id=private.current_org() for update;
  if not found then raise exception 'PERIOD_NOT_FOUND'; end if;
  if v_period.status='paid' then raise exception 'PAYROLL_ALREADY_PAID'; end if;
  if v_period.status='locked' then return v_period; end if;

  if exists(select 1 from public.payroll_lines l where l.period_id=p_period_id and (l.confidence='pending' or l.pending_minutes>0)) then
    raise exception 'PAYROLL_HAS_PENDING_ITEMS';
  end if;

  update public.payroll_lines l
  set snapshot_payroll_type=p.payroll_type,
      snapshot_rate=case when p.payroll_type='hourly'::public.payroll_type then p.hourly_rate else p.monthly_salary end,
      snapshot_rules=jsonb_build_object(
        'standard_monthly_days',s.standard_monthly_days,
        'standard_daily_hours',s.standard_daily_hours,
        'rounding_minutes',s.rounding_minutes,
        'grace_minutes',s.grace_minutes,
        'ot_multiplier',1.5
      ),
      is_locked=true,locked_at=now()
  from public.profiles p cross join public.settings s
  where l.period_id=p_period_id and l.employee_id=p.id and s.organization_id=l.organization_id;

  update public.payroll_periods
  set status='locked',locked_at=now(),locked_by=(select auth.uid())
  where id=p_period_id returning * into v_result;

  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data)
  values(v_period.organization_id,(select auth.uid()),'lock_payroll_period','payroll_periods',v_result.id::text,to_jsonb(v_result));
  return v_result;
end;
$$;
revoke execute on function public.lock_payroll_period(uuid) from public,anon;
grant execute on function public.lock_payroll_period(uuid) to authenticated;

create or replace function private.prevent_locked_payroll_line_change()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
  if old.is_locked then raise exception 'PAYROLL_LINE_LOCKED'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke execute on function private.prevent_locked_payroll_line_change() from public,anon;
grant execute on function private.prevent_locked_payroll_line_change() to authenticated;

drop trigger if exists payroll_lines_locked_guard on public.payroll_lines;
create trigger payroll_lines_locked_guard
before update or delete on public.payroll_lines
for each row execute function private.prevent_locked_payroll_line_change();
