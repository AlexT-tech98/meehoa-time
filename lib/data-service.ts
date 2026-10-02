import { supabase, hasSupabase } from './supabase';

export type AppRole = 'owner' | 'admin' | 'employee';
export type PayrollType = 'hourly' | 'monthly';

export interface DbProfile {
  id: string;
  organization_id: string;
  employee_code: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: AppRole;
  active: boolean;
  payroll_type: PayrollType;
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

export interface ApprovalItemData {
  id: string;
  shiftId: string;
  employeeId: string;
  employeeName: string;
  kind: 'exception' | 'overtime';
  typeLabel: string;
  dateStr: string;
  shiftTime: string;
  evidence: string;
  reason: string;
  requestedPayable: string;
  proposedMinutes?: number;
  status: 'pending' | 'approved' | 'rejected';
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

export interface PayrollLineView {
  id: string;
  periodId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  payrollType: PayrollType;
  regularMinutes: number;
  overtimeMinutes: number;
  pendingMinutes: number;
  baseAmount: number;
  overtimeAmount: number;
  pendingAmount: number;
  grossAmount: number;
  confidence: 'ready' | 'pending';
  isLocked: boolean;
  periodStatus?: string;
  startsOn?: string;
  endsOn?: string;
}

export interface StaffProvisionRequest {
  employeeCode: string;
  fullName: string;
  role?: 'employee' | 'admin';
  payrollType?: PayrollType;
  hourlyRate?: number;
  monthlySalary?: number;
  effectiveDate?: string;
  password?: string;
}

export interface ProvisionedCredential {
  employeeCode: string;
  fullName: string;
  password: string;
}

export interface StaffProvisionResult {
  created: ProvisionedCredential[];
  errors: Array<{ row: number; employeeCode?: string; error: string }>;
}

function requireClient() {
  if (!hasSupabase || !supabase) throw new Error('Supabase chưa được cấu hình');
  return supabase;
}

export function loginIdToEmail(loginId: string): string {
  const id = loginId.trim().toLowerCase();
  if (id.includes('@')) return id;
  return `${id}@auth.meehoasg.com`;
}

export async function getSession() {
  if (!hasSupabase || !supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  return data.session;
}

export async function signIn(loginId: string, pass: string) {
  const client = requireClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: loginIdToEmail(loginId),
    password: pass,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!hasSupabase || !supabase) return;
  await supabase.auth.signOut();
}

export async function fetchProfile(userId: string): Promise<DbProfile | null> {
  if (!hasSupabase || !supabase) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error || !data) return null;
  return data as DbProfile;
}

export async function fetchStaffProfiles(): Promise<DbProfile[]> {
  if (!hasSupabase || !supabase) return [];
  const { data, error } = await supabase.from('profiles').select('*').eq('active', true).order('employee_code');
  if (error || !data) return [];
  return data as DbProfile[];
}

export async function updateStaffProfile(profileId: string, updates: Partial<DbProfile>): Promise<DbProfile> {
  const client = requireClient();
  const before = await fetchProfile(profileId);
  const { data, error } = await client.from('profiles').update(updates).eq('id', profileId).select().single();
  if (error || !data) throw error ?? new Error('Không cập nhật được nhân viên');
  const updated = data as DbProfile;

  if (
    before &&
    (before.payroll_type !== updated.payroll_type ||
      Number(before.hourly_rate || 0) !== Number(updated.hourly_rate || 0) ||
      Number(before.monthly_salary || 0) !== Number(updated.monthly_salary || 0))
  ) {
    const session = await getSession();
    await client.from('wage_histories').insert({
      organization_id: updated.organization_id,
      employee_id: updated.id,
      payroll_type: updated.payroll_type,
      hourly_rate: updated.hourly_rate || 0,
      monthly_salary: updated.monthly_salary || 0,
      effective_date: updated.effective_date || new Date().toISOString().slice(0, 10),
      note: 'Điều chỉnh từ MEEHOA TIME',
      created_by: session?.user?.id || null,
    });
  }
  return updated;
}

export async function fetchShopLocation(): Promise<DbLocation | null> {
  if (!hasSupabase || !supabase) return null;
  const { data, error } = await supabase.from('locations').select('*').eq('active', true).limit(1).maybeSingle();
  if (error || !data) return null;
  return data as DbLocation;
}

export async function updateShopLocation(locationId: string, updates: Partial<DbLocation>) {
  const client = requireClient();
  const { error } = await client.from('locations').update(updates).eq('id', locationId);
  if (error) throw error;
}

export async function fetchShopSettings(): Promise<DbSettings | null> {
  if (!hasSupabase || !supabase) return null;
  const { data, error } = await supabase.from('settings').select('*').limit(1).maybeSingle();
  if (error || !data) return null;
  return data as DbSettings;
}

export async function updateShopSettings(organizationId: string, updates: Partial<DbSettings>) {
  const client = requireClient();
  const { error } = await client.from('settings').update(updates).eq('organization_id', organizationId);
  if (error) throw error;
}

export async function fetchTodayAttendance(employeeId: string): Promise<DbAttendanceEvent[]> {
  if (!hasSupabase || !supabase) return [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const { data, error } = await supabase
    .from('attendance_events')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('occurred_at', start.toISOString())
    .lt('occurred_at', end.toISOString())
    .order('occurred_at');
  if (error || !data) return [];
  return data as DbAttendanceEvent[];
}

export async function fetchAttendanceForShift(shiftId: string): Promise<DbAttendanceEvent[]> {
  if (!hasSupabase || !supabase) return [];
  const { data, error } = await supabase
    .from('attendance_events')
    .select('*')
    .eq('shift_id', shiftId)
    .order('occurred_at');
  if (error || !data) return [];
  return data as DbAttendanceEvent[];
}

export async function recordAttendance(input: {
  shiftId: string;
  event: 'check_in' | 'check_out';
  lat: number;
  lng: number;
  accuracy: number;
  note?: string;
}): Promise<DbAttendanceEvent> {
  const client = requireClient();
  const idempotencyKey = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `punch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const { data, error } = await client.rpc('capture_attendance', {
    p_shift_id: input.shiftId,
    p_event: input.event,
    p_lat: input.lat,
    p_lng: input.lng,
    p_accuracy: input.accuracy,
    p_idempotency_key: idempotencyKey,
    p_client_time: new Date().toISOString(),
    p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    p_note: input.note || null,
  });
  if (error || !data) throw error ?? new Error('Không ghi nhận được chấm công');
  return data as DbAttendanceEvent;
}

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
    .lte('starts_at', endIso)
    .neq('status', 'cancelled')
    .order('starts_at');
  if (employeeId) query = query.eq('employee_id', employeeId);
  const { data, error } = await query;
  if (error || !data) return [];
  return data as DbShift[];
}

export async function fetchCurrentShift(employeeId: string): Promise<DbShift | null> {
  if (!hasSupabase || !supabase) return null;
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setHours(from.getHours() - 6);
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  to.setHours(to.getHours() + 6);

  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('employee_id', employeeId)
    .gte('starts_at', from.toISOString())
    .lte('starts_at', to.toISOString())
    .neq('status', 'cancelled')
    .order('starts_at');
  if (error || !data?.length) return null;

  const shifts = data as DbShift[];
  const inProgress = shifts.find((s) => s.status === 'in_progress');
  if (inProgress) return inProgress;
  const nowMs = now.getTime();
  const punchable = shifts.find((s) => {
    const start = new Date(s.starts_at).getTime() - 2 * 60 * 60 * 1000;
    const end = new Date(s.ends_at).getTime() + 6 * 60 * 60 * 1000;
    return nowMs >= start && nowMs <= end && s.status !== 'completed';
  });
  if (punchable) return punchable;
  return shifts.find((s) => new Date(s.starts_at).getTime() >= nowMs) || shifts.at(-1) || null;
}

export async function saveWeeklyShifts(
  organizationId: string,
  actorId: string,
  shiftsToInsert: Array<{ employee_id: string; location_id?: string | null; starts_at: string; ends_at: string; note?: string }>,
  rangeStartIso: string,
  rangeEndIso: string,
  affectedEmployeeIds: string[],
): Promise<void> {
  const client = requireClient();
  const location = await fetchShopLocation();
  if (!location) throw new Error('Chưa có chi nhánh hoạt động để gắn vào ca');

  for (const empId of affectedEmployeeIds) {
    const { error } = await client
      .from('shifts')
      .delete()
      .eq('organization_id', organizationId)
      .eq('employee_id', empId)
      .gte('starts_at', rangeStartIso)
      .lte('starts_at', rangeEndIso);
    if (error) throw error;
  }

  if (shiftsToInsert.length) {
    const { error } = await client.from('shifts').insert(
      shiftsToInsert.map((s) => ({
        organization_id: organizationId,
        employee_id: s.employee_id,
        location_id: s.location_id || location.id,
        starts_at: s.starts_at,
        ends_at: s.ends_at,
        note: s.note || null,
        status: 'scheduled',
        regular_minutes: 0,
        overtime_minutes: 0,
        pending_minutes: 0,
        source: 'manual',
        created_by: actorId,
      })),
    );
    if (error) throw error;
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export async function fetchPendingApprovals(organizationId: string): Promise<ApprovalItemData[]> {
  if (!hasSupabase || !supabase) return [];
  const items: ApprovalItemData[] = [];
  const { data: ots } = await supabase
    .from('overtime_requests')
    .select('*, profiles(full_name), shifts(starts_at, ends_at)')
    .eq('organization_id', organizationId)
    .in('status', ['open', 'submitted'])
    .order('created_at', { ascending: false });

  for (const ot of ots || []) {
    const profile = ot.profiles as { full_name?: string } | null;
    const shift = ot.shifts as { starts_at?: string; ends_at?: string } | null;
    const start = shift?.starts_at || new Date().toISOString();
    const end = shift?.ends_at || start;
    items.push({
      id: ot.id,
      shiftId: ot.shift_id,
      employeeId: ot.employee_id,
      employeeName: profile?.full_name || 'Nhân viên',
      kind: 'overtime',
      typeLabel: 'Tăng ca (OT)',
      dateStr: formatDate(start),
      shiftTime: `${formatTime(start)}–${formatTime(end)}`,
      evidence: `Check-out muộn ${ot.requested_minutes || 0} phút`,
      reason: ot.reason || 'Check-out sau giờ ca',
      requestedPayable: `+${Math.round(((ot.requested_minutes || 0) / 60) * 10) / 10}h`,
      proposedMinutes: ot.requested_minutes || 0,
      status: 'pending',
    });
  }

  const { data: excs } = await supabase
    .from('attendance_exceptions')
    .select('*, profiles(full_name), shifts(starts_at, ends_at)')
    .eq('organization_id', organizationId)
    .in('status', ['open', 'submitted'])
    .neq('kind', 'unscheduled_overtime')
    .order('detected_at', { ascending: false });

  const labels: Record<string, string> = {
    late: 'Đi trễ',
    early_leave: 'Về sớm',
    missing_check_in: 'Thiếu check-in',
    missing_check_out: 'Thiếu check-out',
    outside_geofence: 'Ngoài vùng shop',
    low_gps_accuracy: 'GPS không đủ chính xác',
  };
  for (const exc of excs || []) {
    const profile = exc.profiles as { full_name?: string } | null;
    const shift = exc.shifts as { starts_at?: string; ends_at?: string } | null;
    const start = shift?.starts_at || new Date().toISOString();
    const end = shift?.ends_at || start;
    items.push({
      id: exc.id,
      shiftId: exc.shift_id,
      employeeId: exc.employee_id,
      employeeName: profile?.full_name || 'Nhân viên',
      kind: 'exception',
      typeLabel: labels[exc.kind] || 'Ngoại lệ chấm công',
      dateStr: formatDate(start),
      shiftTime: `${formatTime(start)}–${formatTime(end)}`,
      evidence: exc.minutes ? `${exc.minutes} phút` : 'Hệ thống ghi nhận ngoại lệ',
      reason: 'Cần quản lý xác nhận',
      requestedPayable: 'Kiểm tra trước khi chốt lương',
      proposedMinutes: exc.minutes || 0,
      status: 'pending',
    });
  }
  return items;
}

export async function reviewApproval(item: ApprovalItemData, approved: boolean): Promise<void> {
  const client = requireClient();
  if (item.kind === 'overtime') {
    const { error } = await client.rpc('review_overtime', {
      p_ot_id: item.id,
      p_decision: approved ? 'approved' : 'rejected',
      p_approved_minutes: approved ? item.proposedMinutes || 0 : 0,
      p_note: null,
    });
    if (error) throw error;
    return;
  }
  const { error } = await client.rpc('resolve_attendance_exception', {
    p_exception_id: item.id,
    p_decision: approved ? 'approved' : 'rejected',
    p_note: null,
  });
  if (error) throw error;
}

export function monthBounds(date = new Date()): { startsOn: string; endsOn: string } {
  const y = date.getFullYear();
  const m = date.getMonth();
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { startsOn: localIso(start), endsOn: localIso(end) };
}

export async function preparePayrollPeriod(startsOn: string, endsOn: string): Promise<DbPayrollPeriod> {
  const client = requireClient();
  const { data, error } = await client.rpc('prepare_payroll_period', { p_starts_on: startsOn, p_ends_on: endsOn });
  if (error || !data) throw error ?? new Error('Không tạo được kỳ lương');
  return data as DbPayrollPeriod;
}

export async function fetchPayrollPeriod(startsOn?: string, endsOn?: string): Promise<DbPayrollPeriod | null> {
  if (!hasSupabase || !supabase) return null;
  let query = supabase.from('payroll_periods').select('*').order('starts_on', { ascending: false }).limit(1);
  if (startsOn) query = query.eq('starts_on', startsOn);
  if (endsOn) query = query.eq('ends_on', endsOn);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return data as DbPayrollPeriod;
}

export async function fetchPayrollLines(periodId?: string): Promise<PayrollLineView[]> {
  if (!hasSupabase || !supabase) return [];
  let query = supabase
    .from('payroll_lines')
    .select('*, profiles(full_name, employee_code, payroll_type), payroll_periods(starts_on, ends_on, status)');
  if (periodId) query = query.eq('period_id', periodId);
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((row) => {
    const p = row.profiles as { full_name?: string; employee_code?: string; payroll_type?: PayrollType } | null;
    const period = row.payroll_periods as { starts_on?: string; ends_on?: string; status?: string } | null;
    return {
      id: row.id,
      periodId: row.period_id,
      employeeId: row.employee_id,
      employeeCode: p?.employee_code || '',
      employeeName: p?.full_name || 'Nhân viên',
      payrollType: p?.payroll_type || 'hourly',
      regularMinutes: row.regular_minutes || 0,
      overtimeMinutes: row.overtime_minutes || 0,
      pendingMinutes: row.pending_minutes || 0,
      baseAmount: Number(row.base_amount || 0),
      overtimeAmount: Number(row.adjustment_amount || 0),
      pendingAmount: Number(row.pending_amount || 0),
      grossAmount: Number(row.gross_amount || 0),
      confidence: row.confidence as 'ready' | 'pending',
      isLocked: Boolean(row.is_locked),
      periodStatus: period?.status,
      startsOn: period?.starts_on,
      endsOn: period?.ends_on,
    };
  });
}

export async function lockPayroll(periodId: string): Promise<DbPayrollPeriod> {
  const client = requireClient();
  const { data, error } = await client.rpc('lock_payroll_period', { p_period_id: periodId });
  if (error || !data) throw error ?? new Error('Không khóa được bảng lương');
  return data as DbPayrollPeriod;
}

export async function createStaffAccounts(staff: StaffProvisionRequest[]): Promise<StaffProvisionResult> {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('staff-admin', {
    body: { action: 'create_many', staff },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as StaffProvisionResult;
}

export async function resetStaffPassword(employeeCode: string, password?: string): Promise<ProvisionedCredential> {
  const client = requireClient();
  const { data, error } = await client.functions.invoke('staff-admin', {
    body: { action: 'reset_password', employeeCode, password },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as ProvisionedCredential;
}
