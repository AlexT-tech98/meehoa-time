'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Copy,
  FileSpreadsheet,
  LayoutDashboard,
  Lock,
  LocateFixed,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserCircle2,
  Users,
  X,
} from 'lucide-react';
import { hasSupabase, supabase } from '@/lib/supabase';
import { Switch } from '@/components/ui/switch';
import { distanceMeters } from '@/lib/time-engine';
import {
  getSession,
  signIn,
  signOut,
  fetchProfile,
  fetchStaffProfiles,
  updateStaffProfile,
  fetchShopLocation,
  updateShopLocation,
  fetchShopSettings,
  updateShopSettings,
  fetchTodayAttendance,
  fetchAttendanceShift,
  recordAttendance,
  fetchShiftsForRange,
  saveWeeklyShifts,
  fetchPendingApprovals,
  reviewApproval,
  fetchCurrentPayrollPeriod,
  fetchPayrollLines,
  refreshPayrollPeriod,
  lockPayroll,
  provisionStaff,
  bulkProvisionStaff,
  resetStaffPassword,
  ApprovalItemData,
  DbPayrollLine,
  DbProfile,
} from '@/lib/data-service';

// ==============================================================================
// TYPES & DATA CONTRACTS
// ==============================================================================

export type Role = 'owner' | 'admin' | 'employee';
export type PayrollType = 'hourly' | 'monthly';
export type Tab =
  | 'overview'
  | 'schedule'
  | 'approvals'
  | 'payroll'
  | 'checkin'
  | 'settings'
  | 'profile';

export interface UserProfile {
  id: string;
  organizationId?: string;
  employeeCode: string;
  name: string;
  initials: string;
  email: string;
  phone: string;
  role: Role;
  payrollType: PayrollType;
  hourlyRate: number;
  monthlySalary: number;
  allowance: number;
  effectiveDate: string;
  locationName: string;
}

export type ApprovalItem = ApprovalItemData;

export interface ShopSettingsConfig {
  name: string;
  storeName: string;
  lat: number;
  lng: number;
  radius: number;
  graceMinutes: number;
  roundingMinutes: number;
  requireGeofence: boolean;
  requireOtApproval: boolean;
  holdIncomplete: boolean;
  standardMonthlyDays: number;
  standardDailyHours: number;
  timezone: string;
}

export interface WageHistoryRecord {
  id: string;
  employeeName: string;
  payrollType: PayrollType;
  rate: number;
  effectiveDate: string;
  note: string;
  createdAt: string;
}

const formatMoney = (val: number) =>
  new Intl.NumberFormat('vi-VN').format(Math.round(val)) + 'đ';

const SHOP_COORDINATES = { lat: 10.7932193, lng: 106.7037517 }; // Meehoasg - Tiệm Hoa Tươi Bình Thạnh

function mapDbProfileToUser(
  p: DbProfile,
  locationName: string = 'Meehoasg - Tiệm Hoa Tươi Bình Thạnh',
): UserProfile {
  return {
    id: p.id,
    organizationId: p.organization_id,
    employeeCode: p.employee_code || 'NV',
    name: p.full_name || 'Nhân viên',
    initials: (p.full_name || 'NV').slice(0, 2).toUpperCase(),
    email: p.email || '',
    phone: p.phone || '',
    role: p.role,
    payrollType: p.payroll_type,
    hourlyRate: Number(p.hourly_rate) || 25000,
    monthlySalary: Number(p.monthly_salary) || 0,
    allowance: 0,
    effectiveDate: p.effective_date || '2026-09-01',
    locationName,
  };
}

function getWeekDays(referenceDate: Date = new Date()) {
  const current = new Date(referenceDate);
  const day = current.getDay();
  const diff = current.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(current.setDate(diff));

  const days = [];
  const todayStr = new Date().toISOString().slice(0, 10);
  const dayNames = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const [, month, dt] = iso.split('-');
    days.push({
      short: dayNames[i],
      date: `${dt}/${month}`,
      iso,
      today: iso === todayStr,
    });
  }
  return days;
}

// ==============================================================================
// LOGIN SCREEN COMPONENT (MANDATORY AUTHENTICATION)
// ==============================================================================

