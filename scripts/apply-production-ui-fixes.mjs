import fs from 'node:fs';

const path = 'app/page.tsx';
let src = fs.readFileSync(path, 'utf8');

function replaceRequired(label, before, after) {
  if (!src.includes(before)) {
    throw new Error(`Patch target not found: ${label}`);
  }
  src = src.replace(before, after);
}

replaceRequired(
  'data service imports',
`  fetchStaffProfiles,
  createStaffProfile,
  updateStaffProfile,
  fetchShopLocation,
  updateShopLocation,
  fetchShopSettings,
  updateShopSettings,
  fetchTodayAttendance,
  recordAttendance,
  fetchShiftsForRange,
  saveWeeklyShifts,
  fetchPendingApprovals,
  reviewApproval,
  fetchCurrentPayrollPeriod,
  lockPayroll,
  ApprovalItemData,
  DbProfile,
`,
`  fetchStaffProfiles,
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
  ApprovalItemData,
  DbPayrollLine,
  DbProfile,
`);

replaceRequired(
  'login state',
`  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');`,
`  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');`,
);
replaceRequired(
  'login validation',
`    if (!email.trim() || !password.trim()) {
      setErrorMsg('Vui lòng điền đầy đủ email và mật khẩu');`,
`    if (!loginId.trim() || !password.trim()) {
      setErrorMsg('Vui lòng điền đầy đủ mã nhân viên và mật khẩu');`,
);
replaceRequired(
  'login call',
`      const data = await signIn(email.trim(), password);`,
`      const data = await signIn(loginId.trim(), password);`,
);
replaceRequired(
  'invalid credential copy',
`        setErrorMsg('Email hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại.');`,
`        setErrorMsg('Mã nhân viên hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại.');`,
);
replaceRequired(
  'login intro copy',
`              Nhập email và mật khẩu được cấp để bắt đầu`,
`              Nhập mã nhân viên và mật khẩu được cấp để bắt đầu`,
);
replaceRequired(
  'login identifier field',
`              <label htmlFor="login-email" className="block text-xs font-bold text-foreground mb-1.5">
                Email đăng nhập
              </label>
              <input
                id="login-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vd: ql01@meehoa.vn"`,
`              <label htmlFor="login-id" className="block text-xs font-bold text-foreground mb-1.5">
                Mã nhân viên
              </label>
              <input
                id="login-id"
                type="text"
                autoCapitalize="characters"
                required
                value={loginId}
                onChange={(e) => setLoginId(e.target.value.toUpperCase())}
                placeholder="Ví dụ: NV01"`,
);

replaceRequired(
  'payroll state',
`  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [payrollLocked, setPayrollLocked] = useState(false);`,
`  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [payrollLocked, setPayrollLocked] = useState(false);
  const [payrollLines, setPayrollLines] = useState<DbPayrollLine[]>([]);`,
);

replaceRequired(
  'manager payroll load',
`          const period = await fetchCurrentPayrollPeriod(prof.organization_id);
          setPayrollLocked(period?.status === 'locked');
          setTab('overview');
        } else {
          setStaffList([user]);
          setTab('checkin');
        }`,
`          const period = await refreshPayrollPeriod();
          setPayrollLocked(period?.status === 'locked');
          if (period) setPayrollLines(await fetchPayrollLines(period.id));
          setTab('overview');
        } else {
          setStaffList([user]);
          const period = await fetchCurrentPayrollPeriod(prof.organization_id);
          setPayrollLocked(period?.status === 'locked');
          if (period) setPayrollLines(await fetchPayrollLines(period.id));
          setTab('checkin');
        }`,
);

