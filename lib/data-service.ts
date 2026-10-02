import { supabase, hasSupabase } from './supabase';

const AUTH_EMAIL_DOMAIN = 'auth.meehoasg.com';

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
  status: 'scheduled' | 'in_progress' | 'completed' | 'exception' | 'approved' | 'cancelled';
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

export interface DbPayrollPeriod {
  id: string;
  organization_id: string;
  starts_on: string;
  ends_on: string;
  status: 'draft' | 'review' | 'locked' | 'paid';
  locked_at?: string | null;
  locked_by?: string | null;
}

export interface DbPayrollLine {
  id: string;
  period_id: string;
  organization_id: string;
  employee_id: string;
  regular_minutes: number;
  overtime_minutes: number;
  pending_minutes: number;
  base_amount: number;
  adjustment_amount: number;
  pending_amount: number;
  gross_amount: number;
  confidence: 'ready' | 'pending';
  is_locked: boolean;
}

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

export interface ProvisionStaffInput {
  employeeCode: string;
  fullName: string;
  role: 'admin' | 'employee';
  payrollType: 'hourly' | 'monthly';
  hourlyRate: number;
  monthlySalary: number;
  effectiveDate: string;
  phone?: string;
  password?: string;
}

export interface ProvisionStaffResult {
  profile: DbProfile;
  employeeCode: string;
  temporaryPassword: string;
}

function normalizeLoginId(loginId: string) {
  return loginId.trim().toLowerCase();
}

// Auth helpers
export async function getSession() {
  if (!hasSupabase || !supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session;
}

export async function signIn(loginId: string, pass: string) {
  if (!hasSupabase || !supabase) {
    throw new Error('Supabase chưa được cấu hình');
  }

  const identifier = loginId.trim();
  if (identifier.includes('@')) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizeLoginId(identifier),
      password: pass,
    });
    if (error) throw error;
    return data;
  }

  const { data: loginData, error: loginError } = await supabase.functions.invoke('employee-login', {
    body: { employeeCode: identifier.toUpperCase(), password: pass },
  });
  if (loginError || !loginData?.access_token || !loginData?.refresh_token) {
    throw new Error('Invalid login credentials');
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: loginData.access_token,
    refresh_token: loginData.refresh_token,
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
    .eq('active', true)
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

export async function updateStaffProfile(
  profileId: string,
  updates: Partial<DbProfile>,
): Promise<DbProfile | null> {
  if (!hasSupabase || !supabase) return null;

  const current = await fetchProfile(profileId);
  if (!current) throw new Error('Không tìm thấy hồ sơ nhân viên');

  const basicUpdates: Partial<DbProfile> = { ...updates };
  delete basicUpdates.payroll_type;
  delete basicUpdates.hourly_rate;
  delete basicUpdates.monthly_salary;
  delete basicUpdates.effective_date;

  let result: DbProfile = current;
  if (Object.keys(basicUpdates).length > 0) {
    const { data, error } = await supabase
      .from('profiles')
      .update(basicUpdates)
      .eq('id', profileId)
      .select()
      .single();
    if (error) {
      console.error('Error updating staff profile:', error);
      throw error;
    }
    result = data as DbProfile;
  }

  const compensationChanged =
    updates.payroll_type !== undefined ||
    updates.hourly_rate !== undefined ||
    updates.monthly_salary !== undefined ||
    updates.effective_date !== undefined;

  if (compensationChanged) {
    const payrollType = updates.payroll_type ?? current.payroll_type;
    const { data, error } = await supabase.rpc('save_staff_compensation', {
      p_employee_id: profileId,
      p_payroll_type: payrollType,
      p_hourly_rate: updates.hourly_rate ?? current.hourly_rate ?? 0,
      p_monthly_salary: updates.monthly_salary ?? current.monthly_salary ?? 0,
      p_effective_date: updates.effective_date ?? current.effective_date ?? new Date().toISOString().slice(0, 10),
      p_note: 'Điều chỉnh mức lương từ MEEHOA TIME',
    });
    if (error) {
      console.error('Error saving compensation history:', error);
      throw error;
    }
    result = { ...result, ...(data as DbProfile) };
  }

  return result;
}

export async function provisionStaff(
  staff: ProvisionStaffInput,
): Promise<ProvisionStaffResult> {
  if (!hasSupabase || !supabase) throw new Error('Supabase client unavailable');
  const { data, error } = await supabase.functions.invoke('admin-staff', {
    body: { action: 'create', staff },
  });
  if (error) throw error;
  if (!data?.profile || !data?.temporaryPassword) {
    throw new Error(data?.error || 'Không tạo được tài khoản nhân viên');
  }
  return data as ProvisionStaffResult;
}

export async function bulkProvisionStaff(
  staff: ProvisionStaffInput[],
): Promise<{
  created: ProvisionStaffResult[];
  failed: Array<{ employeeCode: string; error: string }>;
}> {
  if (!hasSupabase || !supabase) throw new Error('Supabase client unavailable');
  const { data, error } = await supabase.functions.invoke('admin-staff', {
    body: { action: 'bulk_create', staff },
  });
  if (error) throw error;
  if (!data) throw new Error('Không nhận được kết quả tạo tài khoản hàng loạt');
  return data;
}

export async function resetStaffPassword(employeeCode: string) {
  if (!hasSupabase || !supabase) throw new Error('Supabase client unavailable');
  const { data, error } = await supabase.functions.invoke('admin-staff', {
    body: { action: 'reset_password', employeeCode },
  });
  if (error) throw error;
  if (!data?.temporaryPassword) throw new Error(data?.error || 'Không reset được mật khẩu');
  return data as { employeeCode: string; temporaryPassword: string };
}

// Locations & Settings
export async function fetchShopLocation(): Promise<DbLocation | null> {
  if (!hasSupabase || !supabase) return null;
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('active', true)
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as DbLocation;
}

export async function updateShopLocation(
  locationId: string,
  updates: Partial<DbLocation>,
): Promise<void> {
  if (!hasSupabase || !supabase) return;
  const { error } = await supabase.from('locations').update(updates).eq('id', locationId);
  if (error) {
    console.error('Error updating location:', error);
    throw error;
  }
}

export async function fetchShopSettings(): Promise<DbSettings | null> {
  if (!hasSupabase || !supabase) return null;
  const { data, error } = await supabase.from('settings').select('*').limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0] as DbSettings;
}