function LoginScreen({
  onLoginSuccess,
  storeName,
}: {
  onLoginSuccess: (userProfile: UserProfile) => void;
  storeName: string;
}) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!loginId.trim() || !password.trim()) {
      setErrorMsg('Vui lòng điền đầy đủ mã nhân viên và mật khẩu');
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await signIn(loginId.trim(), password);
      if (data?.session?.user) {
        const prof = await fetchProfile(data.session.user.id);
        if (prof) {
          const user = mapDbProfileToUser(prof, storeName);
          onLoginSuccess(user);
        } else {
          setErrorMsg('Tài khoản chưa được liên kết hồ sơ nhân viên trong tổ chức MEEHOA');
        }
      }
    } catch (err: unknown) {
      console.error('Sign in error:', err);
      const msg = err instanceof Error ? err.message : 'Đăng nhập không thành công';
      if (msg.includes('Invalid login credentials')) {
        setErrorMsg('Mã nhân viên hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại.');
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fffaf5] flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden">
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-emerald-100/60 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-amber-100/60 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center size-20 rounded-3xl bg-[#176448] text-white shadow-xl shadow-emerald-950/20 mb-4 ring-8 ring-emerald-50">
            <span className="text-3xl font-extrabold tracking-tight">M</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[#17231d]">
            MEEHOA TIME
          </h1>
          <p className="text-xs font-semibold text-emerald-800 mt-1 uppercase tracking-widest">
            {storeName}
          </p>
          <p className="text-xs text-muted-foreground mt-2 max-w-xs mx-auto">
            Hệ thống Chấm công GPS Geofence, Xếp lịch ca & Quản lý lương
          </p>
        </div>

        <div className="rounded-[32px] border border-emerald-100 bg-white/95 p-8 shadow-xl backdrop-blur-md">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-foreground">Đăng nhập hệ thống</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Nhập mã nhân viên và mật khẩu được cấp để bắt đầu
            </p>
          </div>

          {errorMsg && (
            <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-700 flex items-start gap-2.5">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-id" className="block text-xs font-bold text-foreground mb-1.5">
                Mã nhân viên
              </label>
              <input
                id="login-id"
                type="text"
                autoCapitalize="characters"
                required
                value={loginId}
                onChange={(e) => setLoginId(e.target.value.toUpperCase())}
                placeholder="Ví dụ: QL01 hoặc NV01"
                className="h-12 w-full rounded-2xl border border-input bg-background px-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-bold text-foreground mb-1.5">
                Mật khẩu
              </label>
              <input
                id="login-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="h-12 w-full rounded-2xl border border-input bg-background px-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#176448] px-5 text-sm font-bold text-white shadow-md hover:bg-[#124d37] transition active:scale-[0.99] disabled:opacity-60 cursor-pointer"
            >
              {loading ? (
                <>
                  <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Đang xác thực...</span>
                </>
              ) : (
                <>
                  <Lock className="size-4" />
                  <span>Đăng nhập</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t text-center text-xs text-muted-foreground">
            <p>Chưa có tài khoản hoặc quên mật khẩu?</p>
            <p className="mt-1 font-semibold text-emerald-800">
              Vui lòng liên hệ Quản lý cửa hàng (QL01)
            </p>
          </div>
        </div>

        <div className="mt-6 text-center text-[11px] text-muted-foreground">
          Được bảo mật bởi Supabase Cloud (Singapore) · GPS Bán kính 120m
        </div>
      </div>
    </div>
  );
}

// ==============================================================================
// MAIN APP COMPONENT
// ==============================================================================

export default function Home() {
  const [activeUser, setActiveUser] = useState<UserProfile | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  const [tab, setTab] = useState<Tab>('overview');
  const [toast, setToast] = useState<string>('');
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const [staffList, setStaffList] = useState<UserProfile[]>([]);
  const [wageHistories, setWageHistories] = useState<WageHistoryRecord[]>([]);

  const [shopSettings, setShopSettings] = useState<ShopSettingsConfig>({
    name: 'MEEHOA TIME',
    storeName: 'Meehoasg - Tiệm Hoa Tươi Bình Thạnh',
    lat: SHOP_COORDINATES.lat,
    lng: SHOP_COORDINATES.lng,
    radius: 120,
    graceMinutes: 5,
    roundingMinutes: 0,
    requireGeofence: true,
    requireOtApproval: true,
    holdIncomplete: true,
    standardMonthlyDays: 26,
    standardDailyHours: 8,
    timezone: 'Asia/Ho_Chi_Minh',
  });

  const [currentWeekOffset, setCurrentWeekOffset] = useState(0);
  const weekDays = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + currentWeekOffset * 7);
    return getWeekDays(d);
  }, [currentWeekOffset]);

  const [scheduleGrid, setScheduleGrid] = useState<Record<string, string[]>>({});
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [payrollLocked, setPayrollLocked] = useState(false);
  const [payrollLines, setPayrollLines] = useState<DbPayrollLine[]>([]);

  const checkAuthAndLoad = useCallback(async () => {
    
    const session = await getSession();
    if (session?.user) {
      const prof = await fetchProfile(session.user.id);
      if (prof) {
        const loc = await fetchShopLocation();
        const st = await fetchShopSettings();

        if (loc) {
          setShopSettings((prev) => ({
            ...prev,
            storeName: loc.name,
            lat: loc.latitude,
            lng: loc.longitude,
            radius: loc.radius_meters || 120,
          }));
        }
        if (st) {
          setShopSettings((prev) => ({
            ...prev,
            graceMinutes: st.grace_minutes,
            roundingMinutes: st.rounding_minutes,
            requireGeofence: st.require_geofence,
            requireOtApproval: st.require_ot_approval,
            holdIncomplete: st.hold_incomplete_attendance,
            standardMonthlyDays: st.standard_monthly_days,
            standardDailyHours: st.standard_daily_hours,
          }));
        }

        const user = mapDbProfileToUser(prof, loc?.name);
        setActiveUser(user);
        setCurrentUserProfile(user);

        if (user.role === 'owner' || user.role === 'admin') {
          const allProfs = await fetchStaffProfiles();
          const mappedStaff = allProfs.map((p) => mapDbProfileToUser(p, loc?.name));
          setStaffList(mappedStaff);

          const approvalsData = await fetchPendingApprovals(prof.organization_id);
          setApprovals(approvalsData);

          const period = await refreshPayrollPeriod();
          setPayrollLocked(period?.status === 'locked');
          if (period) setPayrollLines(await fetchPayrollLines(period.id));
          setTab('overview');
        } else {
          setStaffList([user]);
          const period = await fetchCurrentPayrollPeriod(prof.organization_id);
          setPayrollLocked(period?.status === 'locked');
          if (period) setPayrollLines(await fetchPayrollLines(period.id));
          setTab('checkin');
        }
      } else {
        setActiveUser(null);
        setCurrentUserProfile(null);
      }
    } else {
      setActiveUser(null);
      setCurrentUserProfile(null);
    }
    setAuthChecking(false);
  }, []);

  // Check auth session on mount
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (active) {
        await checkAuthAndLoad();
      }
    });

    const client = supabase;
    if (!hasSupabase || !client) return;

    const { data: authSub } = client.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void checkAuthAndLoad();
      } else {
        setActiveUser(null);
        setCurrentUserProfile(null);
      }
    });

    return () => {
      active = false;
      authSub?.subscription.unsubscribe();
    };
  }, [checkAuthAndLoad]);

  // Load shifts into scheduleGrid from Supabase when week or staff changes
  useEffect(() => {
    let isCancelled = false;
    if (!activeUser?.organizationId || staffList.length === 0) return;

    async function loadShifts() {
      const rangeStart = `${weekDays[0].iso}T00:00:00+07:00`;
      const rangeEnd = `${weekDays[6].iso}T23:59:59+07:00`;
      const shifts = await fetchShiftsForRange(activeUser!.organizationId!, rangeStart, rangeEnd);
      if (isCancelled) return;

      const newGrid: Record<string, string[]> = {};
      for (const m of staffList) {
        newGrid[m.name] = Array(7).fill('OFF');
      }

      for (const s of shifts) {
        const member = staffList.find((m) => m.id === s.employee_id);
        if (!member) continue;
        const shiftStart = new Date(s.starts_at);
        const shiftEnd = new Date(s.ends_at);
        const shiftIso = s.starts_at.slice(0, 10);
        const dayIdx = weekDays.findIndex((d) => d.iso === shiftIso);
        if (dayIdx >= 0 && dayIdx < 7) {
          const sH = String(shiftStart.getHours()).padStart(2, '0');
          const sM = String(shiftStart.getMinutes()).padStart(2, '0');
          const eH = String(shiftEnd.getHours()).padStart(2, '0');
          const eM = String(shiftEnd.getMinutes()).padStart(2, '0');
          newGrid[member.name][dayIdx] = `${sH}:${sM}–${eH}:${eM}`;
        }
      }
      setScheduleGrid(newGrid);
    }

    void loadShifts();
    return () => {
      isCancelled = true;
    };
  }, [activeUser?.organizationId, staffList, weekDays]);

  // Realtime subscription for live business sync
  useEffect(() => {
    const client = supabase;
    if (!hasSupabase || !client || !activeUser?.organizationId) return;

    const channel = client
      .channel('meehoa-live-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_events' },
        () => {
          setToast('Có lượt chấm công mới ghi nhận');
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'overtime_requests' },
        () => {
          void fetchPendingApprovals(activeUser.organizationId!).then(setApprovals);
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [activeUser?.organizationId]);

  // Auto clear toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const pendingApprovalsCount = approvals.filter((a) => a.status === 'pending').length;
  const pendingAmount = payrollLines.reduce(
    (sum, line) => sum + Number(line.pending_amount || 0),
    0,
  );
  const confirmedFund = payrollLines.reduce(
    (sum, line) => sum + Number(line.gross_amount || 0),
    0,
  );

  const handleDecideApproval = async (id: string, approved: boolean) => {
    if (!activeUser?.organizationId) return;
    const item = approvals.find((a) => a.id === id);
    if (!item) return;

    try {
      await reviewApproval(item, approved, activeUser.id, activeUser.organizationId);
      setToast(
        approved
          ? 'Đã duyệt và cập nhật Payable vào quỹ lương'
          : 'Đã từ chối yêu cầu, giữ nguyên lịch chuẩn',
      );
      const updated = await fetchPendingApprovals(activeUser.organizationId);
      setApprovals(updated);
      const period = await refreshPayrollPeriod();
      if (period) setPayrollLines(await fetchPayrollLines(period.id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi xử lý duyệt';
      setToast('Lỗi duyệt: ' + msg);
    }
  };

  const handleSelectRole = (user: UserProfile) => {
    setActiveUser(user);
    if (
      user.role === 'employee' &&
      (tab === 'overview' || tab === 'approvals' || tab === 'settings')
    ) {
      setTab('checkin');
    }
    setAuthModalOpen(false);
    setToast(`Đã chuyển sang tài khoản: ${user.name} (${user.role.toUpperCase()})`);
  };

  const handleSaveSchedule = async () => {
    if (!activeUser?.organizationId) return;
    try {
      setToast('Đang lưu lịch phân ca vào Supabase...');
      const shiftsToInsert: Array<{
        employee_id: string;
        location_id: string | null;
        starts_at: string;
        ends_at: string;
        note?: string;
      }> = [];

      const affectedEmployeeIds: string[] = [];

      for (const member of staffList) {
        affectedEmployeeIds.push(member.id);
        const memberShifts = scheduleGrid[member.name] || [];
        for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
          const shiftStr = memberShifts[dayIndex];
          if (shiftStr && shiftStr !== 'OFF') {
            const parts = shiftStr.split('–');
            if (parts.length === 2) {
              const dayIso = weekDays[dayIndex].iso;
              const starts_at = `${dayIso}T${parts[0].trim()}:00+07:00`;
              const ends_at = `${dayIso}T${parts[1].trim()}:00+07:00`;
              shiftsToInsert.push({
                employee_id: member.id,
                location_id: null,
                starts_at,
                ends_at,
                note: `Ca ${member.name} (${shiftStr})`,
              });
            }
          }
        }
      }

      const rangeStartIso = `${weekDays[0].iso}T00:00:00+07:00`;
      const rangeEndIso = `${weekDays[6].iso}T23:59:59+07:00`;

      await saveWeeklyShifts(
        activeUser.organizationId,
        activeUser.id,
        shiftsToInsert,
        rangeStartIso,
        rangeEndIso,
        affectedEmployeeIds,
      );

      setToast(`Đã lưu ${shiftsToInsert.length} ca làm việc vào Supabase`);
    } catch (err: unknown) {
      console.error('Failed to save shifts:', err);
      const msg = err instanceof Error ? err.message : 'Lỗi khi lưu ca';
      setToast('Lỗi lưu lịch: ' + msg);
    }
  };

  const handleLockPayroll = async () => {
    if (!activeUser?.organizationId) return;
    try {
      const period = await fetchCurrentPayrollPeriod(activeUser.organizationId);
      if (!period) throw new Error('Chưa có kỳ lương để khóa');
      await lockPayroll(period.id);
      setPayrollLines(await fetchPayrollLines(period.id));
      setPayrollLocked(true);
      setToast('Đã khóa snapshot bảng lương tháng này vào Supabase');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khóa bảng lương';
      setToast('Lỗi khóa bảng lương: ' + msg);
    }
  };

  const handleUpdateShopSettings = async (newSettings: ShopSettingsConfig) => {
    setShopSettings(newSettings);
    if (!activeUser?.organizationId) return;
    try {
      await updateShopSettings(activeUser.organizationId, {
        grace_minutes: newSettings.graceMinutes,
        require_geofence: newSettings.requireGeofence,
        require_ot_approval: newSettings.requireOtApproval,
        hold_incomplete_attendance: newSettings.holdIncomplete,
        standard_monthly_days: newSettings.standardMonthlyDays,
        standard_daily_hours: newSettings.standardDailyHours,
        rounding_minutes: newSettings.roundingMinutes,
        max_gps_accuracy_meters: 150,
      });
      const loc = await fetchShopLocation();
      if (loc) {
        await updateShopLocation(loc.id, {
          name: newSettings.storeName,
          latitude: newSettings.lat,
          longitude: newSettings.lng,
          radius_meters: newSettings.radius,
        });
      }
      setToast('Đã cập nhật cấu hình cửa hàng & quy tắc vào Supabase');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi cập nhật cấu hình';
      setToast('Lỗi cấu hình: ' + msg);
    }
  };

  const handleSaveStaffEdit = async (staffToSave: UserProfile) => {
    if (!activeUser?.organizationId) return;
    try {
      await updateStaffProfile(staffToSave.id, {
        full_name: staffToSave.name,
        role: staffToSave.role,
        payroll_type: staffToSave.payrollType,
        hourly_rate: staffToSave.hourlyRate,
        monthly_salary: staffToSave.monthlySalary,
        effective_date: staffToSave.effectiveDate,
      });
      setStaffList((prev) =>
        prev.map((s) => (s.id === staffToSave.id ? staffToSave : s)),
      );
      setToast(`Đã cập nhật hồ sơ lương của ${staffToSave.name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi cập nhật hồ sơ';
      setToast('Lỗi cập nhật: ' + msg);
    }
  };

  const handleAddNewStaff = async (newMember: UserProfile) => {
    try {
      const result = await provisionStaff({
        employeeCode: newMember.employeeCode,
        fullName: newMember.name,
        role: newMember.role === 'owner' ? 'admin' : newMember.role,
        payrollType: newMember.payrollType,
        hourlyRate: newMember.hourlyRate,
        monthlySalary: newMember.monthlySalary,
        effectiveDate: newMember.effectiveDate,
        phone: newMember.phone,
      });
      const mapped = mapDbProfileToUser(result.profile, shopSettings.storeName);
      setStaffList((prev) => [...prev, mapped]);
      const credential = `${result.employeeCode} / ${result.temporaryPassword}`;
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(credential).catch(() => undefined);
      }
      setToast(`Đã tạo ${result.employeeCode}. User/pass tạm đã được copy.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi thêm nhân viên';
      setToast('Lỗi tạo tài khoản: ' + msg);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    setActiveUser(null);
    setCurrentUserProfile(null);
    setTab('overview');
    setToast('Đã đăng xuất an toàn');
  };

  const navigationTabs: [Tab, string, typeof LayoutDashboard, boolean][] =
    useMemo(() => {
      const isManager =
        activeUser?.role === 'owner' || activeUser?.role === 'admin';
      return [
        ['overview', 'Tổng quan', LayoutDashboard, isManager],
        ['schedule', 'Xếp lịch', CalendarDays, true],
        ['approvals', 'Duyệt đơn', ShieldCheck, isManager],
        ['payroll', 'Bảng lương', CircleDollarSign, true],
        ['checkin', 'Chấm công GPS', MapPin, true],
        ['settings', 'Cài đặt', Settings2, isManager],
        ['profile', 'Hồ sơ', UserCircle2, true],
      ];
    }, [activeUser?.role]);

  const visibleTabs = navigationTabs.filter((t) => t[3]);
  const currentTitle = useMemo(() => {
    const found = navigationTabs.find((t) => t[0] === tab);
    return found ? found[1] : 'MEEHOA TIME';
  }, [navigationTabs, tab]);

  const todayLabel = useMemo(() => {
    const now = new Date();
    const daysVi = [
      'Chủ Nhật',
      'Thứ Hai',
      'Thứ Ba',
      'Thứ Tư',
      'Thứ Năm',
      'Thứ Sáu',
      'Thứ Bảy',
    ];
    const dName = daysVi[now.getDay()];
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${dName}, ${dd}/${mm}/${yyyy}`;
  }, []);

  // Show spinner while checking auth
  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#fffaf5] flex flex-col justify-center items-center">
        <div className="size-10 border-4 border-[#176448]/20 border-t-[#176448] rounded-full animate-spin" />
        <p className="mt-4 text-xs font-semibold text-emerald-900 tracking-wider">
          ĐANG TẢI MEEHOA TIME...
        </p>
      </div>
    );
  }

  // If not logged in, enforce login screen
  if (!activeUser) {
    return (
      <LoginScreen
        storeName={shopSettings.storeName}
        onLoginSuccess={(user) => {
          setActiveUser(user);
          setCurrentUserProfile(user);
          void checkAuthAndLoad();
        }}
      />
    );
  }

  const isManager =
    activeUser.role === 'owner' || activeUser.role === 'admin';

  return (
    <main className="min-h-screen bg-background pb-28 text-foreground sm:pb-12">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() =>
                setTab(activeUser.role === 'employee' ? 'checkin' : 'overview')
              }
              className="flex items-center gap-3 text-left focus:outline-none"
              aria-label="Về trang chủ"
            >
              <div className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-sm">
                M
              </div>
              <div>
                <p className="text-sm font-bold tracking-tight">MEEHOA TIME</p>
                <p className="text-[11px] text-muted-foreground">
                  {shopSettings.storeName}
                </p>
              </div>
            </button>
          </div>

          <nav className="hidden items-center gap-1 md:flex">
            {visibleTabs.map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  tab === id
                    ? 'bg-secondary text-primary'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                <Icon className="size-4" />
                {label}
                {id === 'approvals' && pendingApprovalsCount > 0 && (
                  <span className="grid size-5 place-items-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                    {pendingApprovalsCount}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (currentUserProfile?.role === 'owner' || currentUserProfile?.role === 'admin') {
                  setAuthModalOpen(true);
                }
              }}
              className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-bold shadow-xs hover:border-primary transition"
              aria-label="Tài khoản đăng nhập"
            >
              <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                {activeUser.initials}
              </span>
              <span className="max-w-[120px] truncate sm:max-w-[180px]">
                {activeUser.name}
              </span>
              <span
                className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                  activeUser.role === 'owner'
                    ? 'bg-purple-100 text-purple-700'
                    : activeUser.role === 'admin'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {activeUser.role}
              </span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Hôm nay · {todayLabel}</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {currentTitle}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-semibold shadow-xs">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Supabase Cloud (Singapore)</span>
            </div>
          </div>
        </div>

        {tab === 'overview' && (
          <OverviewTab
            fund={confirmedFund}
            pending={pendingAmount}
            pendingCount={pendingApprovalsCount}
            staff={staffList}
            grid={scheduleGrid}
            onNavigate={setTab}
          />
        )}

        {tab === 'schedule' && (
          <ScheduleTab
            weekDays={weekDays}
            currentOffset={currentWeekOffset}
            onChangeOffset={setCurrentWeekOffset}
            grid={scheduleGrid}
            setGrid={setScheduleGrid}
            staff={staffList}
            isManager={isManager}
            onSaved={handleSaveSchedule}
          />
        )}

        {tab === 'approvals' && (
          <ApprovalsTab items={approvals} onDecide={handleDecideApproval} />
        )}

        {tab === 'payroll' && (
          <PayrollTab
            staff={staffList}
            lines={payrollLines}
            fund={confirmedFund}
            pending={pendingAmount}
            isLocked={payrollLocked}
            onLock={handleLockPayroll}
            isManager={isManager}
            activeUser={activeUser}
          />
        )}

        {tab === 'checkin' && (
          <CheckinTab
            activeUser={activeUser}
            shopSettings={shopSettings}
            onPunchRecorded={(ev) => {
              setToast(
                ev === 'check_in'
                  ? 'Check-in GPS thành công! Chúc bạn ca làm việc vui vẻ.'
                  : 'Check-out GPS thành công! Hệ thống đã ghi nhận giờ làm.',
              );
            }}
          />
        )}

        {tab === 'settings' && (
          <SettingsTab
            settings={shopSettings}
            onUpdateSettings={handleUpdateShopSettings}
            staff={staffList}
            onUpdateStaff={setStaffList}
            onSaveStaffEdit={handleSaveStaffEdit}
            onAddNewStaff={handleAddNewStaff}
            wageHistories={wageHistories}
            onAddWageHistory={(wh) => setWageHistories((prev) => [wh, ...prev])}
            onSaved={(msg) => setToast(msg)}
          />
        )}

        {tab === 'profile' && (
          <ProfileTab
            user={activeUser}
            onSignOut={handleSignOut}
            onSwitchAccount={() => {
              if (currentUserProfile?.role === 'owner' || currentUserProfile?.role === 'admin') {
                setAuthModalOpen(true);
              } else {
                setToast('Bạn đang đăng nhập tài khoản nhân viên');
              }
            }}
          />
        )}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur-xl md:hidden">
        <div className="mx-auto grid max-w-lg grid-flow-col auto-cols-fr px-1 py-1.5">
          {visibleTabs.map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex flex-col items-center gap-1 rounded-xl py-1.5 text-[9px] font-semibold transition ${
                tab === id ? 'text-primary font-bold' : 'text-muted-foreground'
              }`}
            >
              <div className="relative">
                <Icon className="size-4" />
                {id === 'approvals' && pendingApprovalsCount > 0 && (
                  <span className="absolute -right-2 -top-1 grid size-3.5 place-items-center rounded-full bg-amber-500 text-[8px] font-bold text-white">
                    {pendingApprovalsCount}
                  </span>
                )}
              </div>
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {toast && (
        <output className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-[#17231d] px-4 py-2.5 text-xs font-semibold text-white shadow-xl sm:bottom-8">
          <CheckCircle2 className="size-4 text-emerald-400" />
          {toast}
        </output>
      )}

      {authModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4 backdrop-blur-xs">
          <button
            type="button"
            aria-label="Đóng nền"
            onClick={() => setAuthModalOpen(false)}
            className="fixed inset-0 -z-10 h-full w-full cursor-default border-0 bg-transparent p-0"
          />
          <section
            aria-label="Chuyển góc nhìn nhân sự"
            className="w-full max-w-md rounded-t-[28px] bg-card p-6 shadow-2xl sm:rounded-[28px]"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow">Quản lý góc nhìn</p>
                <h2 className="mt-1 text-xl font-bold">
                  Chọn nhân sự cần xem
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setAuthModalOpen(false)}
                aria-label="Đóng cửa sổ"
                className="grid size-9 place-items-center rounded-full bg-muted hover:bg-muted/80 transition"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                Danh sách nhân sự cửa hàng ({staffList.length}):
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {staffList.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => handleSelectRole(user)}
                    className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition hover:border-primary ${
                      activeUser.id === user.id
                        ? 'border-primary bg-secondary/60 text-primary'
                        : 'bg-background'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-8 place-items-center rounded-full bg-secondary text-xs font-bold text-primary">
                        {user.initials}
                      </span>
                      <div>
                        <p className="text-sm font-bold text-foreground">
                          {user.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {user.employeeCode} · `${user.payrollType === 'hourly' ? 'Lương giờ' : 'Lương tháng'}`
                        </p>
                      </div>
                    </div>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                        user.role === 'owner'
                          ? 'bg-purple-100 text-purple-700'
                          : user.role === 'admin'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {user.role}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function OverviewTab({
  fund,
  pending,
  pendingCount,
  staff: _staff,
  grid,
  onNavigate,
}: {
  fund: number;
  pending: number;
  pendingCount: number;
  staff: UserProfile[];
  grid: Record<string, string[]>;
  onNavigate: (t: Tab) => void;
}) {
  const totalShiftsThisWeek = Object.values(grid).flat().filter((s) => s && s !== 'OFF').length;

  // Tính số ca làm việc hôm nay (Thứ 2 = 0, ..., CN = 6)
  const todayDay = new Date().getDay();
  const todayIndex = todayDay === 0 ? 6 : todayDay - 1;
  const now = new Date();
  const currentMin = now.getHours() * 60 + now.getMinutes();

  let activeWorkingCount = 0;
  const todayShiftsList: { name: string; shift: string; location: string }[] = [];

  for (const [name, shifts] of Object.entries(grid)) {
    const todayShift = shifts[todayIndex];
    if (todayShift && todayShift !== 'OFF') {
      todayShiftsList.push({
        name,
        shift: todayShift,
        location: 'Meehoasg - Tiệm Hoa Tươi Bình Thạnh',
      });
      const parts = todayShift.split('–');
      if (parts.length === 2) {
        const [sH, sM] = parts[0].split(':').map(Number);
        const [eH, eM] = parts[1].split(':').map(Number);
        const startMin = sH * 60 + (sM || 0);
        const endMin = eH * 60 + (eM || 0);
        if (currentMin >= startMin && currentMin <= endMin) {
          activeWorkingCount++;
        }
      }
    }
  }
  return (
    <>
      <section className="payroll-card overflow-hidden rounded-[28px] p-6 text-white shadow-xl shadow-emerald-950/15 sm:p-8">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.15em] text-emerald-100/75">
              Quỹ lương vận hành · Tháng hiện tại
            </p>
            <p className="mt-3 text-3xl font-bold tracking-[-.05em] sm:text-5xl">
              {formatMoney(fund)}
            </p>
            <p className="mt-2 text-xs sm:text-sm text-emerald-50/80">
              Đã xác nhận theo Payable thực tế và đơn giá hiệu lực
            </p>
          </div>
          <div className="grid size-12 place-items-center rounded-2xl bg-white/12 backdrop-blur-xs">
            <Sparkles className="size-6 text-emerald-200" />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 border-t border-white/15 pt-5">
          <div>
            <p className="text-xs text-emerald-100/70">
              Đang chờ giải trình / OT
            </p>
            <p className="mt-1 text-base font-bold sm:text-lg">
              {formatMoney(pending)}
            </p>
          </div>
          <div>
            <p className="text-xs text-emerald-100/70">
              Dự kiến ngân sách tháng
            </p>
            <p className="mt-1 text-base font-bold sm:text-lg">
              {formatMoney(fund + pending)}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => onNavigate('schedule')}
          className="rounded-2xl border bg-card p-4 text-left shadow-2xs hover:border-primary transition"
          aria-label="Xem ca có lịch"
        >
          <p className="text-2xl font-bold text-foreground">{totalShiftsThisWeek}</p>
          <p className="mt-1 text-xs text-muted-foreground">Có lịch tuần này</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('checkin')}
          className="rounded-2xl border bg-card p-4 text-left shadow-2xs hover:border-primary transition"
          aria-label="Xem nhân sự đang làm"
        >
          <p className="text-2xl font-bold text-emerald-600">{activeWorkingCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">Đang trong ca</p>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('approvals')}
          className="rounded-2xl border bg-card p-4 text-left shadow-2xs hover:border-amber-500 transition"
          aria-label="Xem mục cần chú ý"
        >
          <p className="text-2xl font-bold text-amber-600">{pendingCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">Cần duyệt gấp</p>
        </button>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="eyebrow">Trực tiếp hôm nay</p>
            <h2 className="mt-1 text-lg font-bold tracking-tight">
              Ca làm việc tại shop
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('schedule')}
            className="text-xs font-semibold text-primary hover:underline"
          >
            Xem bảng xếp lịch
          </button>
        </div>

        {todayShiftsList.length === 0 ? (
          <div className="rounded-[24px] border bg-card p-8 text-center text-muted-foreground shadow-2xs">
            <CalendarDays className="size-8 mx-auto mb-2 text-muted-foreground/50" />
            <p className="font-semibold text-sm text-foreground">Hôm nay chưa có ca làm việc nào được xếp</p>
            <p className="text-xs mt-1">Quản lý có thể vào mục &quot;Xếp lịch&quot; để phân công ca cho nhân viên.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[24px] border bg-card shadow-2xs">
            {todayShiftsList.map((item, i) => (
              <div
                key={item.name}
                className={`flex items-center gap-3 p-4 sm:px-5 ${i ? 'border-t' : ''}`}
              >
                <div className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-primary">
                  {item.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-sm">{item.name}</p>
                    <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-bold">
                      {item.shift}
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock3 className="size-3" />
                    {item.shift} · {item.location}
                  </p>
                </div>
                <MapPin className="size-4 text-emerald-600 shrink-0" />
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function ScheduleTab({
  weekDays,
  currentOffset,
  onChangeOffset,
  grid,
  setGrid,
  staff: _staff,
  isManager,
  onSaved,
}: {
  weekDays: ReturnType<typeof getWeekDays>;
  currentOffset: number;
  onChangeOffset: (offset: number) => void;
  grid: Record<string, string[]>;
  setGrid: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  staff: UserProfile[];
  isManager: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState<{
    name: string;
    dayIndex: number;
  } | null>(null);
  const [draftShift, setDraftShift] = useState('');
  const [importCsvModal, setImportCsvModal] = useState(false);
  const [csvText, setCsvText] = useState('');

  const standardPresets = [
    { label: 'Sáng (08:00–12:00)', val: '08:00–12:00' },
    { label: 'Chiều (12:00–16:00)', val: '12:00–16:00' },
    { label: 'Tối (16:00–21:30)', val: '16:00–21:30' },
    { label: 'Hành chính (08:00–16:00)', val: '08:00–16:00' },
    { label: 'Nguyên ngày (11:30–21:30)', val: '11:30–21:30' },
    { label: 'OFF (Nghỉ)', val: 'OFF' },
  ];

  const openCell = (name: string, dayIndex: number) => {
    if (!isManager) return;
    setEditing({ name, dayIndex });
    setDraftShift(grid[name]?.[dayIndex] || 'OFF');
  };

  const applyCell = () => {
    if (!editing) return;
    setGrid((prev) => {
      const existing = prev[editing.name] || Array(7).fill('OFF');
      const updated = [...existing];
      updated[editing.dayIndex] = draftShift || 'OFF';
      return { ...prev, [editing.name]: updated };
    });
    setEditing(null);
  };

  const parseShiftHours = (shiftStr: string): number => {
    if (!shiftStr || shiftStr === 'OFF') return 0;
    const parts = shiftStr.split('–');
    if (parts.length !== 2) return 4;
    const [startH, startM] = parts[0].split(':').map(Number);
    const [endH, endM] = parts[1].split(':').map(Number);
    const diffMin = endH * 60 + (endM || 0) - (startH * 60 + (startM || 0));
    return Math.max(0, Math.round((diffMin / 60) * 10) / 10);
  };

  const handleApplyCsv = () => {
    if (!csvText.trim()) return;
    const lines = csvText.trim().split('\n');
    const newGrid = { ...grid };
    for (const line of lines) {
      const parts = line.split(',').map((s) => s.trim());
      if (parts.length >= 8) {
        const name = parts[0];
        const shifts = parts.slice(1, 8);
        newGrid[name] = shifts;
      }
    }
    setGrid(newGrid);
    setImportCsvModal(false);
    onSaved();
  };

  return (
    <>
      <section className="mb-4 rounded-3xl border bg-card p-3 sm:p-4 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChangeOffset(currentOffset - 1)}
              aria-label="Tuần trước"
              className="grid size-10 place-items-center rounded-xl border bg-background hover:bg-muted transition"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="min-w-[140px] text-center">
              <p className="text-sm font-bold">
                {weekDays[0].date} — {weekDays[6].date}
              </p>
              <p className="text-xs text-muted-foreground">
                {currentOffset === 0
                  ? 'Tuần này'
                  : currentOffset > 0
                    ? `+${currentOffset} tuần`
                    : `${currentOffset} tuần`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onChangeOffset(currentOffset + 1)}
              aria-label="Tuần sau"
              className="grid size-10 place-items-center rounded-xl border bg-background hover:bg-muted transition"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          {isManager && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setImportCsvModal(true)}
                className="flex items-center gap-1.5 rounded-xl border bg-background px-3 py-2 text-xs font-bold hover:bg-muted transition"
                aria-label="Nhập lịch từ file CSV"
              >
                <FileSpreadsheet className="size-3.5" />
                <span className="hidden sm:inline">Import CSV</span>
              </button>

              <button
                type="button"
                onClick={onSaved}
                className="flex items-center gap-1.5 rounded-xl border bg-background px-3 py-2 text-xs font-bold hover:bg-muted transition"
                aria-label="Sao chép tuần trước"
              >
                <Copy className="size-3.5" />
                <span className="hidden sm:inline">Sao chép tuần trước</span>
              </button>

              <button
                type="button"
                onClick={onSaved}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-95 transition"
                aria-label="Lưu bảng lịch"
              >
                <Save className="size-3.5" />
                Lưu lịch
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="overflow-x-auto rounded-[24px] border bg-card shadow-2xs">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 w-44 border-b border-r bg-[#f4f7f4] px-4 py-3 text-left text-xs font-bold text-muted-foreground">
                NHÂN VIÊN
              </th>
              {weekDays.map((day) => (
                <th
                  key={day.iso}
                  className={`min-w-[110px] border-b border-r px-2 py-3 text-center last:border-r-0 ${
                    day.today
                      ? 'bg-emerald-50 text-emerald-900'
                      : 'bg-[#f4f7f4]'
                  }`}
                >
                  <span
                    className={`block text-xs font-bold ${day.today ? 'text-primary' : ''}`}
                  >
                    {day.short}
                  </span>
                  <span className="mt-0.5 block text-[11px] font-medium text-muted-foreground">
                    {day.date}
                  </span>
                </th>
              ))}
              <th className="w-20 border-b bg-[#f4f7f4] px-3 py-3 text-center text-xs font-bold text-muted-foreground">
                TỔNG
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(grid).length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-muted-foreground">
                  <p className="font-semibold text-sm">Chưa có lịch làm việc được xếp trong tuần này</p>
                  <p className="text-xs mt-1">Bấm &quot;Import CSV&quot; hoặc chọn ca để bắt đầu xếp lịch cho nhân viên.</p>
                </td>
              </tr>
            ) : (
              Object.entries(grid).map(([name, shifts], rowIndex) => {
              const totalHours = shifts.reduce(
                (sum, s) => sum + parseShiftHours(s),
                0,
              );
              return (
                <tr key={name} className="hover:bg-muted/20 transition">
                  <td
                    aria-label={name}
                    className="sticky left-0 z-10 border-b border-r bg-card px-4 py-3 text-left font-normal last:border-b-0"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-primary">
                        {name.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <span className="block font-bold text-sm text-foreground">
                          {name}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {rowIndex === 0 ? 'Part-time' : 'Toàn thời gian'}
                        </span>
                      </div>
                    </div>
                  </td>

                  {shifts.map((shift, dayIndex) => {
                    const isToday = weekDays[dayIndex]?.today;
                    const isOff = shift === 'OFF';
                    return (
                      <td
                        key={`${name}-${dayIndex}`}
                        className={`border-b border-r p-1.5 last:border-r-0 ${isToday ? 'bg-emerald-50/30' : ''}`}
                      >
                        <button
                          type="button"
                          onClick={() => openCell(name, dayIndex)}
                          disabled={!isManager}
                          aria-label={`Chỉnh sửa ca ${name} ngày ${weekDays[dayIndex].short}: ${shift}`}
                          className={`group min-h-14 w-full rounded-xl border p-1.5 text-center text-xs font-bold transition ${
                            isOff
                              ? 'border-transparent bg-muted/60 text-muted-foreground hover:border-border'
                              : 'border-emerald-100 bg-emerald-50 text-emerald-800 hover:border-primary hover:shadow-xs'
                          }`}
                        >
                          <span>{shift}</span>
                          {isManager && (
                            <span className="mt-1 hidden text-[10px] font-normal opacity-70 group-hover:block">
                              Chỉnh
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}

                  <td className="border-b px-2 py-3 text-center font-bold text-xs text-primary">
                    {totalHours}h
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4 backdrop-blur-xs">
          <button
            type="button"
            aria-label="Đóng nền"
            onClick={() => setEditing(null)}
            className="fixed inset-0 -z-10 h-full w-full cursor-default border-0 bg-transparent p-0"
          />
          <section
            aria-label="Chỉnh sửa ca làm việc"
            className="w-full max-w-md rounded-t-[28px] bg-card p-6 shadow-2xl sm:rounded-[28px]"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow">Xếp ca làm việc</p>
                <h2 className="mt-1 text-xl font-bold">
                  {editing.name} · {weekDays[editing.dayIndex].short} (
                  {weekDays[editing.dayIndex].date})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label="Đóng bảng chỉnh ca"
                className="grid size-9 place-items-center rounded-full bg-muted hover:bg-muted/80"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold text-muted-foreground mb-2">
                Chọn ca mẫu nhanh:
              </p>
              <div className="grid grid-cols-2 gap-2">
                {standardPresets.map((p) => (
                  <button
                    key={p.val}
                    type="button"
                    onClick={() => setDraftShift(p.val)}
                    className={`rounded-xl border p-2.5 text-left text-xs font-bold transition ${
                      draftShift === p.val
                        ? 'border-primary bg-secondary text-primary'
                        : 'bg-background hover:border-border'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-bold text-muted-foreground">
                <span>Hoặc giờ tùy chỉnh (HH:mm–HH:mm):</span>
                <input
                  type="text"
                  value={draftShift}
                  onChange={(e) => setDraftShift(e.target.value)}
                  placeholder="Ví dụ: 09:30–17:30"
                  className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-sm font-bold outline-none focus:ring-2 focus:ring-primary/25"
                />
              </label>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setDraftShift('OFF')}
                className="rounded-xl border px-4 py-2.5 text-xs font-bold hover:bg-muted transition"
              >
                Đặt OFF
              </button>
              <button
                type="button"
                onClick={applyCell}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-95 transition"
              >
                <Check className="size-4" />
                Áp dụng ca
              </button>
            </div>
          </section>
        </div>
      )}

      {importCsvModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4 backdrop-blur-xs">
          <button
            type="button"
            aria-label="Đóng nền"
            onClick={() => setImportCsvModal(false)}
            className="fixed inset-0 -z-10 h-full w-full cursor-default border-0 bg-transparent p-0"
          />
          <section
            aria-label="Nhập lịch từ CSV"
            className="w-full max-w-lg rounded-t-[28px] bg-card p-6 shadow-2xl sm:rounded-[28px]"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow">Dữ liệu hàng loạt</p>
                <h2 className="mt-1 text-xl font-bold">
                  Import lịch từ Google Sheet / CSV
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setImportCsvModal(false)}
                aria-label="Đóng cửa sổ"
                className="grid size-9 place-items-center rounded-full bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Dán các dòng từ bảng tính (định dạng: Tên, T2, T3, T4, T5, T6, T7,
              CN).
            </p>

            <label className="mt-3 block">
              <span className="sr-only">Nội dung CSV</span>
              <textarea
                rows={5}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder="Nga, 10:00–18:00, 10:00–18:00, OFF, 16:00–21:30, 10:00–18:00, OFF, OFF&#10;Tiên, 08:00–12:00, 12:00–16:00, 08:00–16:00, OFF, 08:00–12:00, 12:00–21:30, OFF"
                className="w-full rounded-xl border bg-background p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-primary/25"
              />
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setImportCsvModal(false)}
                className="rounded-xl border px-4 py-2 text-xs font-bold"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleApplyCsv}
                className="rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-xs"
              >
                Cập nhật vào bảng
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ApprovalsTab({
  items,
  onDecide,
}: {
  items: ApprovalItem[];
  onDecide: (id: string, approved: boolean) => void;
}) {
  const pendingItems = items.filter((i) => i.status === 'pending');

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="eyebrow">Hàng đợi kiểm duyệt</p>
          <h2 className="mt-1 text-lg font-bold">
            Ngoại lệ chấm công & Yêu cầu tăng ca
          </h2>
        </div>
        <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 border border-amber-200">
          {pendingItems.length} mục đang chờ
        </span>
      </div>

      {pendingItems.length === 0 ? (
        <div className="rounded-3xl border bg-card p-12 text-center shadow-2xs">
          <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
          <h3 className="mt-4 text-xl font-bold">Tất cả đã được giải quyết</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Không có ngoại lệ chấm công hoặc đơn OT nào đang tồn đọng.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pendingItems.map((item) => (
            <section
              key={item.id}
              className="rounded-3xl border bg-card p-5 shadow-2xs"
            >
              <div className="flex items-start gap-3.5">
                <div
                  className={`grid size-11 shrink-0 place-items-center rounded-2xl ${
                    item.kind === 'overtime'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {item.kind === 'overtime' ? (
                    <Clock3 className="size-5" />
                  ) : (
                    <AlertCircle className="size-5" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-foreground">
                      {item.employeeName} · {item.typeLabel}
                    </h3>
                    <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
                      Chờ Admin duyệt
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.dateStr} · Ca lịch: {item.shiftTime}
                    {item.actualTimes ? ` · Thực tế: ${item.actualTimes}` : ''}
                  </p>

                  <div className="mt-3 rounded-2xl bg-muted/60 p-4 text-xs leading-6">
                    <p className="font-semibold text-foreground">
                      Lý do giải trình:{' '}
                      <span className="font-normal">{item.reason}</span>
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      Bằng chứng GPS/Hệ thống: {item.evidence}
                    </p>
                    <p className="mt-2 font-bold text-primary">
                      Đề xuất tính công: {item.requestedPayable}
                    </p>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onDecide(item.id, true)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-95 transition"
                    >
                      <Check className="size-4" />
                      Duyệt & Cộng Payable
                    </button>
                    <button
                      type="button"
                      onClick={() => onDecide(item.id, false)}
                      className="flex items-center justify-center gap-1.5 rounded-xl border bg-background px-4 py-2.5 text-xs font-bold hover:bg-muted transition"
                    >
                      <X className="size-4" />
                      Từ chối
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function PayrollTab({
  staff,
  lines,
  fund,
  pending,
  isLocked,
  onLock,
  isManager,
  activeUser,
}: {
  staff: UserProfile[];
  lines: DbPayrollLine[];
  fund: number;
  pending: number;
  isLocked: boolean;
  onLock: () => void;
  isManager: boolean;
  activeUser: UserProfile;
}) {
  const displayStaff = isManager
    ? staff
    : staff.filter((s) => s.id === activeUser.id);
  const hasPending = pending > 0 || lines.some((line) => line.confidence === 'pending');

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border bg-card p-5 shadow-2xs">
          <p className="text-xs text-muted-foreground">Payable đã xác nhận</p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">
            {formatMoney(fund)}
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-2xs">
          <p className="text-xs text-muted-foreground">
            Tiền công Pending (Đang giữ)
          </p>
          <p className="mt-2 text-2xl font-bold text-amber-600">
            {formatMoney(pending)}
          </p>
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-2xs">
          <p className="text-xs text-muted-foreground">Trạng thái kỳ lương</p>
          <p className="mt-2 text-2xl font-bold text-foreground">
            {isLocked
              ? 'Đã khóa (Locked)'
              : hasPending
                ? 'Cần đối soát'
                : 'Sẵn sàng chốt'}
          </p>
        </div>
      </div>

      <section className="mt-6 overflow-hidden rounded-[24px] border bg-card shadow-2xs">
        <div className="border-b p-5">
          <p className="eyebrow">Chi tiết bảng lương tháng hiện tại</p>
          <h2 className="mt-1 text-xl font-bold">
            {isManager
              ? 'Toàn bộ nhân sự MEEHOA'
              : `Phiếu lương của ${activeUser.name}`}
          </h2>
        </div>

        <div>
          {displayStaff.map((p, i) => {
            const isHourly = p.payrollType === 'hourly';
            const line = lines.find((item) => item.employee_id === p.id);
            const payableHours = Math.round(
              (((line?.regular_minutes || 0) + (line?.overtime_minutes || 0)) / 60) * 10,
            ) / 10;
            const gross = Number(line?.gross_amount || 0);

            return (
              <div
                key={p.id}
                className={`flex flex-wrap items-center justify-between gap-3 p-4 sm:px-6 ${i ? 'border-t' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-primary">
                    {p.initials}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-sm text-foreground">
                        {p.name}
                      </p>
                      <span className="rounded-md bg-secondary px-2 py-0.5 text-[10px] font-bold text-primary">
                        {isHourly
                          ? `Lương giờ (${formatMoney(p.hourlyRate)}/h)`
                          : 'Lương tháng'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {`Payable thực tế: ${payableHours}h`}
                      {p.allowance
                        ? ` · Phụ cấp ${formatMoney(p.allowance)}`
                        : ''}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <p className="font-bold text-base text-foreground">
                    {formatMoney(gross)}
                  </p>
                  <p className={`text-[11px] font-semibold ${line?.confidence === 'pending' ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {line?.confidence === 'pending' ? 'Đang chờ đối soát' : 'Sẵn sàng thanh toán'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {isManager && (
        <div className="mt-5">
          <button
            type="button"
            onClick={onLock}
            disabled={isLocked || hasPending}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 text-sm font-bold text-primary-foreground shadow-md hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40 transition"
          >
            <Lock className="size-4" />
            {isLocked
              ? 'Bảng lương kỳ này đã được khóa và lưu Snapshot'
              : hasPending
                ? 'Cần duyệt hết các mục Pending trước khi khóa lương'
                : 'Khóa & Chốt bảng lương tháng hiện tại'}
          </button>
        </div>
      )}
    </>
  );
}

function CheckinTab({
  activeUser,
  shopSettings,
  onPunchRecorded,
}: {
  activeUser: UserProfile;
  shopSettings: { lat: number; lng: number; radius: number; storeName: string; requireGeofence?: boolean };
  onPunchRecorded: (ev: 'check_in' | 'check_out') => void;
}) {
  const [locating, setLocating] = useState(false);
  const [userCoords, setUserCoords] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
  } | null>(null);
  const [distanceToShop, setDistanceToShop] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [checkedIn, setCheckedIn] = useState(false);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [currentShift, setCurrentShift] = useState<Awaited<ReturnType<typeof fetchAttendanceShift>>>(null);

  const shopLocation = { lat: shopSettings.lat, lng: shopSettings.lng };

  useEffect(() => {
    if (!activeUser?.id) return;
    void (async () => {
      try {
        const events = await fetchTodayAttendance(activeUser.id);
        if (events && events.length > 0) {
          const latest = events[0];
          if (latest.event === 'check_in') {
            setCheckedIn(true);
            const t = new Date(latest.occurred_at).toLocaleTimeString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
            });
            setCheckInTime(t);
          } else {
            setCheckedIn(false);
          }
          if (latest.latitude && latest.longitude) {
            setUserCoords({
              lat: latest.latitude,
              lng: latest.longitude,
              accuracy: Math.round(latest.accuracy_meters || 0),
            });
          }
          if (typeof latest.distance_meters === 'number') {
            setDistanceToShop(Math.round(latest.distance_meters));
          }
        }
      } catch (err) {
        console.warn('Failed to load today punches:', err);
      }
    })();
  }, [activeUser?.id]);

  useEffect(() => {
    if (!activeUser?.id) return;
    void fetchAttendanceShift(activeUser.id)
      .then(setCurrentShift)
      .catch(() => setCurrentShift(null));
  }, [activeUser?.id]);

  const handleFetchGpsAndPunch = (eventType: 'check_in' | 'check_out') => {
    setLocating(true);

    if (!navigator.geolocation) {
      setLocating(false);
      setGpsError('Thiết bị/trình duyệt không hỗ trợ định vị GPS. Không thể chấm công.');
      return;
    }
    setGpsError(null);

    if (!currentShift) {
      setLocating(false);
      setGpsError('Hôm nay bạn chưa có ca làm việc được xếp. Vui lòng liên hệ quản lý.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const acc = Math.round(pos.coords.accuracy);
          setUserCoords({ lat, lng, accuracy: acc });

          const dist = Math.round(distanceMeters(shopLocation, { lat, lng }));
          setDistanceToShop(dist);

          if (acc > 150) {
            throw new Error('GPS_ACCURACY_TOO_LOW');
          }
          if (shopSettings.requireGeofence !== false && dist > shopSettings.radius) {
            throw new Error('OUTSIDE_GEOFENCE');
          }

          const saved = await recordAttendance({
            organizationId: activeUser.organizationId || '',
            employeeId: activeUser.id,
            shiftId: currentShift.id,
            event: eventType,
            lat,
            lng,
            accuracy: acc,
          });

          const savedTime = new Date(saved.occurred_at).toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
          });
          if (eventType === 'check_in') {
            setCheckedIn(true);
            setCheckInTime(savedTime);
            setCurrentShift({ ...currentShift, status: 'in_progress' });
          } else {
            setCheckedIn(false);
            setCurrentShift({ ...currentShift, status: 'completed' });
          }
          setGpsError(null);
          onPunchRecorded(eventType);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('OUTSIDE_GEOFENCE')) {
            setGpsError('Bạn đang ở ngoài phạm vi chấm công của shop.');
          } else if (msg.includes('GPS_ACCURACY_TOO_LOW')) {
            setGpsError('GPS chưa đủ chính xác. Hãy đứng yên vài giây, bật vị trí chính xác và thử lại.');
          } else if (msg.includes('NO_SCHEDULED_SHIFT') || msg.includes('SHIFT_NOT_FOUND')) {
            setGpsError('Không tìm thấy ca làm việc hợp lệ để chấm công.');
          } else if (msg.includes('ALREADY_CHECKED_IN')) {
            setGpsError('Ca này đã được check-in trước đó.');
          } else if (msg.includes('CHECK_IN_REQUIRED')) {
            setGpsError('Chưa có check-in hợp lệ cho ca này nên chưa thể check-out.');
          } else if (msg.includes('SHIFT_ALREADY_COMPLETED') || msg.includes('ALREADY_CHECKED_OUT')) {
            setGpsError('Ca này đã được check-out và hoàn tất.');
          } else {
            setGpsError('Chấm công chưa được ghi nhận. Vui lòng thử lại hoặc báo quản lý.');
          }
        } finally {
          setLocating(false);
        }
      },
      () => {
        setLocating(false);
        setGpsError('Không lấy được vị trí. Hãy bật GPS và cấp quyền vị trí cho trình duyệt rồi thử lại.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const isInside =
    distanceToShop !== null ? distanceToShop <= shopSettings.radius : true;
  const currentShiftLabel = currentShift
    ? `${new Date(currentShift.starts_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} — ${new Date(currentShift.ends_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
    : 'Chưa có ca hôm nay';
  const shiftCompleted = currentShift?.status === 'completed';

  return (
    <div className="mx-auto max-w-md">
      <section className="rounded-[32px] border bg-card p-6 text-center shadow-md">
        <div className="mx-auto grid size-16 place-items-center rounded-3xl bg-secondary text-primary shadow-xs">
          <LocateFixed className="size-8" />
        </div>

        <p className="mt-5 eyebrow">Ca làm việc hôm nay</p>
        <h2 className="mt-1 text-3xl font-bold tracking-tight">
          {currentShiftLabel}
        </h2>
        <p className="mt-2 text-xs text-muted-foreground flex items-center justify-center gap-1">
          <Building2 className="size-3.5" />
          {shopSettings.storeName} · Bán kính {shopSettings.radius}m
        </p>

        <div className="my-5 rounded-2xl border bg-muted/40 p-4 text-left">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground">
              Khoảng cách tới shop:
            </span>
            <span
              className={`text-xs font-bold ${
                distanceToShop === null
                  ? 'text-muted-foreground'
                  : isInside
                    ? 'text-emerald-700'
                    : 'text-amber-600'
              }`}
            >
              {distanceToShop === null
                ? 'Sẵn sàng lấy GPS'
                : `${distanceToShop}m (${isInside ? 'Trong vùng shop' : 'Ngoài vùng'})`}
            </span>
          </div>

          {gpsError && (
            <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
              {gpsError}
            </p>
          )}
          {userCoords && (
            <p className="mt-2 text-[11px] font-mono text-muted-foreground">
              GPS: {userCoords.lat.toFixed(5)}, {userCoords.lng.toFixed(5)} (±
              {userCoords.accuracy}m)
            </p>
          )}
        </div>

        {checkedIn ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-emerald-800">
              <CheckCircle2 className="mx-auto size-6 text-emerald-600" />
              <p className="mt-2 font-bold text-sm">
                Đã Check-in thành công lúc {checkInTime}
              </p>
              <p className="mt-1 text-xs text-emerald-700">
                Đang tích lũy giờ công Payable · Vui lòng check-out khi tan ca
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleFetchGpsAndPunch('check_out')}
              disabled={locating || !currentShift || shiftCompleted}
              className="w-full rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-bold text-rose-700 hover:bg-rose-100 transition disabled:opacity-50"
            >
              {locating ? 'Đang xác nhận tọa độ...' : 'Check-out kết thúc ca'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => handleFetchGpsAndPunch('check_in')}
            disabled={locating || !currentShift || shiftCompleted}
            className="w-full rounded-2xl bg-primary px-5 py-5 text-base font-bold text-primary-foreground shadow-lg shadow-emerald-950/15 hover:opacity-95 transition disabled:opacity-60"
          >
            {shiftCompleted
              ? 'Ca hôm nay đã hoàn tất'
              : locating
                ? 'Đang xác minh vị trí GPS...'
                : currentShift
                  ? 'Bấm Check-in bằng GPS'
                  : 'Chưa có ca để check-in'}
          </button>
        )}

        <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3.5 text-emerald-600" />
          Tọa độ được xác thực tự động và bảo mật bằng Idempotency Key
        </p>
      </section>
    </div>
  );
}

function SettingsTab({
  settings,
  onUpdateSettings,
  staff,
  onResetDemoData,
  onUpdateStaff,
  onSaveStaffEdit,
  onAddNewStaff,
  wageHistories,
  onAddWageHistory,
  onSaved,
}: {
  onSaveStaffEdit?: (staff: UserProfile) => void;
  onAddNewStaff?: (staff: UserProfile) => void;
  settings: ShopSettingsConfig;
  onUpdateSettings: (s: ShopSettingsConfig) => void;
  staff: UserProfile[];
  onUpdateStaff: React.Dispatch<React.SetStateAction<UserProfile[]>>;
  wageHistories: WageHistoryRecord[];
  onAddWageHistory: (wh: WageHistoryRecord) => void;
  onSaved: (msg: string) => void;
  onResetDemoData?: () => void;
}) {
  const [section, setSection] = useState<'salary' | 'rules' | 'history'>(
    'salary',
  );
  const [editingStaff, setEditingStaff] = useState<UserProfile | null>(null);
  const [addStaffModal, setAddStaffModal] = useState(false);
  const [bulkStaffModal, setBulkStaffModal] = useState(false);
  const [bulkStaffText, setBulkStaffText] = useState('');
  const [bulkStaffLoading, setBulkStaffLoading] = useState(false);

  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newRole, setNewRole] = useState<Role>('employee');
  const [newType, setNewType] = useState<PayrollType>('hourly');
  const [newRate, setNewRate] = useState(25000);

  const handleSaveStaffEdit = () => {
    if (!editingStaff) return;
    if (onSaveStaffEdit) {
      onSaveStaffEdit(editingStaff);
    }
    onUpdateStaff((prev) =>
      prev.map((s) => (s.id === editingStaff.id ? editingStaff : s)),
    );
    onAddWageHistory({
      id: 'wh-' + Date.now(),
      employeeName: editingStaff.name,
      payrollType: editingStaff.payrollType,
      rate:
        editingStaff.payrollType === 'hourly'
          ? editingStaff.hourlyRate
          : editingStaff.monthlySalary,
      effectiveDate: editingStaff.effectiveDate,
      note: 'Điều chỉnh mức lương',
      createdAt: new Date().toISOString().slice(0, 10),
    });
    setEditingStaff(null);
    onSaved('Đã cập nhật mức lương nhân viên');
  };

  const handleBulkStaffImport = async () => {
    const rows = bulkStaffText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (rows.length === 0) return;

    setBulkStaffLoading(true);
    try {
      const payload = rows.map((line) => {
        const [code, name, roleRaw = 'employee', typeRaw = 'hourly', rateRaw = '25000'] = line
          .split(',')
          .map((item) => item.trim());
        const payrollType: PayrollType = typeRaw.toLowerCase() === 'monthly' ? 'monthly' : 'hourly';
        const rate = Number(rateRaw.replace(/[^0-9]/g, '')) || 0;
        return {
          employeeCode: code,
          fullName: name,
          role: roleRaw.toLowerCase() === 'admin' ? ('admin' as const) : ('employee' as const),
          payrollType,
          hourlyRate: payrollType === 'hourly' ? rate : 0,
          monthlySalary: payrollType === 'monthly' ? rate : 0,
          effectiveDate: new Date().toISOString().slice(0, 10),
        };
      });

      const result = await bulkProvisionStaff(payload);
      const mapped = result.created.map((item) => mapDbProfileToUser(item.profile, settings.storeName));
      onUpdateStaff((prev) => [...prev, ...mapped]);
      const credentials = result.created
        .map((item) => `${item.employeeCode},${item.temporaryPassword}`)
        .join('\n');
      if (credentials && navigator.clipboard) {
        await navigator.clipboard.writeText(credentials).catch(() => undefined);
      }
      onSaved(
        result.failed.length
          ? `Đã tạo ${result.created.length} tài khoản, lỗi ${result.failed.length}. User/pass thành công đã copy.`
          : `Đã tạo ${result.created.length} tài khoản. Danh sách user/pass đã copy.`,
      );
      setBulkStaffModal(false);
      setBulkStaffText('');
    } catch (err: unknown) {
      onSaved('Lỗi import tài khoản: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBulkStaffLoading(false);
    }
  };

  const handleResetStaffPassword = async (profile: UserProfile) => {
    try {
      const result = await resetStaffPassword(profile.employeeCode);
      const credential = `${result.employeeCode},${result.temporaryPassword}`;
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(credential).catch(() => undefined);
      }
      onSaved(`Đã reset mật khẩu ${result.employeeCode}. User/pass tạm đã được copy.`);
    } catch (err: unknown) {
      onSaved('Lỗi reset mật khẩu: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleAddNewStaff = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newCode.trim()) return;
    const newMember: UserProfile = {
      id: 'user-' + Date.now(),
      employeeCode: newCode.toUpperCase(),
      name: newName,
      initials: newName.slice(0, 2).toUpperCase(),
      email: `${newCode.toLowerCase()}@meehoa.vn`,
      phone: '0900000000',
      role: newRole,
      payrollType: newType,
      hourlyRate: newType === 'hourly' ? newRate : 0,
      monthlySalary: newType === 'monthly' ? newRate : 0,
      allowance: 0,
      effectiveDate: new Date().toISOString().slice(0, 10),
      locationName: 'Meehoasg - Bình Thạnh',
    };
    if (onAddNewStaff) {
      onAddNewStaff(newMember);
    } else {
      onUpdateStaff((prev) => [...prev, newMember]);
      onSaved('Đã thêm hồ sơ nhân viên mới');
    }
    setAddStaffModal(false);
    setNewName('');
    setNewCode('');
  };

  return (
    <>
      <div className="mb-5 flex gap-2">
        <button
          type="button"
          onClick={() => setSection('salary')}
          className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
            section === 'salary'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'border bg-card text-muted-foreground hover:bg-muted'
          }`}
        >
          Hồ sơ lương nhân viên
        </button>
        <button
          type="button"
          onClick={() => setSection('rules')}
          className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
            section === 'rules'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'border bg-card text-muted-foreground hover:bg-muted'
          }`}
        >
          Quy tắc chấm công & GPS
        </button>
        <button
          type="button"
          onClick={() => setSection('history')}
          className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
            section === 'history'
              ? 'bg-primary text-primary-foreground shadow-xs'
              : 'border bg-card text-muted-foreground hover:bg-muted'
          }`}
        >
          Lịch sử thay đổi lương
        </button>
      </div>

      {section === 'salary' && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground">
              Mức lương áp dụng theo ngày hiệu lực
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBulkStaffModal(true)}
                className="flex items-center gap-1.5 rounded-xl border bg-background px-3 py-1.5 text-xs font-bold hover:bg-muted"
              >
                <FileSpreadsheet className="size-3.5" />
                Import tài khoản CSV
              </button>
              <button
                type="button"
                onClick={() => setAddStaffModal(true)}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-95"
              >
                <Plus className="size-3.5" />
                Thêm nhân viên
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-[24px] border bg-card shadow-2xs">
            {staff.map((profile, i) => (
              <button
                key={profile.id}
                type="button"
                aria-label={`Chỉnh sửa lương của ${profile.name}`}
                onClick={() => setEditingStaff({ ...profile })}
                className={`flex w-full items-center justify-between p-4 text-left transition hover:bg-muted/30 ${
                  i ? 'border-t' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-primary">
                    {profile.initials}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-sm text-foreground">
                        {profile.name}
                      </p>
                      <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-primary">
                        {profile.employeeCode} ·{' '}
                        {profile.payrollType === 'hourly'
                          ? 'Theo giờ'
                          : 'Lương tháng'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Áp dụng từ {profile.effectiveDate}
                      {profile.allowance
                        ? ` · Phụ cấp ${formatMoney(profile.allowance)}`
                        : ''}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <p className="font-bold text-sm text-foreground">
                    {formatMoney(
                      profile.payrollType === 'hourly'
                        ? profile.hourlyRate
                        : profile.monthlySalary,
                    )}
                    {profile.payrollType === 'hourly' && (
                      <span className="text-xs font-normal text-muted-foreground">
                        /h
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] font-semibold text-primary">
                    <Pencil className="size-3" />
                    Chỉnh sửa
                  </p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {section === 'rules' && (
        <div className="space-y-3">
          <div className="rounded-2xl border bg-card p-4 sm:p-5 flex items-center justify-between">
            <div>
              <p className="font-bold text-sm">
                Thời gian ân hạn đi trễ (Grace period)
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Khoảng phút đến trễ vẫn được chấp nhận mà không tính vi phạm.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={settings.graceMinutes}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      graceMinutes: Number(e.target.value),
                    })
                  }
                  className="h-10 w-16 rounded-xl border bg-background text-center font-bold text-sm"
                />
                <span className="text-xs font-bold">phút</span>
              </label>
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-4 sm:p-5 flex items-center justify-between">
            <div>
              <p className="font-bold text-sm">Bán kính Geofence cửa hàng</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Khoảng cách tối đa (mét) tính từ tọa độ shop ({settings.lat},{' '}
                {settings.lng}).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5">
                <input
                  type="number"
                  min="30"
                  max="1000"
                  value={settings.radius}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      radius: Number(e.target.value),
                    })
                  }
                  className="h-10 w-20 rounded-xl border bg-background text-center font-bold text-sm"
                />
                <span className="text-xs font-bold">mét</span>
              </label>
            </div>
          </div>

          <div className="rounded-2xl border bg-card p-4 sm:p-5 flex items-center justify-between">
            <div>
              <p className="font-bold text-sm">Làm tròn giờ công</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Quy tắc làm tròn sau khi đủ check-in và check-out.
              </p>
            </div>
            <label className="block">
              <span className="sr-only">Làm tròn giờ công</span>
              <select
                value={settings.roundingMinutes}
                onChange={(e) =>
                  onUpdateSettings({
                    ...settings,
                    roundingMinutes: Number(e.target.value),
                  })
                }
                className="h-10 rounded-xl border bg-background px-3 text-xs font-bold"
              >
                <option value="0">Không làm tròn (từng phút)</option>
                <option value="5">Làm tròn 5 phút</option>
                <option value="15">Làm tròn 15 phút</option>
              </select>
            </label>
          </div>

          <div className="rounded-2xl border bg-card p-4 sm:p-5 flex items-center justify-between">
            <div>
              <p className="font-bold text-sm">Tăng ca (OT) cần Admin duyệt</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Checkout muộn không tự động cộng vào giờ công tính lương.
              </p>
            </div>
            <Switch
              checked={settings.requireOtApproval}
              onCheckedChange={(c) =>
                onUpdateSettings({ ...settings, requireOtApproval: c })
              }
            />
          </div>

          <div className="rounded-2xl border bg-card p-4 sm:p-5 flex items-center justify-between">
            <div>
              <p className="font-bold text-sm">
                Giữ công khi thiếu check-in/out
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ca thiếu punch được chuyển sang Pending chờ giải trình.
              </p>
            </div>
            <Switch
              checked={settings.holdIncomplete}
              onCheckedChange={(c) =>
                onUpdateSettings({ ...settings, holdIncomplete: c })
              }
            />
          </div>

          <button
            type="button"
            onClick={() => onSaved('Đã lưu quy tắc chấm công & Geofence')}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3.5 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-95"
          >
            <Save className="size-4" />
            Lưu thiết lập quy tắc
          </button>
        </div>
      )}

      
        {/* Khởi tạo & Dọn sạch dữ liệu */}
        <section className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="font-bold text-foreground text-sm">Khởi tạo & Dọn dẹp dữ liệu</p>
              <p className="text-xs text-muted-foreground mt-1">
                Xóa sạch các ca làm việc, giải trình và lịch sử lương mẫu để bắt đầu vận hành chính thức từ đầu.
              </p>
            </div>
            {onResetDemoData && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Bạn có chắc muốn xóa sạch toàn bộ dữ liệu mẫu (lịch tuần, đơn duyệt) để đưa bảng về trống?')) {
                    onResetDemoData();
                  }
                }}
                className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs font-semibold text-destructive hover:bg-destructive/20 transition-colors shrink-0"
              >
                Dọn sạch dữ liệu mẫu
              </button>
            )}
          </div>
        </section>

        {section === 'history' && (
        <div className="overflow-hidden rounded-[24px] border bg-card shadow-2xs">
          <div className="p-4 border-b">
            <h3 className="font-bold text-sm">
              Nhật ký thay đổi mức lương có hiệu lực
            </h3>
          </div>
          {wageHistories.map((wh, idx) => (
            <div
              key={wh.id}
              className={`p-4 flex items-center justify-between ${idx ? 'border-t' : ''}`}
            >
              <div>
                <p className="font-bold text-sm text-foreground">
                  {wh.employeeName}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {wh.note} · Hiệu lực từ {wh.effectiveDate}
                </p>
              </div>
              <div className="text-right">
                <span className="font-bold text-sm text-primary">
                  {formatMoney(wh.rate)}
                </span>
                <p className="text-[10px] text-muted-foreground">
                  Ghi nhận: {wh.createdAt}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingStaff && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4 backdrop-blur-xs">
          <button
            type="button"
            aria-label="Đóng nền"
            onClick={() => setEditingStaff(null)}
            className="fixed inset-0 -z-10 h-full w-full cursor-default border-0 bg-transparent p-0"
          />
          <section
            aria-label="Thiết lập lương nhân viên"
            className="w-full max-w-md rounded-t-[28px] bg-card p-6 shadow-2xl sm:rounded-[28px]"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow">Hồ sơ nhân viên</p>
                <h2 className="mt-1 text-xl font-bold">
                  {editingStaff.name} ({editingStaff.employeeCode})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditingStaff(null)}
                aria-label="Đóng bảng sửa lương"
                className="grid size-9 place-items-center rounded-full bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="block text-xs font-bold text-muted-foreground">
                <span>Hình thức lương</span>
                <select
                  value={editingStaff.payrollType}
                  onChange={(e) =>
                    setEditingStaff({
                      ...editingStaff,
                      payrollType: e.target.value as PayrollType,
                    })
                  }
                  className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-sm font-bold"
                >
                  <option value="hourly">Theo giờ (Hourly)</option>
                  <option value="monthly">Lương tháng cố định (Monthly)</option>
                </select>
              </label>

              <label className="block text-xs font-bold text-muted-foreground">
                <span>
                  {editingStaff.payrollType === 'hourly'
                    ? 'Đơn giá mỗi giờ (VND)'
                    : 'Lương tháng chuẩn (VND)'}
                </span>
                <input
                  type="number"
                  value={
                    editingStaff.payrollType === 'hourly'
                      ? editingStaff.hourlyRate
                      : editingStaff.monthlySalary
                  }
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (editingStaff.payrollType === 'hourly') {
                      setEditingStaff({ ...editingStaff, hourlyRate: val });
                    } else {
                      setEditingStaff({ ...editingStaff, monthlySalary: val });
                    }
                  }}
                  className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-sm font-bold"
                />
              </label>

              <label className="block text-xs font-bold text-muted-foreground">
                <span>Phụ cấp cố định (VND)</span>
                <input
                  type="number"
                  value={editingStaff.allowance}
                  onChange={(e) =>
                    setEditingStaff({
                      ...editingStaff,
                      allowance: Number(e.target.value),
                    })
                  }
                  className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-sm font-bold"
                />
              </label>

              <label className="block text-xs font-bold text-muted-foreground">
                <span>Ngày bắt đầu áp dụng</span>
                <input
                  type="date"
                  value={editingStaff.effectiveDate}
                  onChange={(e) =>
                    setEditingStaff({
                      ...editingStaff,
                      effectiveDate: e.target.value,
                    })
                  }
                  className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-sm font-bold"
                />
              </label>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void handleResetStaffPassword(editingStaff)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border bg-background px-4 py-3 text-xs font-bold hover:bg-muted"
              >
                <Lock className="size-4" />
                Reset mật khẩu
              </button>
              <button
                type="button"
                onClick={handleSaveStaffEdit}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-95"
              >
                <Save className="size-4" />
                Lưu thay đổi mức lương
              </button>
            </div>
          </section>
        </div>
      )}

      {bulkStaffModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4 backdrop-blur-xs">
          <button
            type="button"
            aria-label="Đóng nền"
            onClick={() => setBulkStaffModal(false)}
            className="fixed inset-0 -z-10 h-full w-full cursor-default border-0 bg-transparent p-0"
          />
          <section className="w-full max-w-lg rounded-t-[28px] bg-card p-6 shadow-2xl sm:rounded-[28px]">
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow">Tạo tài khoản hàng loạt</p>
                <h2 className="mt-1 text-xl font-bold">Import nhân viên từ CSV</h2>
              </div>
              <button type="button" onClick={() => setBulkStaffModal(false)} className="grid size-9 place-items-center rounded-full bg-muted">
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Mỗi dòng: Mã NV, Họ tên, role, loại lương, mức lương. Ví dụ: NV02, Nga, employee, hourly, 25000
            </p>
            <textarea
              rows={8}
              value={bulkStaffText}
              onChange={(e) => setBulkStaffText(e.target.value)}
              placeholder="NV02, Nga, employee, hourly, 25000&#10;NV03, Tiên, employee, monthly, 8000000"
              className="mt-3 w-full rounded-xl border bg-background p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-primary/25"
            />
            <button
              type="button"
              onClick={() => void handleBulkStaffImport()}
              disabled={bulkStaffLoading || !bulkStaffText.trim()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground disabled:opacity-50"
            >
              <Users className="size-4" />
              {bulkStaffLoading ? 'Đang tạo tài khoản...' : 'Tạo toàn bộ & copy user/pass'}
            </button>
          </section>
        </div>
      )}

      {addStaffModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4 backdrop-blur-xs">
          <button
            type="button"
            aria-label="Đóng nền"
            onClick={() => setAddStaffModal(false)}
            className="fixed inset-0 -z-10 h-full w-full cursor-default border-0 bg-transparent p-0"
          />
          <section
            aria-label="Thêm hồ sơ nhân viên mới"
            className="w-full max-w-md rounded-t-[28px] bg-card p-6 shadow-2xl sm:rounded-[28px]"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow">Quản lý nhân sự</p>
                <h2 className="mt-1 text-xl font-bold">Thêm nhân viên mới</h2>
              </div>
              <button
                type="button"
                onClick={() => setAddStaffModal(false)}
                aria-label="Đóng"
                className="grid size-9 place-items-center rounded-full bg-muted"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleAddNewStaff} className="mt-4 space-y-3">
              <label className="block text-xs font-bold text-muted-foreground">
                <span>Họ tên nhân viên</span>
                <input
                  required
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ví dụ: Lê Minh Anh"
                  className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-sm font-bold"
                />
              </label>

              <label className="block text-xs font-bold text-muted-foreground">
                <span>Mã nhân viên</span>
                <input
                  required
                  type="text"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="Ví dụ: NV05"
                  className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-sm font-bold"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-bold text-muted-foreground">
                  <span>Phân quyền</span>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as Role)}
                    className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-xs font-bold"
                  >
                    <option value="employee">Nhân viên</option>
                    <option value="admin">Quản lý (Admin)</option>
                  </select>
                </label>
                <label className="block text-xs font-bold text-muted-foreground">
                  <span>Loại lương</span>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as PayrollType)}
                    className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-xs font-bold"
                  >
                    <option value="hourly">Theo giờ</option>
                    <option value="monthly">Lương tháng</option>
                  </select>
                </label>
              </div>

              <label className="block text-xs font-bold text-muted-foreground">
                <span>
                  Mức lương {newType === 'hourly' ? 'mỗi giờ' : 'tháng'}
                </span>
                <input
                  type="number"
                  value={newRate}
                  onChange={(e) => setNewRate(Number(e.target.value))}
                  className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-sm font-bold"
                />
              </label>

              <button
                type="submit"
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-95"
              >
                <Plus className="size-4" />
                Tạo tài khoản + hồ sơ
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

function ProfileTab({
  user,
  onSignOut,
  onSwitchAccount,
}: {
  user: UserProfile;
  onSignOut: () => void;
  onSwitchAccount: () => void;
}) {
  return (
    <div className="mx-auto max-w-md">
      <section className="rounded-[32px] border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="grid size-16 place-items-center rounded-2xl bg-secondary text-xl font-bold text-primary">
            {user.initials}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-foreground">{user.name}</h2>
              <span
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                  user.role === 'owner'
                    ? 'bg-purple-100 text-purple-700'
                    : user.role === 'admin'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {user.role}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Mã NV: {user.employeeCode} · {user.locationName}
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-2 border-t pt-4 text-xs">
          <div className="flex justify-between py-2 border-b">
            <span className="text-muted-foreground">Tài khoản đăng nhập:</span>
            <span className="font-bold">{user.employeeCode}</span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-muted-foreground">Số điện thoại:</span>
            <span className="font-bold">{user.phone}</span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-muted-foreground">Hình thức lương:</span>
            <span className="font-bold">
              {user.payrollType === 'hourly'
                ? `Lương giờ (${formatMoney(user.hourlyRate)}/h)`
                : `Lương tháng (${formatMoney(user.monthlySalary)})`}
            </span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-muted-foreground">Ngày áp dụng:</span>
            <span className="font-bold">{user.effectiveDate}</span>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <button
            type="button"
            onClick={onSwitchAccount}
            className="flex w-full items-center justify-center gap-2 rounded-xl border bg-background px-4 py-3 text-xs font-bold hover:bg-muted transition"
          >
            <Users className="size-4 text-primary" />
            Đổi tài khoản hoặc phân quyền
          </button>

          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700 hover:bg-rose-100 transition"
          >
            <LogOut className="size-4" />
            Đăng xuất
          </button>
        </div>
      </section>
    </div>
  );
}