replaceRequired(
  'fund calculations',
`  const pendingApprovalsCount = approvals.filter((a) => a.status === 'pending').length;
  const pendingAmount = approvals
    .filter((a) => a.status === 'pending')
    .reduce((sum, a) => sum + ((a.proposedMinutes || 0) * 25000) / 60, 0);

  const totalScheduledMinutes = Object.values(scheduleGrid)
    .flat()
    .reduce((sum, shiftStr) => {
      if (!shiftStr || shiftStr === 'OFF') return sum;
      const parts = shiftStr.split('–');
      if (parts.length !== 2) return sum;
      const [sH, sM] = parts[0].split(':').map(Number);
      const [eH, eM] = parts[1].split(':').map(Number);
      return sum + Math.max(0, (eH * 60 + (eM || 0)) - (sH * 60 + (sM || 0)));
    }, 0);
  const confirmedFund = Math.round((totalScheduledMinutes / 60) * 25000);`,
`  const pendingApprovalsCount = approvals.filter((a) => a.status === 'pending').length;
  const pendingAmount = payrollLines.reduce(
    (sum, line) => sum + Number(line.pending_amount || 0),
    0,
  );
  const confirmedFund = payrollLines.reduce(
    (sum, line) => sum + Number(line.gross_amount || 0),
    0,
  );`,
);

replaceRequired(
  'lock payroll handler',
`  const handleLockPayroll = async () => {
    if (!activeUser?.organizationId) return;
    try {
      const period = await fetchCurrentPayrollPeriod(activeUser.organizationId);
      if (period) {
        await lockPayroll(period.id, activeUser.organizationId, activeUser.id);
      }
      setPayrollLocked(true);
      setToast('Đã khóa snapshot bảng lương tháng này vào Supabase');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khóa bảng lương';
      setToast('Lỗi khóa bảng lương: ' + msg);
    }
  };`,
`  const handleLockPayroll = async () => {
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
  };`,
);

replaceRequired(
  'create staff handler',
`  const handleAddNewStaff = async (newMember: UserProfile) => {
    if (!activeUser?.organizationId) return;
    try {
      const loc = await fetchShopLocation();
      const created = await createStaffProfile({
        organization_id: activeUser.organizationId,
        employee_code: newMember.employeeCode,
        full_name: newMember.name,
        email: newMember.email,
        phone: newMember.phone,
        role: newMember.role,
        payroll_type: newMember.payrollType,
        hourly_rate: newMember.hourlyRate,
        monthly_salary: newMember.monthlySalary,
        effective_date: newMember.effectiveDate,
        location_id: loc?.id || null,
        active: true,
      });
      if (created) {
        const mapped = mapDbProfileToUser(created, loc?.name);
        setStaffList((prev) => [...prev, mapped]);
        setToast(\`Đã thêm nhân viên \${newMember.name} vào Supabase\`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi thêm nhân viên';
      setToast('Lỗi thêm nhân viên: ' + msg);
    }
  };`,
`  const handleAddNewStaff = async (newMember: UserProfile) => {
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
      const credential = \`\${result.employeeCode} / \${result.temporaryPassword}\`;
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(credential).catch(() => undefined);
      }
      setToast(\`Đã tạo \${result.employeeCode}. User/pass tạm đã được copy.\`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi thêm nhân viên';
      setToast('Lỗi tạo tài khoản: ' + msg);
    }
  };`,
);

replaceRequired(
  'payroll tab call',
`          <PayrollTab
            staff={staffList}
            fund={confirmedFund}`, 
`          <PayrollTab
            staff={staffList}
            lines={payrollLines}
            fund={confirmedFund}`,
);

