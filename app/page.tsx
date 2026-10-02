'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Copy,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  Lock,
  LogOut,
  MapPin,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  UserCircle2,
  Users,
  X,
} from 'lucide-react';
import { distanceMeters } from '@/lib/time-engine';
import {
  ApprovalItemData,
  DbAttendanceEvent,
  DbLocation,
  DbPayrollPeriod,
  DbProfile,
  DbSettings,
  DbShift,
  PayrollLineView,
  ProvisionedCredential,
  StaffProvisionRequest,
  createStaffAccounts,
  fetchAttendanceForShift,
  fetchCurrentShift,
  fetchPayrollLines,
  fetchPayrollPeriod,
  fetchPendingApprovals,
  fetchProfile,
  fetchSession,
  fetchShiftsForRange,
  fetchShopLocation,
  fetchShopSettings,
  fetchStaffProfiles,
  getSession,
  lockPayroll,
  monthBounds,
  preparePayrollPeriod,
  recordAttendance,
  resetStaffPassword,
  reviewApproval,
  saveWeeklyShifts,
  signIn,
  signOut,
  updateShopLocation,
  updateShopSettings,
} from '@/lib/data-service';

// fetchSession is kept as a type-safe alias for older builds; current data-service
// exposes getSession. The local alias below prevents stale bundle issues.
void fetchSession;

type Tab = 'overview' | 'schedule' | 'approvals' | 'payroll' | 'checkin' | 'settings' | 'profile';

type UserProfile = {
  id: string;
  organizationId: string;
  employeeCode: string;
  name: string;
  role: 'owner' | 'admin' | 'employee';
  payrollType: 'hourly' | 'monthly';
  hourlyRate: number;
  monthlySalary: number;
  locationId: string | null;
};

type ShopConfig = {
  storeName: string;
  lat: number;
  lng: number;
  radius: number;
  graceMinutes: number;
  maxGpsAccuracy: number;
  requireGeofence: boolean;
  requireOtApproval: boolean;
  holdIncomplete: boolean;
  standardMonthlyDays: number;
  standardDailyHours: number;
  roundingMinutes: number;
};

type WeekDay = { short: string; iso: string; label: string; today: boolean };

const DEFAULT_SHOP: ShopConfig = {
  storeName: 'Meehoasg - Tiệm Hoa Tươi Bình Thạnh',
  lat: 10.7932193,
  lng: 106.7037517,
  radius: 120,
  graceMinutes: 5,
  maxGpsAccuracy: 150,
  requireGeofence: true,
  requireOtApproval: true,
  holdIncomplete: true,
  standardMonthlyDays: 26,
  standardDailyHours: 8,
  roundingMinutes: 0,
};

const formatMoney = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(value))}đ`;
const formatHours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}h`;

function valueError(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error) return String((error as { message?: unknown }).message || '');
  return error instanceof Error ? error.message : String(error || 'Có lỗi xảy ra');
}

function friendlyError(error: unknown): string {
  const raw = valueError(error);
  if (raw.includes('Invalid login credentials')) return 'Mã nhân viên hoặc mật khẩu không đúng.';
  if (raw.includes('OUTSIDE_GEOFENCE')) return 'Bạn đang ở ngoài vùng chấm công của shop.';
  if (raw.includes('GPS_ACCURACY_TOO_LOW')) return 'GPS chưa đủ chính xác. Hãy bật định vị chính xác và thử lại gần cửa hàng.';
  if (raw.includes('SHIFT_LOCATION_REQUIRED')) return 'Ca làm này chưa được gắn chi nhánh. Báo quản lý kiểm tra lịch.';
  if (raw.includes('SHIFT_OUTSIDE_ALLOWED_WINDOW')) return 'Hiện chưa nằm trong khung thời gian cho phép chấm ca này.';
  if (raw.includes('CHECK_IN_REQUIRED_BEFORE_CHECK_OUT')) return 'Chưa có check-in của ca này nên chưa thể check-out.';
  if (raw.includes('PAYROLL_HAS_PENDING_ITEMS')) return 'Còn ca hoặc OT đang chờ xử lý nên chưa thể khóa bảng lương.';
  if (raw.includes('PERMISSION')) return 'Tài khoản không có quyền thực hiện thao tác này.';
  return raw || 'Có lỗi xảy ra.';
}

function mapProfile(profile: DbProfile): UserProfile {
  return {
    id: profile.id,
    organizationId: profile.organization_id,
    employeeCode: profile.employee_code || 'NV',
    name: profile.full_name || 'Nhân viên',
    role: profile.role,
    payrollType: profile.payroll_type,
    hourlyRate: Number(profile.hourly_rate || 0),
    monthlySalary: Number(profile.monthly_salary || 0),
    locationId: profile.location_id,
  };
}

