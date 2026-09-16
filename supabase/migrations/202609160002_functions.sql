create or replace function public.capture_attendance(p_shift_id uuid, p_event public.event_type, p_lat double precision, p_lng double precision, p_accuracy double precision, p_idempotency_key text)
returns public.attendance_events language plpgsql security definer set search_path=public as $$
declare v_shift public.shifts; v_location public.locations; v_distance double precision; v_event public.attendance_events;
begin
  select * into v_shift from public.shifts where id=p_shift_id and employee_id=auth.uid();
  if not found then raise exception 'SHIFT_NOT_FOUND'; end if;
  select * into v_location from public.locations where id=v_shift.location_id;
  if found and p_lat is not null and p_lng is not null then
    v_distance := 6371000 * 2 * asin(sqrt(power(sin(radians(p_lat-v_location.latitude)/2),2)+cos(radians(v_location.latitude))*cos(radians(p_lat))*power(sin(radians(p_lng-v_location.longitude)/2),2)));
  end if;
  insert into public.attendance_events(organization_id,employee_id,shift_id,event,latitude,longitude,accuracy_meters,distance_meters,within_geofence,idempotency_key)
  values(v_shift.organization_id,auth.uid(),p_shift_id,p_event,p_lat,p_lng,p_accuracy,v_distance,(v_distance is null or v_distance<=v_location.radius_meters),p_idempotency_key)
  returning * into v_event;
  update public.shifts set status=case when p_event='check_in' then 'in_progress'::public.shift_status else 'completed'::public.shift_status end, updated_at=now() where id=p_shift_id;
  insert into public.audit_logs(organization_id,actor_id,action,entity_type,entity_id,after_data) values(v_shift.organization_id,auth.uid(),p_event::text,'attendance_event',v_event.id::text,to_jsonb(v_event));
  return v_event;
end $$;
grant execute on function public.capture_attendance(uuid,public.event_type,double precision,double precision,double precision,text) to authenticated;

create or replace view public.payroll_fund_realtime with (security_invoker=true) as
select organization_id, period_id, coalesce(sum(gross_amount),0) confirmed_amount, coalesce(sum(pending_amount),0) pending_amount,
       count(*) filter(where confidence='pending') pending_people
from public.payroll_lines group by organization_id,period_id;
