import { supabase, hasSupabase } from './supabase';

export interface DbProfile {
  id: string;
  organization_id: string;
  employee_code: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: 'owner' | 'admin' | 'employee';
  active: boolean;
  payroll_type: 'hourly' | 'monthly';
  hourly_rate: number | null;
  monthly_salary: number | null;
  effective_date: string | null;
  location_id: string | null;
}

export interface DbLocation {
  id: string;
  organization_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  active: boolean;
}

export interface DbSettings {
  organization_id: string;
  grace_minutes: number;
  require_geofence: boolean;
  require_ot_approval: boolean;
  hold_incomplete_attendance: boolean;
  standard_monthly_days: number;
  standard_daily_hours: number;
  rounding_minutes: number;
  max_gps_accuracy_meters: number;
}

export interface DbShift {
  id: string;
  organization_id: string;
  employee_id: string;
  location_id: string | null;
  template_id?: string | null;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  note: string | null;
  status: 'scheduled' | 'completed' | 'cancelled' | 'pending_approval';
  payable_start?: string | null;
  payable_end?: string | null;
  regular_minutes: number;
  overtime_minutes: number;
  pending_minutes: number;
  source: string;
}

export interface DbAttendanceEvent {
  id: string;
  organization_id: string;
  employee_id: string;
  shift_id: string | null;
  event: 'check_in' | 'check_out';
  occurred_at: string;
  client_occurred_at: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  distance_meters: number | null;
  within_geofence: boolean | null;
  device_id: string | null;
  idempotency_key: string;
  user_agent: string | null;
  exception_note: string | null;
}

// Auth helpers
export async function getSession() {
  if (!hasSupabase || !supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session;
}

export async function signIn(email: string, pass: string) {
  if (!hasSupabase || !supabase) {
    throw new Error('Supabase chưa được cấu hình');
  }
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: pass,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!hasSupabase || !supabase) return;
  await supabase.auth.signOut();
}