function hcmDateIso(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function hcmTime(iso: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

function getWeekDays(offset = 0): WeekDay[] {
  const now = new Date();
  const current = new Date(now);
  current.setDate(current.getDate() + offset * 7);
  const day = current.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(current);
  monday.setDate(current.getDate() + diff);
  const todayIso = hcmDateIso(now);
  const names = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  return names.map((short, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = hcmDateIso(d);
    const [, month, date] = iso.split('-');
    return { short, iso, label: `${date}/${month}`, today: iso === todayIso };
  });
}

function parseBulkStaff(text: string): StaffProvisionRequest[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: StaffProvisionRequest[] = [];
  for (const line of lines) {
    const delimiter = line.includes('\t') ? '\t' : ',';
    const cols = line.split(delimiter).map((c) => c.trim());
    if (!cols.length) continue;
    const first = cols[0].toLowerCase();
    if (first.includes('mã') || first.includes('code') || first.includes('employee')) continue;
    const [employeeCode, fullName, payrollRaw = 'hourly', rateRaw = '0', roleRaw = 'employee', password = ''] = cols;
    if (!employeeCode || !fullName) continue;
    const payrollType = /tháng|month/i.test(payrollRaw) ? 'monthly' : 'hourly';
    const role = /admin|quản/i.test(roleRaw) ? 'admin' : 'employee';
    const rate = Number(String(rateRaw).replace(/[^0-9.-]/g, '')) || 0;
    rows.push({
      employeeCode,
      fullName,
      payrollType,
      role,
      hourlyRate: payrollType === 'hourly' ? rate : 0,
      monthlySalary: payrollType === 'monthly' ? rate : 0,
      password: password || undefined,
    });
  }
  return rows;
}

function LoginScreen({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!loginId.trim() || !password) return;
    setLoading(true); setError('');
    try {
      await signIn(loginId, password);
      await onSuccess();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#fffaf5] px-4 py-12 flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 grid size-16 place-items-center rounded-3xl bg-[#176448] text-2xl font-black text-white shadow-lg">M</div>
          <h1 className="text-3xl font-black tracking-tight text-[#17231d]">MEEHOA TIME</h1>
          <p className="mt-2 text-sm text-muted-foreground">Chấm công · Lịch ca · Bảng lương</p>
        </div>
        <form onSubmit={submit} className="rounded-[28px] border bg-white p-6 shadow-xl">
          <h2 className="font-bold text-lg">Đăng nhập</h2>
          <p className="mt-1 text-xs text-muted-foreground">Dùng mã nhân viên được quản lý cấp. Không cần email.</p>
          {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</div>}
          <label className="mt-5 block text-xs font-bold">Mã nhân viên
            <input value={loginId} onChange={(e) => setLoginId(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="username" placeholder="VD: NV01" className="mt-1.5 h-12 w-full rounded-2xl border bg-background px-4 text-sm font-bold uppercase outline-none focus:ring-2 focus:ring-primary/20" />
          </label>
          <label className="mt-4 block text-xs font-bold">Mật khẩu
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="••••••••" className="mt-1.5 h-12 w-full rounded-2xl border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
          </label>
          <button disabled={loading} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#176448] text-sm font-bold text-white disabled:opacity-50">
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
            {loading ? 'Đang xác thực...' : 'Đăng nhập'}
          </button>
          <p className="mt-5 text-center text-[11px] text-muted-foreground">Quên mật khẩu? Liên hệ quản lý để reset trực tiếp.</p>
        </form>
      </div>
    </main>
  );
}

export default function Home() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [shop, setShop] = useState<ShopConfig>(DEFAULT_SHOP);
  const [tab, setTab] = useState<Tab>('overview');
  const [authLoading, setAuthLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [approvals, setApprovals] = useState<ApprovalItemData[]>([]);
  const [payrollPeriod, setPayrollPeriod] = useState<DbPayrollPeriod | null>(null);
  const [payrollLines, setPayrollLines] = useState<PayrollLineView[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekShifts, setWeekShifts] = useState<DbShift[]>([]);

  const isManager = user?.role === 'owner' || user?.role === 'admin';
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(''), 4000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const loadWeek = useCallback(async (profile: UserProfile, offset = weekOffset) => {
    const days = getWeekDays(offset);
    const shifts = await fetchShiftsForRange(
      profile.organizationId,
      `${days[0].iso}T00:00:00+07:00`,
      `${days[6].iso}T23:59:59+07:00`,
      profile.role === 'employee' ? profile.id : undefined,
    );
    setWeekShifts(shifts);
  }, [weekOffset]);

  const loadPayroll = useCallback(async (profile: UserProfile, prepare = false) => {
    const bounds = monthBounds();
    let period: DbPayrollPeriod | null = null;
    if ((profile.role === 'owner' || profile.role === 'admin') && prepare) {
      period = await preparePayrollPeriod(bounds.startsOn, bounds.endsOn);
    } else {
      period = await fetchPayrollPeriod(bounds.startsOn, bounds.endsOn);
    }
    setPayrollPeriod(period);
    setPayrollLines(period ? await fetchPayrollLines(period.id) : []);
  }, []);

  const loadApp = useCallback(async () => {
    setAuthLoading(true);
    try {
      const session = await getSession();
      if (!session?.user) {
        setUser(null); setStaff([]); return;
      }
      const dbProfile = await fetchProfile(session.user.id);
      if (!dbProfile?.active) {
        await signOut(); setUser(null); return;
      }
      const mapped = mapProfile(dbProfile);
      setUser(mapped);
      setTab(mapped.role === 'employee' ? 'checkin' : 'overview');

      const [location, settings, dbStaff] = await Promise.all([
        fetchShopLocation(), fetchShopSettings(), fetchStaffProfiles(),
      ]);
      setStaff(dbStaff.map(mapProfile));
      setShop((prev) => ({
        ...prev,
        storeName: location?.name || prev.storeName,
        lat: location?.latitude ?? prev.lat,
        lng: location?.longitude ?? prev.lng,
        radius: location?.radius_meters ?? prev.radius,
        graceMinutes: settings?.grace_minutes ?? prev.graceMinutes,
        maxGpsAccuracy: settings?.max_gps_accuracy_meters ?? prev.maxGpsAccuracy,
        requireGeofence: settings?.require_geofence ?? prev.requireGeofence,
        requireOtApproval: settings?.require_ot_approval ?? prev.requireOtApproval,
        holdIncomplete: settings?.hold_incomplete_attendance ?? prev.holdIncomplete,
        standardMonthlyDays: settings?.standard_monthly_days ?? prev.standardMonthlyDays,
        standardDailyHours: settings?.standard_daily_hours ?? prev.standardDailyHours,
        roundingMinutes: settings?.rounding_minutes ?? prev.roundingMinutes,
      }));
      await loadWeek(mapped, 0);
      if (mapped.role === 'owner' || mapped.role === 'admin') {
        setApprovals(await fetchPendingApprovals(mapped.organizationId));
        await loadPayroll(mapped, true);
      } else {
        setApprovals([]);
        await loadPayroll(mapped, false);
      }
    } catch (e) {
      setToast(friendlyError(e));
    } finally {
      setAuthLoading(false);
    }
  }, [loadPayroll, loadWeek]);

  useEffect(() => { void loadApp(); }, [loadApp]);

  useEffect(() => {
    if (user) void loadWeek(user, weekOffset);
  }, [weekOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <div className="min-h-screen grid place-items-center bg-[#fffaf5]"><div className="text-center"><LoaderCircle className="mx-auto size-8 animate-spin text-primary" /><p className="mt-3 text-xs font-bold text-muted-foreground">ĐANG TẢI MEEHOA TIME</p></div></div>;
  if (!user) return <LoginScreen onSuccess={loadApp} />;

  const nav: Array<[Tab, string, React.ComponentType<{ className?: string }>, boolean]> = [
    ['overview', 'Tổng quan', LayoutDashboard, Boolean(isManager)],
    ['schedule', 'Lịch ca', CalendarDays, true],
    ['approvals', 'Duyệt', ShieldCheck, Boolean(isManager)],
    ['payroll', 'Lương', CircleDollarSign, true],
    ['checkin', 'Chấm công', MapPin, true],
    ['settings', 'Cài đặt', Settings2, Boolean(isManager)],
    ['profile', 'Hồ sơ', UserCircle2, true],
  ];
  const visibleNav = nav.filter((x) => x[3]);

  const logout = async () => {
    await signOut(); setUser(null); setStaff([]); setPayrollLines([]); setApprovals([]);
  };

  return (
    <main className="min-h-screen bg-background pb-24 text-foreground md:pb-10">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <button onClick={() => setTab(isManager ? 'overview' : 'checkin')} className="flex items-center gap-3 text-left">
            <div className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-black text-primary-foreground">M</div>
            <div><p className="text-sm font-black">MEEHOA TIME</p><p className="max-w-[180px] truncate text-[10px] text-muted-foreground">{shop.storeName}</p></div>
          </button>
          <nav className="hidden items-center gap-1 md:flex">
            {visibleNav.map(([id, label, Icon]) => <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold ${tab === id ? 'bg-secondary text-primary' : 'text-muted-foreground hover:bg-muted'}`}><Icon className="size-4" />{label}{id === 'approvals' && approvals.length > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[9px] text-white">{approvals.length}</span>}</button>)}
          </nav>
          <button onClick={() => setTab('profile')} className="rounded-full border bg-card px-3 py-1.5 text-xs font-bold">{user.employeeCode} · {user.name}</button>
        </div>
      </header>

      {toast && <div className="fixed left-1/2 top-20 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border bg-card p-3 text-center text-xs font-bold shadow-xl">{toast}</div>}

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {tab === 'overview' && isManager && <Overview staff={staff} shifts={weekShifts} approvals={approvals} payroll={payrollLines} onRefresh={loadApp} />}
        {tab === 'schedule' && <ScheduleTab user={user} staff={staff} shifts={weekShifts} weekDays={weekDays} offset={weekOffset} onOffset={setWeekOffset} onSaved={async (msg) => { setToast(msg); await loadWeek(user, weekOffset); }} />}
        {tab === 'approvals' && isManager && <ApprovalsTab items={approvals} onDecide={async (item, approved) => { try { await reviewApproval(item, approved); setToast(approved ? 'Đã duyệt' : 'Đã từ chối'); setApprovals(await fetchPendingApprovals(user.organizationId)); await loadPayroll(user, true); } catch (e) { setToast(friendlyError(e)); } }} />}
        {tab === 'payroll' && <PayrollTab user={user} period={payrollPeriod} lines={payrollLines} onRefresh={async () => { try { await loadPayroll(user, Boolean(isManager)); setToast('Đã cập nhật bảng lương từ dữ liệu chấm công'); } catch (e) { setToast(friendlyError(e)); } }} onLock={async () => { if (!payrollPeriod) return; try { const period = await lockPayroll(payrollPeriod.id); setPayrollPeriod(period); setPayrollLines(await fetchPayrollLines(period.id)); setToast('Đã khóa snapshot bảng lương'); } catch (e) { setToast(friendlyError(e)); } }} />}
        {tab === 'checkin' && <CheckinTab user={user} shop={shop} onChanged={async (message) => { setToast(message); await loadWeek(user, weekOffset); if (isManager) { setApprovals(await fetchPendingApprovals(user.organizationId)); await loadPayroll(user, true); } }} />}
        {tab === 'settings' && isManager && <SettingsTab user={user} staff={staff} shop={shop} onShop={setShop} onRefresh={loadApp} onToast={setToast} />}
        {tab === 'profile' && <ProfileTab user={user} onLogout={logout} />}
      </div>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 px-2 py-2 backdrop-blur-xl md:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-around">
          {visibleNav.slice(0, 6).map(([id, label, Icon]) => <button key={id} onClick={() => setTab(id)} className={`flex min-w-12 flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[9px] font-bold ${tab === id ? 'bg-secondary text-primary' : 'text-muted-foreground'}`}><Icon className="size-4" /><span>{label}</span></button>)}
        </div>
      </nav>
    </main>
  );
}

function Overview({ staff, shifts, approvals, payroll, onRefresh }: { staff: UserProfile[]; shifts: DbShift[]; approvals: ApprovalItemData[]; payroll: PayrollLineView[]; onRefresh: () => Promise<void> }) {
  const gross = payroll.reduce((s, l) => s + l.grossAmount, 0);
  const pending = payroll.reduce((s, l) => s + l.pendingAmount, 0);
  return <>
    <div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-primary">Vận hành thực tế</p><h1 className="mt-1 text-2xl font-black">Tổng quan</h1></div><button onClick={() => void onRefresh()} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold"><RefreshCw className="size-4" />Làm mới</button></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric icon={Users} label="Nhân sự active" value={String(staff.length)} />
      <Metric icon={CalendarDays} label="Ca trong tuần" value={String(shifts.length)} />
      <Metric icon={ShieldCheck} label="Cần duyệt" value={String(approvals.length)} warn={approvals.length > 0} />
      <Metric icon={CircleDollarSign} label="Lương đã ghi nhận" value={formatMoney(gross)} sub={pending > 0 ? `Pending ${formatMoney(pending)}` : 'Không có pending'} />
    </div>
    <section className="mt-6 rounded-3xl border bg-card p-5"><h2 className="font-black">Tình trạng trước khi chốt lương</h2><div className="mt-4 grid gap-3 sm:grid-cols-3"><Status ok={approvals.length === 0} title="Ngoại lệ" text={approvals.length ? `${approvals.length} mục cần xử lý` : 'Đã sạch hàng đợi'} /><Status ok={pending === 0} title="Pending công" text={pending ? formatMoney(pending) : 'Không có tiền công bị giữ'} /><Status ok={payroll.every((l) => l.confidence === 'ready')} title="Dữ liệu lương" text={payroll.length ? (payroll.every((l) => l.confidence === 'ready') ? 'Sẵn sàng đối soát' : 'Còn dòng pending') : 'Chưa có dữ liệu kỳ này'} /></div></section>
  </>;
}

function Metric({ icon: Icon, label, value, sub, warn }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub?: string; warn?: boolean }) {
  return <div className="rounded-3xl border bg-card p-5 shadow-2xs"><Icon className={`size-5 ${warn ? 'text-amber-600' : 'text-primary'}`} /><p className="mt-4 text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-black">{value}</p>{sub && <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>}</div>;
}
function Status({ ok, title, text }: { ok: boolean; title: string; text: string }) { return <div className={`rounded-2xl border p-4 ${ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex items-center gap-2">{ok ? <CheckCircle2 className="size-4 text-emerald-700" /> : <AlertTriangle className="size-4 text-amber-700" />}<p className="text-xs font-black">{title}</p></div><p className="mt-2 text-xs text-muted-foreground">{text}</p></div>; }

function ScheduleTab({ user, staff, shifts, weekDays, offset, onOffset, onSaved }: { user: UserProfile; staff: UserProfile[]; shifts: DbShift[]; weekDays: WeekDay[]; offset: number; onOffset: (v: number) => void; onSaved: (msg: string) => Promise<void> }) {
  const manager = user.role === 'owner' || user.role === 'admin';
  const visibleStaff = manager ? staff : staff.filter((s) => s.id === user.id);
  const [grid, setGrid] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const presets = ['08:00–16:00', '12:00–16:00', '16:00–22:00', '10:00–18:00', 'OFF'];

  useEffect(() => {
    const next: Record<string, string[]> = {};
    for (const s of visibleStaff) next[s.id] = Array(7).fill('OFF');
    for (const shift of shifts) {
      if (!next[shift.employee_id]) continue;
      const date = hcmDateIso(new Date(shift.starts_at));
      const idx = weekDays.findIndex((d) => d.iso === date);
      if (idx >= 0) next[shift.employee_id][idx] = `${hcmTime(shift.starts_at)}–${hcmTime(shift.ends_at)}`;
    }
    setGrid(next);
  }, [shifts, weekDays, visibleStaff.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const cycle = (employeeId: string, day: number) => {
    if (!manager) return;
    setGrid((prev) => {
      const current = prev[employeeId]?.[day] || 'OFF';
      const idx = presets.indexOf(current);
      const arr = [...(prev[employeeId] || Array(7).fill('OFF'))];
      arr[day] = presets[(idx + 1) % presets.length];
      return { ...prev, [employeeId]: arr };
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const rows: Array<{ employee_id: string; starts_at: string; ends_at: string; note?: string }> = [];
      for (const s of visibleStaff) {
        const values = grid[s.id] || [];
        values.forEach((value, index) => {
          if (!value || value === 'OFF') return;
          const [start, end] = value.split('–');
          if (!start || !end) return;
          let endDate = weekDays[index].iso;
          if (end <= start) {
            const d = new Date(`${endDate}T12:00:00+07:00`); d.setDate(d.getDate() + 1); endDate = hcmDateIso(d);
          }
          rows.push({ employee_id: s.id, starts_at: `${weekDays[index].iso}T${start}:00+07:00`, ends_at: `${endDate}T${end}:00+07:00`, note: `Ca ${s.name}` });
        });
      }
      await saveWeeklyShifts(user.organizationId, user.id, rows, `${weekDays[0].iso}T00:00:00+07:00`, `${weekDays[6].iso}T23:59:59+07:00`, visibleStaff.map((s) => s.id));
      await onSaved(`Đã lưu ${rows.length} ca làm`);
    } catch (e) { await onSaved(friendlyError(e)); } finally { setSaving(false); }
  };

  return <>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-primary">Scheduled</p><h1 className="mt-1 text-2xl font-black">Lịch ca tuần</h1><p className="mt-1 text-xs text-muted-foreground">Bấm ô ngày để chuyển nhanh giữa các ca mẫu.</p></div><div className="flex gap-2"><button onClick={() => onOffset(offset - 1)} className="rounded-xl border px-3 py-2 text-xs font-bold">← Tuần trước</button><button onClick={() => onOffset(0)} className="rounded-xl border px-3 py-2 text-xs font-bold">Tuần này</button><button onClick={() => onOffset(offset + 1)} className="rounded-xl border px-3 py-2 text-xs font-bold">Tuần sau →</button></div></div>
    <div className="space-y-4">{visibleStaff.map((person) => <section key={person.id} className="rounded-3xl border bg-card p-4"><div className="mb-3 flex items-center justify-between"><div><p className="font-black">{person.name}</p><p className="text-[11px] text-muted-foreground">{person.employeeCode}</p></div></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">{weekDays.map((day, i) => <button key={day.iso} disabled={!manager} onClick={() => cycle(person.id, i)} className={`rounded-2xl border p-3 text-left ${day.today ? 'border-primary bg-secondary/50' : 'bg-background'} disabled:cursor-default`}><p className="text-[10px] font-black text-muted-foreground">{day.short} · {day.label}</p><p className="mt-1 text-xs font-black">{grid[person.id]?.[i] || 'OFF'}</p></button>)}</div></section>)}</div>
    {manager && <button onClick={save} disabled={saving} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-4 text-sm font-black text-primary-foreground disabled:opacity-50">{saving ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}{saving ? 'Đang lưu...' : 'Lưu lịch tuần'}</button>}
  </>;
}

function ApprovalsTab({ items, onDecide }: { items: ApprovalItemData[]; onDecide: (item: ApprovalItemData, approved: boolean) => Promise<void> }) {
  return <><div className="mb-5"><p className="text-xs font-bold uppercase tracking-wider text-primary">Actual → Payable</p><h1 className="mt-1 text-2xl font-black">Duyệt ngoại lệ & OT</h1></div>{items.length === 0 ? <Empty icon={CheckCircle2} title="Không còn mục chờ duyệt" text="Dữ liệu công hiện không có ngoại lệ pending." /> : <div className="space-y-3">{items.map((item) => <section key={`${item.kind}-${item.id}`} className="rounded-3xl border bg-card p-5"><div className="flex gap-3"><div className={`grid size-11 shrink-0 place-items-center rounded-2xl ${item.kind === 'overtime' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{item.kind === 'overtime' ? <Clock3 className="size-5" /> : <AlertTriangle className="size-5" />}</div><div className="min-w-0 flex-1"><h3 className="font-black">{item.employeeName} · {item.typeLabel}</h3><p className="mt-1 text-xs text-muted-foreground">{item.dateStr} · Ca {item.shiftTime}</p><div className="mt-3 rounded-2xl bg-muted p-3 text-xs"><p>{item.evidence}</p><p className="mt-1 text-muted-foreground">{item.reason}</p><p className="mt-2 font-black text-primary">{item.requestedPayable}</p></div><div className="mt-4 flex gap-2"><button onClick={() => void onDecide(item, true)} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-primary px-3 py-2.5 text-xs font-black text-primary-foreground"><Check className="size-4" />Duyệt</button><button onClick={() => void onDecide(item, false)} className="flex items-center gap-1 rounded-xl border px-4 py-2.5 text-xs font-black"><X className="size-4" />Từ chối</button></div></div></div></section>)}</div>}</>;
}

function PayrollTab({ user, period, lines, onRefresh, onLock }: { user: UserProfile; period: DbPayrollPeriod | null; lines: PayrollLineView[]; onRefresh: () => Promise<void>; onLock: () => Promise<void> }) {
  const manager = user.role === 'owner' || user.role === 'admin';
  const visible = manager ? lines : lines.filter((l) => l.employeeId === user.id);
  const total = visible.reduce((s, l) => s + l.grossAmount, 0);
  const pending = visible.reduce((s, l) => s + l.pendingAmount, 0);
  const canLock = manager && period && period.status !== 'locked' && pending === 0 && visible.every((l) => l.confidence === 'ready');
  return <><div className="mb-5 flex items-end justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-primary">Payable thực tế</p><h1 className="mt-1 text-2xl font-black">Bảng lương</h1><p className="mt-1 text-xs text-muted-foreground">Không còn giờ demo; số liệu lấy trực tiếp từ ca đã chấm.</p></div><button onClick={() => void onRefresh()} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black"><RefreshCw className="size-4" />Tính lại</button></div>
    <div className="grid gap-3 sm:grid-cols-3"><Metric icon={CircleDollarSign} label="Tổng ghi nhận" value={formatMoney(total)} /><Metric icon={Clock3} label="Pending" value={formatMoney(pending)} warn={pending > 0} /><Metric icon={Lock} label="Kỳ lương" value={period?.status === 'locked' ? 'Đã khóa' : period ? 'Đang mở' : 'Chưa tạo'} /></div>
    <div className="mt-5 overflow-hidden rounded-3xl border bg-card">{visible.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">Chưa có dữ liệu lương trong kỳ.</div> : visible.map((line, i) => <div key={line.id} className={`p-4 sm:p-5 ${i ? 'border-t' : ''}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><p className="font-black">{line.employeeName}</p><span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-black text-primary">{line.employeeCode}</span></div><p className="mt-1 text-xs text-muted-foreground">Regular {formatHours(line.regularMinutes)} · OT {formatHours(line.overtimeMinutes)}{line.pendingMinutes > 0 ? ` · Pending ${formatHours(line.pendingMinutes)}` : ''}</p></div><div className="text-right"><p className="text-lg font-black">{formatMoney(line.grossAmount)}</p><p className={`text-[10px] font-bold ${line.confidence === 'ready' ? 'text-emerald-600' : 'text-amber-600'}`}>{line.confidence === 'ready' ? 'READY' : 'PENDING'}</p></div></div><div className="mt-3 grid grid-cols-3 gap-2 text-[11px]"><div className="rounded-xl bg-muted p-2"><p className="text-muted-foreground">Công thường</p><p className="font-black">{formatMoney(line.baseAmount)}</p></div><div className="rounded-xl bg-muted p-2"><p className="text-muted-foreground">OT đã duyệt</p><p className="font-black">{formatMoney(line.overtimeAmount)}</p></div><div className="rounded-xl bg-muted p-2"><p className="text-muted-foreground">Đang giữ</p><p className="font-black">{formatMoney(line.pendingAmount)}</p></div></div></div>)}</div>
    {manager && <button disabled={!canLock} onClick={() => void onLock()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-4 text-sm font-black text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"><Lock className="size-4" />{period?.status === 'locked' ? 'Bảng lương đã khóa Snapshot' : pending > 0 ? 'Xử lý hết Pending trước khi khóa' : 'Khóa & chốt Snapshot kỳ lương'}</button>}
  </>;
}

function CheckinTab({ user, shop, onChanged }: { user: UserProfile; shop: ShopConfig; onChanged: (message: string) => Promise<void> }) {
  const [shift, setShift] = useState<DbShift | null>(null);
  const [events, setEvents] = useState<DbAttendanceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number; distance: number } | null>(null);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const current = await fetchCurrentShift(user.id);
      setShift(current);
      setEvents(current ? await fetchAttendanceForShift(current.id) : []);
    } finally { setLoading(false); }
  }, [user.id]);
  useEffect(() => { void reload(); }, [reload]);

  const checkedIn = events.some((e) => e.event === 'check_in');
  const checkedOut = events.some((e) => e.event === 'check_out');
  const checkIn = events.find((e) => e.event === 'check_in');
  const checkOut = events.find((e) => e.event === 'check_out');

  const punch = async (type: 'check_in' | 'check_out') => {
    if (!shift) return;
    setPunching(true); setError('');
    try {
      if (!navigator.geolocation) throw new Error('Thiết bị không hỗ trợ GPS.');
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }));
      const point = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
      const distance = Math.round(distanceMeters({ lat: shop.lat, lng: shop.lng }, point));
      setGps({ ...point, distance });
      const saved = await recordAttendance({ shiftId: shift.id, event: type, lat: point.lat, lng: point.lng, accuracy: point.accuracy });
      await reload();
      await onChanged(`${type === 'check_in' ? 'Check-in' : 'Check-out'} thành công lúc ${hcmTime(saved.occurred_at)}`);
    } catch (e) { setError(friendlyError(e)); } finally { setPunching(false); }
  };

  if (loading) return <div className="py-20 text-center"><LoaderCircle className="mx-auto size-7 animate-spin text-primary" /></div>;
  return <div className="mx-auto max-w-md"><div className="mb-5"><p className="text-xs font-bold uppercase tracking-wider text-primary">GPS Server Verified</p><h1 className="mt-1 text-2xl font-black">Chấm công</h1></div><section className="rounded-[30px] border bg-card p-5 text-center shadow-sm"><div className="mx-auto grid size-16 place-items-center rounded-3xl bg-secondary text-primary"><MapPin className="size-7" /></div>{shift ? <><p className="mt-5 text-xs font-bold text-muted-foreground">Ca hôm nay</p><p className="mt-1 text-3xl font-black">{hcmTime(shift.starts_at)} — {hcmTime(shift.ends_at)}</p><p className="mt-2 text-xs text-muted-foreground">{shop.storeName} · Bán kính {shop.radius}m · GPS ≤ {shop.maxGpsAccuracy}m</p><div className="mt-5 grid grid-cols-2 gap-2 text-left"><div className={`rounded-2xl border p-3 ${checkedIn ? 'border-emerald-200 bg-emerald-50' : ''}`}><p className="text-[10px] font-bold text-muted-foreground">CHECK-IN</p><p className="mt-1 text-sm font-black">{checkIn ? hcmTime(checkIn.occurred_at) : 'Chưa chấm'}</p></div><div className={`rounded-2xl border p-3 ${checkedOut ? 'border-emerald-200 bg-emerald-50' : ''}`}><p className="text-[10px] font-bold text-muted-foreground">CHECK-OUT</p><p className="mt-1 text-sm font-black">{checkOut ? hcmTime(checkOut.occurred_at) : 'Chưa chấm'}</p></div></div>{gps && <div className="mt-3 rounded-2xl bg-muted p-3 text-xs text-left"><p><b>GPS:</b> cách shop ~{gps.distance}m</p><p className="mt-1 text-muted-foreground">Độ chính xác ±{gps.accuracy}m. Server sẽ tự xác minh lại khoảng cách.</p></div>}{error && <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</div>}{!checkedIn && <button disabled={punching || checkedOut} onClick={() => void punch('check_in')} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-4 text-sm font-black text-primary-foreground disabled:opacity-50">{punching ? <LoaderCircle className="size-4 animate-spin" /> : <MapPin className="size-4" />}Check-in bằng GPS</button>}{checkedIn && !checkedOut && <button disabled={punching} onClick={() => void punch('check_out')} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm font-black text-rose-700 disabled:opacity-50">{punching ? <LoaderCircle className="size-4 animate-spin" /> : <Clock3 className="size-4" />}Check-out kết thúc ca</button>}{checkedOut && <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-black text-emerald-700"><CheckCircle2 className="mx-auto mb-2 size-5" />Ca đã đủ check-in / check-out</div>}</> : <><AlertTriangle className="mx-auto mt-5 size-6 text-amber-500" /><h2 className="mt-3 font-black">Không có ca để chấm công</h2><p className="mt-2 text-xs text-muted-foreground">Hệ thống chỉ cho punch khi có ca đã được quản lý xếp và đang nằm trong khung giờ cho phép.</p></>}</section></div>;
}

function SettingsTab({ user, staff, shop, onShop, onRefresh, onToast }: { user: UserProfile; staff: UserProfile[]; shop: ShopConfig; onShop: (s: ShopConfig) => void; onRefresh: () => Promise<void>; onToast: (s: string) => void }) {
  const [bulkText, setBulkText] = useState('');
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState<ProvisionedCredential[]>([]);
  const [bulkErrors, setBulkErrors] = useState<Array<{ row: number; employeeCode?: string; error: string }>>([]);
  const [draftShop, setDraftShop] = useState(shop);
  const [savingRules, setSavingRules] = useState(false);

  useEffect(() => setDraftShop(shop), [shop]);

  const createBulk = async () => {
    const rows = parseBulkStaff(bulkText);
    if (!rows.length) { onToast('Chưa đọc được dòng nhân viên hợp lệ.'); return; }
    setCreating(true); setCredentials([]); setBulkErrors([]);
    try {
      const result = await createStaffAccounts(rows);
      setCredentials(result.created); setBulkErrors(result.errors);
      onToast(`Đã tạo ${result.created.length}/${rows.length} tài khoản`);
      await onRefresh();
    } catch (e) { onToast(friendlyError(e)); } finally { setCreating(false); }
  };

  const resetPass = async (code: string) => {
    try {
      const cred = await resetStaffPassword(code);
      setCredentials((prev) => [cred, ...prev.filter((c) => c.employeeCode !== cred.employeeCode)]);
      onToast(`Đã reset mật khẩu ${code}`);
    } catch (e) { onToast(friendlyError(e)); }
  };

  const copyCredentials = async () => {
    const text = credentials.map((c) => `${c.employeeCode}\t${c.fullName}\t${c.password}`).join('\n');
    await navigator.clipboard.writeText(text);
    onToast('Đã copy danh sách user / pass');
  };

  const saveRules = async () => {
    setSavingRules(true);
    try {
      await updateShopSettings(user.organizationId, {
        grace_minutes: draftShop.graceMinutes,
        max_gps_accuracy_meters: draftShop.maxGpsAccuracy,
        require_geofence: draftShop.requireGeofence,
        require_ot_approval: draftShop.requireOtApproval,
        hold_incomplete_attendance: draftShop.holdIncomplete,
        standard_monthly_days: draftShop.standardMonthlyDays,
        standard_daily_hours: draftShop.standardDailyHours,
        rounding_minutes: draftShop.roundingMinutes,
      } as Partial<DbSettings>);
      const location = await fetchShopLocation();
      if (location) await updateShopLocation(location.id, { name: draftShop.storeName, latitude: draftShop.lat, longitude: draftShop.lng, radius_meters: draftShop.radius } as Partial<DbLocation>);
      onShop(draftShop); onToast('Đã lưu quy tắc chấm công');
    } catch (e) { onToast(friendlyError(e)); } finally { setSavingRules(false); }
  };

  return <><div className="mb-5"><p className="text-xs font-bold uppercase tracking-wider text-primary">Owner / Admin</p><h1 className="mt-1 text-2xl font-black">Cài đặt</h1></div><div className="grid gap-5 lg:grid-cols-2"><section className="rounded-3xl border bg-card p-5"><div className="flex items-center gap-2"><Users className="size-5 text-primary" /><h2 className="font-black">Tạo user hàng loạt</h2></div><p className="mt-2 text-xs leading-5 text-muted-foreground">Copy trực tiếp từ Google Sheet. Thứ tự cột: <b>Mã NV · Tên · Loại lương · Mức lương · Vai trò · Mật khẩu (tùy chọn)</b>. Nếu bỏ mật khẩu, hệ thống tự sinh.</p><textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={7} placeholder={'NV01\tNga\thourly\t25000\temployee\nNV02\tTiên\thourly\t28000\temployee\nQL02\tLinh\tmonthly\t8000000\tadmin'} className="mt-4 w-full rounded-2xl border bg-background p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-primary/20" /><button disabled={creating} onClick={() => void createBulk()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-xs font-black text-primary-foreground disabled:opacity-50">{creating ? <LoaderCircle className="size-4 animate-spin" /> : <Users className="size-4" />}Tạo tài khoản</button>{credentials.length > 0 && <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3"><div className="flex items-center justify-between"><p className="text-xs font-black text-emerald-800">User / pass vừa tạo</p><button onClick={() => void copyCredentials()} className="flex items-center gap-1 text-[11px] font-black text-emerald-800"><Copy className="size-3" />Copy</button></div><div className="mt-2 space-y-1 font-mono text-[11px]">{credentials.map((c) => <p key={c.employeeCode}>{c.employeeCode} · {c.password} · {c.fullName}</p>)}</div><p className="mt-2 text-[10px] text-emerald-800">Danh sách mật khẩu chỉ hiển thị trong phiên này. Hãy gửi riêng cho từng nhân viên.</p></div>}{bulkErrors.length > 0 && <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{bulkErrors.map((e) => <p key={`${e.row}-${e.employeeCode}`}>Dòng {e.row} {e.employeeCode ? `(${e.employeeCode})` : ''}: {e.error}</p>)}</div>}</section>
    <section className="rounded-3xl border bg-card p-5"><div className="flex items-center gap-2"><Settings2 className="size-5 text-primary" /><h2 className="font-black">Quy tắc vận hành</h2></div><div className="mt-4 grid grid-cols-2 gap-3"><NumberField label="Grace đi trễ (phút)" value={draftShop.graceMinutes} onChange={(v) => setDraftShop({ ...draftShop, graceMinutes: v })} /><NumberField label="Bán kính GPS (m)" value={draftShop.radius} onChange={(v) => setDraftShop({ ...draftShop, radius: v })} /><NumberField label="GPS accuracy tối đa (m)" value={draftShop.maxGpsAccuracy} onChange={(v) => setDraftShop({ ...draftShop, maxGpsAccuracy: v })} /><NumberField label="Ngày công chuẩn/tháng" value={draftShop.standardMonthlyDays} onChange={(v) => setDraftShop({ ...draftShop, standardMonthlyDays: v })} /></div><div className="mt-4 space-y-2"><CheckField label="Bắt buộc trong vùng shop" checked={draftShop.requireGeofence} onChange={(v) => setDraftShop({ ...draftShop, requireGeofence: v })} /><CheckField label="OT phải được quản lý duyệt" checked={draftShop.requireOtApproval} onChange={(v) => setDraftShop({ ...draftShop, requireOtApproval: v })} /><CheckField label="Giữ công nếu thiếu check-in/out" checked={draftShop.holdIncomplete} onChange={(v) => setDraftShop({ ...draftShop, holdIncomplete: v })} /></div><button disabled={savingRules} onClick={() => void saveRules()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-xs font-black"><Save className="size-4" />{savingRules ? 'Đang lưu...' : 'Lưu quy tắc'}</button></section></div>
    <section className="mt-5 rounded-3xl border bg-card p-5"><h2 className="font-black">Nhân sự hiện tại</h2><div className="mt-3 divide-y">{staff.map((s) => <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-black">{s.employeeCode} · {s.name}</p><p className="text-xs text-muted-foreground">{s.role} · {s.payrollType === 'hourly' ? `${formatMoney(s.hourlyRate)}/h` : `${formatMoney(s.monthlySalary)}/tháng`}</p></div>{s.role !== 'owner' && <button onClick={() => void resetPass(s.employeeCode)} className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-black"><KeyRound className="size-3.5" />Reset pass</button>}</div>)}</div></section></>;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) { return <label className="text-[11px] font-bold text-muted-foreground">{label}<input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 h-10 w-full rounded-xl border bg-background px-3 text-sm font-black text-foreground" /></label>; }
function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) { return <label className="flex items-center justify-between rounded-xl border p-3 text-xs font-bold"><span>{label}</span><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[#176448]" /></label>; }

function ProfileTab({ user, onLogout }: { user: UserProfile; onLogout: () => Promise<void> }) {
  return <div className="mx-auto max-w-lg"><div className="mb-5"><p className="text-xs font-bold uppercase tracking-wider text-primary">Tài khoản</p><h1 className="mt-1 text-2xl font-black">Hồ sơ</h1></div><section className="rounded-3xl border bg-card p-5"><div className="grid size-14 place-items-center rounded-2xl bg-secondary text-xl font-black text-primary">{user.name.slice(0, 2).toUpperCase()}</div><h2 className="mt-4 text-xl font-black">{user.name}</h2><p className="mt-1 text-sm text-muted-foreground">{user.employeeCode} · {user.role}</p><div className="mt-5 rounded-2xl bg-muted p-4 text-xs"><p><b>Loại lương:</b> {user.payrollType === 'hourly' ? 'Theo giờ' : 'Lương tháng'}</p><p className="mt-2"><b>Mức hiện tại:</b> {user.payrollType === 'hourly' ? `${formatMoney(user.hourlyRate)}/h` : formatMoney(user.monthlySalary)}</p></div><button onClick={() => void onLogout()} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-black text-rose-700"><LogOut className="size-4" />Đăng xuất</button></section></div>;
}

function Empty({ icon: Icon, title, text }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string }) { return <div className="rounded-3xl border bg-card p-10 text-center"><Icon className="mx-auto size-10 text-primary" /><h2 className="mt-3 font-black">{title}</h2><p className="mt-2 text-xs text-muted-foreground">{text}</p></div>; }