replaceRequired(
  'payroll props',
`function PayrollTab({
  staff,
  fund,
  pending,
  isLocked,
  onLock,
  isManager,
  activeUser,
}: {
  staff: UserProfile[];
  fund: number;`,
`function PayrollTab({
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
  fund: number;`,
);
replaceRequired(
  'payroll display helper',
`  const displayStaff = isManager
    ? staff
    : staff.filter((s) => s.id === activeUser.id);

  return (`,
`  const displayStaff = isManager
    ? staff
    : staff.filter((s) => s.id === activeUser.id);
  const hasPending = pending > 0 || lines.some((line) => line.confidence === 'pending');

  return (`,
);
replaceRequired(
  'payroll status',
`              : pending > 0
                ? 'Cần đối soát'`,
`              : hasPending
                ? 'Cần đối soát'`,
);
replaceRequired(
  'payroll month label',
`          <p className="eyebrow">Chi tiết bảng lương tháng 09/2026</p>`,
`          <p className="eyebrow">Chi tiết bảng lương tháng hiện tại</p>`,
);
replaceRequired(
  'payroll hardcoded row',
`          {displayStaff.map((p, i) => {
            const isHourly = p.payrollType === 'hourly';
            const payableHours = isHourly ? (i === 1 ? 158.4 : 142) : 208;
            const baseAmount = isHourly
              ? payableHours * p.hourlyRate
              : p.monthlySalary;
            const gross = baseAmount + p.allowance;`,
`          {displayStaff.map((p, i) => {
            const isHourly = p.payrollType === 'hourly';
            const line = lines.find((item) => item.employee_id === p.id);
            const payableHours = Math.round(
              (((line?.regular_minutes || 0) + (line?.overtime_minutes || 0)) / 60) * 10,
            ) / 10;
            const gross = Number(line?.gross_amount || 0);`,
);
replaceRequired(
  'payroll hours copy',
`                      {isHourly
                        ? \`Payable: \${payableHours}h\`
                        : '26 ngày công chuẩn (208h)'}`,
`                      {\`Payable thực tế: \${payableHours}h\`}`,
);
replaceRequired(
  'payroll row status',
`                  <p className="text-[11px] font-semibold text-emerald-600">
                    Sẵn sàng thanh toán
                  </p>`,
`                  <p className={\`text-[11px] font-semibold \${line?.confidence === 'pending' ? 'text-amber-600' : 'text-emerald-600'}\`}>
                    {line?.confidence === 'pending' ? 'Đang chờ đối soát' : 'Sẵn sàng thanh toán'}
                  </p>`,
);
replaceRequired(
  'payroll lock pending condition',
`            disabled={isLocked || pending > 0}`, 
`            disabled={isLocked || hasPending}`,
);
replaceRequired(
  'payroll lock pending text',
`              : pending > 0
                ? 'Cần duyệt hết các mục Pending trước khi khóa lương'
                : 'Khóa & Chốt bảng lương tháng 09'}`,
`              : hasPending
                ? 'Cần duyệt hết các mục Pending trước khi khóa lương'
                : 'Khóa & Chốt bảng lương tháng hiện tại'}`,
);

replaceRequired(
  'checkin settings type',
`  shopSettings: { lat: number; lng: number; radius: number; storeName: string };`,
`  shopSettings: { lat: number; lng: number; radius: number; storeName: string; requireGeofence?: boolean };`,
);
replaceRequired(
  'checkin shift state',
`  const [checkedIn, setCheckedIn] = useState(false);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);`,
`  const [checkedIn, setCheckedIn] = useState(false);
  const [checkInTime, setCheckInTime] = useState<string | null>(null);
  const [currentShift, setCurrentShift] = useState<Awaited<ReturnType<typeof fetchAttendanceShift>>>(null);`,
);
replaceRequired(
  'load current shift',
`  }, [activeUser?.id]);

  const handleFetchGpsAndPunch = (eventType: 'check_in' | 'check_out') => {`,
`  }, [activeUser?.id]);

  useEffect(() => {
    if (!activeUser?.id) return;
    void fetchAttendanceShift(activeUser.id)
      .then(setCurrentShift)
      .catch(() => setCurrentShift(null));
  }, [activeUser?.id]);

  const handleFetchGpsAndPunch = (eventType: 'check_in' | 'check_out') => {`,
);

replaceRequired(
  'secure punch handler',
`    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = Math.round(pos.coords.accuracy);
        setUserCoords({ lat, lng, accuracy: acc });

        const dist = Math.round(distanceMeters(shopLocation, { lat, lng }));
        setDistanceToShop(dist);

        const nowStr = new Date().toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
        });

        if (eventType === 'check_in') {
          setCheckedIn(true);
          setCheckInTime(nowStr);
        } else {
          setCheckedIn(false);
        }

        if (activeUser?.id && activeUser.organizationId) {
          void recordAttendance({
            organizationId: activeUser.organizationId,
            employeeId: activeUser.id,
            event: eventType,
            lat,
            lng,
            accuracy: acc,
            distance: dist,
            withinGeofence: dist <= shopSettings.radius,
          }).catch((err) => {
            console.error('Supabase punch record error:', err);
          });
        }

        onPunchRecorded(eventType);
      },`,
`    if (!currentShift) {
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
      },`,
);