// Profiles
export async function fetchProfile(userId: string): Promise<DbProfile | null> {
  if (!hasSupabase || !supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  return data as DbProfile;
}

export async function fetchStaffProfiles(): Promise<DbProfile[]> {
  if (!hasSupabase || !supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('employee_code');
  if (error || !data) return [];
  return data as DbProfile[];
}

export async function createStaffProfile(profile: Partial<DbProfile>): Promise<DbProfile | null> {
  if (!hasSupabase || !supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .insert(profile)
    .select()
    .single();
  if (error) {
    console.error('Error creating staff profile:', error);
    throw error;
  }
  return data as DbProfile;
}

export async function updateStaffProfile(profileId: string, updates: Partial<DbProfile>): Promise<DbProfile | null> {
  if (!hasSupabase || !supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', profileId)
    .select()
    .single();
  if (error) {
    console.error('Error updating staff profile:', error);
    throw error;
  }
  return data as DbProfile;
}

// Locations & Settings
export async function fetchShopLocation(): Promise<DbLocation | null> {
  if (!hasSupabase || !supabase) return null;
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as DbLocation;
}

export async function updateShopLocation(locationId: string, updates: Partial<DbLocation>): Promise<void> {
  if (!hasSupabase || !supabase) return;
  const { error } = await supabase
    .from('locations')
    .update(updates)
    .eq('id', locationId);
  if (error) {
    console.error('Error updating location:', error);
    throw error;
  }
}

export async function fetchShopSettings(): Promise<DbSettings | null> {
  if (!hasSupabase || !supabase) return null;
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as DbSettings;
}

export async function updateShopSettings(organizationId: string, updates: Partial<DbSettings>): Promise<void> {
  if (!hasSupabase || !supabase) return;
  const { error } = await supabase
    .from('settings')
    .update(updates)
    .eq('organization_id', organizationId);
  if (error) {
    console.error('Error updating settings:', error);
    throw error;
  }
}

// Attendance (Chấm công)
export async function fetchTodayAttendance(employeeId: string): Promise<DbAttendanceEvent[]> {
  if (!hasSupabase || !supabase) return [];
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('attendance_events')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('occurred_at', startOfDay.toISOString())
    .order('occurred_at', { ascending: false });

  if (error || !data) return [];
  return data as DbAttendanceEvent[];
}

export async function recordAttendance(event: {
  organizationId: string;
  employeeId: string;
  shiftId?: string | null;
  event: 'check_in' | 'check_out';
  lat: number;
  lng: number;
  accuracy: number;
  distance: number;
  withinGeofence: boolean;
  userAgent?: string;
  note?: string;
}): Promise<DbAttendanceEvent> {
  if (!hasSupabase || !supabase) {
    throw new Error('Supabase client unavailable');
  }

  const idempotencyKey = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `punch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const nowIso = new Date().toISOString();

  const insertPayload = {
    organization_id: event.organizationId,
    employee_id: event.employeeId,
    shift_id: event.shiftId || null,
    event: event.event,
    occurred_at: nowIso,
    client_occurred_at: nowIso,
    latitude: event.lat,
    longitude: event.lng,
    accuracy_meters: event.accuracy,
    distance_meters: event.distance,
    within_geofence: event.withinGeofence,
    idempotency_key: idempotencyKey,
    user_agent: event.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : null),
    exception_note: event.note || null,
  };

  const { data, error } = await supabase
    .from('attendance_events')
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    console.error('Error inserting attendance event:', error);
    throw error;
  }

  // If outside geofence and shift exists, log exception
  if (!event.withinGeofence && event.shiftId) {
    try {
      await supabase.from('attendance_exceptions').insert({
        organization_id: event.organizationId,
        employee_id: event.employeeId,
        shift_id: event.shiftId,
        kind: 'outside_geofence',
        status: 'open',
      });
    } catch (e) {
      console.warn('Failed to log attendance exception:', e);
    }
  }

  return data as DbAttendanceEvent;
}

// Shifts & Scheduling
export async function fetchShiftsForRange(
  organizationId: string,
  startIso: string,
  endIso: string,
  employeeId?: string
): Promise<DbShift[]> {
  if (!hasSupabase || !supabase) return [];
  let query = supabase
    .from('shifts')
    .select('*')
    .eq('organization_id', organizationId)
    .gte('starts_at', startIso)
    .lte('ends_at', endIso)
    .order('starts_at');

  if (employeeId) {
    query = query.eq('employee_id', employeeId);
  }

  const { data, error } = await query;
  if (error || !data) return [];
  return data as DbShift[];
}

export async function saveWeeklyShifts(
  organizationId: string,
  actorId: string,
  shiftsToInsert: Array<{
    employee_id: string;
    location_id: string | null;
    starts_at: string;
    ends_at: string;
    note?: string;
  }>,
  rangeStartIso: string,
  rangeEndIso: string,
  affectedEmployeeIds: string[]
): Promise<void> {
  if (!hasSupabase || !supabase) return;

  // 1. Delete existing shifts in this range for these employees
  for (const empId of affectedEmployeeIds) {
    const { error: delError } = await supabase
      .from('shifts')
      .delete()
      .eq('organization_id', organizationId)
      .eq('employee_id', empId)
      .gte('starts_at', rangeStartIso)
      .lte('ends_at', rangeEndIso);

    if (delError) {
      console.warn('Error clearing old shifts for employee:', empId, delError);
    }
  }

  // 2. Insert new shifts
  if (shiftsToInsert.length > 0) {
    const payload = shiftsToInsert.map((s) => ({
      organization_id: organizationId,
      employee_id: s.employee_id,
      location_id: s.location_id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      status: 'scheduled' as const,
      regular_minutes: 0,
      overtime_minutes: 0,
      pending_minutes: 0,
      source: 'manual',
      created_by: actorId,
    }));

    const { error: insError } = await supabase.from('shifts').insert(payload);
    if (insError) {
      console.error('Error inserting new shifts:', insError);
      throw insError;
    }
  }

  // 3. Log audit
  await logAudit(organizationId, actorId, 'save_schedule', 'shifts', organizationId, {
    count: shiftsToInsert.length,
    rangeStart: rangeStartIso,
    rangeEnd: rangeEndIso,
  });
}

// Approvals (Exceptions & Overtime)
export interface ApprovalItemData {
  id: string;
  shiftId: string;
  employeeId: string;
  employeeName: string;
  kind: 'exception' | 'overtime';
  typeLabel: string;
  dateStr: string;
  shiftTime: string;
  actualTimes?: string;
  evidence: string;
  reason: string;
  requestedPayable: string;
  proposedMinutes?: number;
  status: 'pending' | 'approved' | 'rejected';
}

export async function fetchPendingApprovals(organizationId: string): Promise<ApprovalItemData[]> {
  if (!hasSupabase || !supabase) return [];

  const items: ApprovalItemData[] = [];

  // Overtime requests
  const { data: ots } = await supabase
    .from('overtime_requests')
    .select('*, profiles(full_name), shifts(starts_at, ends_at)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  if (ots) {
    for (const ot of ots) {
      const shift = ot.shifts as { starts_at?: string; ends_at?: string } | null;
      const profile = ot.profiles as { full_name?: string } | null;
      const sStart = shift?.starts_at ? new Date(shift.starts_at) : new Date();
      const sEnd = shift?.ends_at ? new Date(shift.ends_at) : new Date();
      items.push({
        id: ot.id,
        shiftId: ot.shift_id,
        employeeId: ot.employee_id,
        employeeName: profile?.full_name || 'Nhân viên',
        kind: 'overtime',
        typeLabel: 'Tăng ca (OT)',
        dateStr: sStart.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
        shiftTime: `${sStart.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}–${sEnd.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`,
        evidence: `Đề xuất +${ot.requested_minutes || 0} phút`,
        reason: ot.reason || 'Tăng ca hỗ trợ đơn hoa',
        requestedPayable: `+${Math.round((ot.requested_minutes || 0) / 6) / 10}h`,
        proposedMinutes: ot.requested_minutes || 0,
        status: ot.status as 'pending' | 'approved' | 'rejected',
      });
    }
  }

  // Attendance exceptions
  const { data: excs } = await supabase
    .from('attendance_exceptions')
    .select('*, profiles(full_name), shifts(starts_at, ends_at)')
    .eq('organization_id', organizationId)
    .order('detected_at', { ascending: false });

  if (excs) {
    for (const exc of excs) {
      const shift = exc.shifts as { starts_at?: string; ends_at?: string } | null;
      const profile = exc.profiles as { full_name?: string } | null;
      const sStart = shift?.starts_at ? new Date(shift.starts_at) : new Date();
      const sEnd = shift?.ends_at ? new Date(shift.ends_at) : new Date();
      const typeLabel = exc.kind === 'late'
        ? 'Đi trễ'
        : exc.kind === 'early_leave'
          ? 'Về sớm'
          : exc.kind === 'outside_geofence'
            ? 'Ngoài vùng shop'
            : 'Chưa đủ lượt chấm';
      items.push({
        id: exc.id,
        shiftId: exc.shift_id,
        employeeId: exc.employee_id,
        employeeName: profile?.full_name || 'Nhân viên',
        kind: 'exception',
        typeLabel,
        dateStr: sStart.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
        shiftTime: `${sStart.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}–${sEnd.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`,
        evidence: exc.minutes ? `${exc.minutes} phút` : 'Vi phạm geofence',
        reason: 'Hệ thống tự động phát hiện',
        requestedPayable: 'Cần xem xét',
        proposedMinutes: exc.minutes || 0,
        status: exc.status === 'open' ? 'pending' : (exc.status as 'approved' | 'rejected'),
      });
    }
  }

  return items;
}

export async function reviewApproval(
  item: ApprovalItemData,
  approved: boolean,
  actorId: string,
  organizationId: string
): Promise<void> {
  if (!hasSupabase || !supabase) return;

  const nowIso = new Date().toISOString();

  if (item.kind === 'overtime') {
    const status = approved ? 'approved' : 'rejected';
    const approvedMins = approved ? (item.proposedMinutes || 0) : 0;

    await supabase
      .from('overtime_requests')
      .update({
        status,
        approved_minutes: approvedMins,
        reviewed_by: actorId,
        reviewed_at: nowIso,
      })
      .eq('id', item.id);

    if (approved && item.shiftId) {
      await supabase
        .from('shifts')
        .update({ overtime_minutes: approvedMins })
        .eq('id', item.shiftId);
    }
  } else {
    await supabase
      .from('attendance_exceptions')
      .update({
        status: approved ? 'approved' : 'rejected',
        resolved_at: nowIso,
      })
      .eq('id', item.id);
  }

  await logAudit(organizationId, actorId, approved ? 'approve' : 'reject', item.kind, item.id, {
    itemKind: item.kind,
    employeeId: item.employeeId,
  });
}

// Payroll Periods & Lines
export interface DbPayrollPeriod {
  id: string;
  organization_id: string;
  starts_on: string;
  ends_on: string;
  status: 'draft' | 'locked' | 'paid';
  locked_at?: string | null;
  locked_by?: string | null;
}

export async function fetchCurrentPayrollPeriod(organizationId: string): Promise<DbPayrollPeriod | null> {
  if (!hasSupabase || !supabase) return null;
  const { data, error } = await supabase
    .from('payroll_periods')
    .select('*')
    .eq('organization_id', organizationId)
    .order('starts_on', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return data[0] as DbPayrollPeriod;
}

export async function lockPayroll(
  periodId: string,
  organizationId: string,
  actorId: string
): Promise<void> {
  if (!hasSupabase || !supabase) return;
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('payroll_periods')
    .update({
      status: 'locked',
      locked_at: nowIso,
      locked_by: actorId,
    })
    .eq('id', periodId);

  if (error) {
    console.error('Error locking payroll period:', error);
    throw error;
  }

  await logAudit(organizationId, actorId, 'lock_payroll', 'payroll_period', periodId, { lockedAt: nowIso });
}

// Audit Log helper
export async function logAudit(
  organizationId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!hasSupabase || !supabase) return;
  try {
    await supabase.from('audit_logs').insert({
      organization_id: organizationId,
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata: metadata || {},
    });
  } catch (err) {
    console.warn('Failed to insert audit log:', err);
  }
}
