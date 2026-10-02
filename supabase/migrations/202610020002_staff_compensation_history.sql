create or replace function public.save_staff_compensation(
  p_employee_id uuid,
  p_payroll_type public.payroll_type,
  p_hourly_rate numeric,
  p_monthly_salary numeric,
  p_effective_date date,
  p_note text default 'Điều chỉnh mức lương'
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
begin
  if not public.is_manager() then
    raise exception 'PERMISSION_DENIED_NOT_MANAGER';
  end if;

  update public.profiles
  set payroll_type = p_payroll_type,
      hourly_rate = case when p_payroll_type = 'hourly' then greatest(0, coalesce(p_hourly_rate, 0)) else 0 end,
      monthly_salary = case when p_payroll_type = 'monthly' then greatest(0, coalesce(p_monthly_salary, 0)) else 0 end,
      effective_date = p_effective_date,
      updated_at = now()
  where id = p_employee_id
    and organization_id = public.current_org()
  returning * into v_profile;

  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  insert into public.wage_histories(
    organization_id, employee_id, payroll_type,
    hourly_rate, monthly_salary, effective_date, note, created_by
  ) values (
    v_profile.organization_id, v_profile.id, v_profile.payroll_type,
    v_profile.hourly_rate, v_profile.monthly_salary,
    p_effective_date, p_note, auth.uid()
  );

  insert into public.audit_logs(
    organization_id, actor_id, action, entity_type, entity_id, after_data
  ) values (
    v_profile.organization_id, auth.uid(), 'update_compensation',
    'profiles', v_profile.id::text, to_jsonb(v_profile)
  );

  return v_profile;
end;
$$;

revoke execute on function public.save_staff_compensation(uuid, public.payroll_type, numeric, numeric, date, text) from public, anon;
grant execute on function public.save_staff_compensation(uuid, public.payroll_type, numeric, numeric, date, text) to authenticated;