replaceRequired(
  'checkin label helper',
`  const isInside =
    distanceToShop !== null ? distanceToShop <= shopSettings.radius : true;

  return (`,
`  const isInside =
    distanceToShop !== null ? distanceToShop <= shopSettings.radius : true;
  const currentShiftLabel = currentShift
    ? \`\${new Date(currentShift.starts_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} — \${new Date(currentShift.ends_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}\`
    : 'Chưa có ca hôm nay';
  const shiftCompleted = currentShift?.status === 'completed';

  return (`,
);
replaceRequired(
  'checkin hardcoded shift',
`          10:00 — 18:00`,
`          {currentShiftLabel}`,
);
replaceRequired(
  'checkout disabled',
`              disabled={locating}`,
`              disabled={locating || !currentShift || shiftCompleted}`,
);
replaceRequired(
  'checkin disabled and label',
`            disabled={locating}
            className="w-full rounded-2xl bg-primary px-5 py-5 text-base font-bold text-primary-foreground shadow-lg shadow-emerald-950/15 hover:opacity-95 transition disabled:opacity-60"
          >
            {locating ? 'Đang xác minh vị trí GPS...' : 'Bấm Check-in bằng GPS'}`,
`            disabled={locating || !currentShift || shiftCompleted}
            className="w-full rounded-2xl bg-primary px-5 py-5 text-base font-bold text-primary-foreground shadow-lg shadow-emerald-950/15 hover:opacity-95 transition disabled:opacity-60"
          >
            {shiftCompleted
              ? 'Ca hôm nay đã hoàn tất'
              : locating
                ? 'Đang xác minh vị trí GPS...'
                : currentShift
                  ? 'Bấm Check-in bằng GPS'
                  : 'Chưa có ca để check-in'}`,
);

replaceRequired(
  'bulk staff state',
`  const [addStaffModal, setAddStaffModal] = useState(false);

  const [newName, setNewName] = useState('');`,
`  const [addStaffModal, setAddStaffModal] = useState(false);
  const [bulkStaffModal, setBulkStaffModal] = useState(false);
  const [bulkStaffText, setBulkStaffText] = useState('');
  const [bulkStaffLoading, setBulkStaffLoading] = useState(false);

  const [newName, setNewName] = useState('');`,
);

replaceRequired(
  'bulk staff handler insertion',
`  const handleAddNewStaff = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newCode.trim()) return;`,
`  const handleBulkStaffImport = async () => {
    const rows = bulkStaffText
      .split('\\n')
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
        .map((item) => \`\${item.employeeCode},\${item.temporaryPassword}\`)
        .join('\\n');
      if (credentials && navigator.clipboard) {
        await navigator.clipboard.writeText(credentials).catch(() => undefined);
      }
      onSaved(
        result.failed.length
          ? \`Đã tạo \${result.created.length} tài khoản, lỗi \${result.failed.length}. User/pass thành công đã copy.\`
          : \`Đã tạo \${result.created.length} tài khoản. Danh sách user/pass đã copy.\`,
      );
      setBulkStaffModal(false);
      setBulkStaffText('');
    } catch (err: unknown) {
      onSaved('Lỗi import tài khoản: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setBulkStaffLoading(false);
    }
  };

  const handleAddNewStaff = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newCode.trim()) return;`,
);

replaceRequired(
  'salary action buttons',
`            <button
              type="button"
              onClick={() => setAddStaffModal(true)}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-95"
            >
              <Plus className="size-3.5" />
              Thêm nhân viên
            </button>`,
`            <div className="flex items-center gap-2">
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
            </div>`,
);

replaceRequired(
  'single staff button copy',
`                Tạo hồ sơ nhân viên`,
`                Tạo tài khoản + hồ sơ`,
);

replaceRequired(
  'bulk modal insertion',
`      {addStaffModal && (`,
`      {bulkStaffModal && (
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

      {addStaffModal && (`,
);

replaceRequired(
  'profile login label',
`            <span className="text-muted-foreground">Email đăng nhập:</span>
            <span className="font-bold">{user.email}</span>`,
`            <span className="text-muted-foreground">Tài khoản đăng nhập:</span>
            <span className="font-bold">{user.employeeCode}</span>`,
);

fs.writeFileSync(path, src);
console.log('Production UI patch applied successfully.');