export async function updateShopSettings(
  organizationId: string,
  updates: Partial<DbSettings>,
): Promise<void> {
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

// Attendance
export async function fetchTodayAttendance(
  employeeId: string,
): Promise<DbAttendanceEvent[]> {
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

export async function fetchAttendanceShift(
  employeeId: string,
): Promise<DbShift | null> {
  if (!hasSupabase || !supabase) return null;

  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const windowStart = new Date(start);
  windowStart.setDate(windowStart.getDate() - 1);

  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('employee_id', employeeId)
    .neq('status', 'cancelled')
    .gte('starts_at', windowStart.toISOString())
    .gte('ends_at', start.toISOString())
    .lt('starts_at', end.toISOString())
    .order('starts_at');

  if (error || !data || data.length === 0) return null;
  const shifts = data as DbShift[];
  const inProgress = shifts.find((shift) => shift.status === 'in_progress');
  if (inProgress) return inProgress;

  const nowMs = now.getTime();
  const matching = shifts.find((shift) => {
    const starts = new Date(shift.starts_at).getTime() - 3 * 60 * 60 * 1000;
    const ends = new Date(shift.ends_at).getTime() + 3 * 60 * 60 * 1000;
    return nowMs >= starts && nowMs <= ends;
  });
  if (matching) return matching;

  return (
    shifts.find((shift) => {
      const starts = new Date(shift.starts_at).getTime();
      return starts >= start.getTime() && starts < end.getTime();
    }) || null
  );
}

export async function recordAttendance(event: {
  organizationId: string;
  employeeId: string;
  shiftId?: string | null;
  event: 'check_in' | 'check_out';
  lat: number;
  lng: number;
  accuracy: number;
  distance?: number;
  withinGeofence?: boolean;
  userAgent?: string;
  note?: string;
}): Promise<DbAttendanceEvent> {
  if (!hasSupabase || !supabase) {
    throw new Error('Supabase client unavailable');
  }

  const shift = event.shiftId
    ? ({ id: event.shiftId } as Pick<DbShift, 'id'>)
    : await fetchAttendanceShift(event.employeeId);
  if (!shift) {
    throw new Error('NO_SCHEDULED_SHIFT');
  }

  const idempotencyKey =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `punch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const { data, error } = await supabase.rpc('capture_attendance', {
    p_shift_id: shift.id,
    p_event: event.event,
    p_lat: event.lat,
    p_lng: event.lng,
    p_accuracy: event.accuracy,
    p_idempotency_key: idempotencyKey,
    p_client_time: new Date().toISOString(),
    p_user_agent:
      event.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : null),
    p_note: event.note || null,
  });

  if (error) {
    console.error('capture_attendance RPC error:', error);
    throw error;
  }
  if (!data) throw new Error('Không nhận được kết quả chấm công');
  return data as DbAttendanceEvent;
}

// Shifts & Scheduling
export async function fetchShiftsForRange(
  organizationId: string,
  startIso: string,
  endIso: string,
  employeeId?: string,
): Promise<DbShift[]> {
  if (!hasSupabase || !supabase) return [];
  let query = supabase
    .from('shifts')
    .select('*')
    .eq('organization_id', organizationId)
    .gte('starts_at', startIso)
    .lte('ends_at', endIso)
    .order('starts_at');

  if (employeeId) query = query.eq('employee_id', employeeId);

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
  affectedEmployeeIds: string[],
): Promise<void> {
  if (!hasSupabase || !supabase) return;

  const location = await fetchShopLocation();
  if (!location) throw new Error('Chưa cấu hình chi nhánh chấm công');

  for (const empId of affectedEmployeeIds) {
    const { error: delError } = await supabase
      .from('shifts')
      .delete()
      .eq('organization_id', organizationId)
      .eq('employee_id', empId)
      .gte('starts_at', rangeStartIso)
      .lte('ends_at', rangeEndIso);

    if (delError) throw delError;
  }

  if (shiftsToInsert.length > 0) {
    const payload = shiftsToInsert.map((s) => ({
      organization_id: organizationId,
      employee_id: s.employee_id,
      location_id: s.location_id || location.id,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      note: s.note || null,
      status: 'scheduled' as const,
      regular_minutes: 0,
      overtime_minutes: 0,
      pending_minutes: 0,
      source: 'manual',
      created_by: actorId,
    }));

    const { error: insError } = await supabase.from('shifts').insert(payload);
    if (insError) throw insError;
  }

  await logAudit(organizationId, actorId, 'save_schedule', 'shifts', organizationId, {
    count: shiftsToInsert.length,
    rangeStart: rangeStartIso,
    rangeEnd: rangeEndIso,
  });
}

// Approvals
export async function fetchPendingApprovals(
  organizationId: string,
): Promise<ApprovalItemData[]> {
  if (!hasSupabase || !supabase) return [];

  const items: ApprovalItemData[] = [];

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
        reason: ot.reason || 'Checkout sau giờ ca',
        requestedPayable: `+${Math.round((ot.requested_minutes || 0) / 6) / 10}h`,
        proposedMinutes: ot.requested_minutes || 0,
        status:
          ot.status === 'submitted' || ot.status === 'open'
            ? 'pending'
            : (ot.status as 'approved' | 'rejected'),
      });
    }
  }

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
      const typeLabel =
        exc.kind === 'late'
          ? 'Đi trễ'
          : exc.kind === 'early_leave'
            ? 'Về sớm'
            : exc.kind === 'outside_geofence'
              ? 'Ngoài vùng shop'
              : exc.kind === 'low_gps_accuracy'
                ? 'GPS chưa đủ chính xác'
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
        evidence: exc.minutes ? `${exc.minutes} phút` : 'Hệ thống phát hiện',
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
  organizationId: string,
): Promise<void> {
  if (!hasSupabase || !supabase) return;

  if (item.kind === 'overtime') {
    const { error } = await supabase.rpc('review_overtime', {
      p_ot_id: item.id,
      p_decision: approved ? 'approved' : 'rejected',
      p_approved_minutes: approved ? item.proposedMinutes || 0 : 0,
      p_note: approved ? 'Duyệt từ MEEHOA TIME' : 'Từ chối từ MEEHOA TIME',
    });
    if (error) throw error;
  } else {
    const { error } = await supabase.rpc('review_attendance_exception', {
      p_exception_id: item.id,
      p_decision: approved ? 'approved' : 'rejected',
      p_review_note: approved
        ? 'Duyệt và khôi phục Payable từ MEEHOA TIME'
        : 'Từ chối từ MEEHOA TIME',
    });
    if (error) throw error;
  }

  await logAudit(organizationId, actorId, approved ? 'approve' : 'reject', item.kind, item.id, {
    itemKind: item.kind,
    employeeId: item.employeeId,
  });
}

// Payroll
export async function refreshPayrollPeriod(
  periodId?: string | null,
): Promise<DbPayrollPeriod | null> {
  if (!hasSupabase || !supabase) return null;
  const { data, error } = await supabase.rpc('refresh_payroll_period', {
    p_period_id: periodId || null,
  });
  if (error) throw error;
  return (data as DbPayrollPeriod | null) || null;
}

export async function fetchCurrentPayrollPeriod(
  organizationId: string,
): Promise<DbPayrollPeriod | null> {
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

export async function fetchPayrollLines(periodId: string): Promise<DbPayrollLine[]> {
  if (!hasSupabase || !supabase) return [];
  const { data, error } = await supabase
    .from('payroll_lines')
    .select('*')
    .eq('period_id', periodId)
    .order('employee_id');
  if (error) throw error;
  return (data || []) as DbPayrollLine[];
}

export async function lockPayroll(periodId: string): Promise<void> {
  if (!hasSupabase || !supabase) return;
  const { error } = await supabase.rpc('lock_payroll_period', {
    p_period_id: periodId,
  });
  if (error) throw error;
}

// Audit Log helper
export async function logAudit(
  organizationId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Record<string, unknown>,
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
