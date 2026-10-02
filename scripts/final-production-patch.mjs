import fs from 'node:fs';

function patchFile(path, replacements) {
  let src = fs.readFileSync(path, 'utf8');
  for (const [label, before, after] of replacements) {
    if (!src.includes(before)) throw new Error(`Missing patch target: ${label}`);
    src = src.replace(before, after);
  }
  fs.writeFileSync(path, src);
}

patchFile('app/page.tsx', [
  [
    'reset password import',
    `  provisionStaff,\n  bulkProvisionStaff,\n  ApprovalItemData,`,
    `  provisionStaff,\n  bulkProvisionStaff,\n  resetStaffPassword,\n  ApprovalItemData,`,
  ],
  [
    'legacy manager login hint',
    `                placeholder="Ví dụ: NV01"`,
    `                placeholder="Ví dụ: NV01 (quản lý cũ có thể nhập email)"`,
  ],
  [
    'refresh payroll after approval',
    `      const updated = await fetchPendingApprovals(activeUser.organizationId);\n      setApprovals(updated);`,
    `      const updated = await fetchPendingApprovals(activeUser.organizationId);\n      setApprovals(updated);\n      const period = await refreshPayrollPeriod();\n      if (period) setPayrollLines(await fetchPayrollLines(period.id));`,
  ],
  [
    'reset handler',
    `  const handleAddNewStaff = (e: React.SyntheticEvent) => {`,
    `  const handleResetStaffPassword = async (profile: UserProfile) => {\n    try {\n      const result = await resetStaffPassword(profile.employeeCode);\n      const credential = \`${'${result.employeeCode}'},${'${result.temporaryPassword}'}\`;\n      if (navigator.clipboard) {\n        await navigator.clipboard.writeText(credential).catch(() => undefined);\n      }\n      onSaved(\`Đã reset mật khẩu ${'${result.employeeCode}'}. User/pass tạm đã được copy.\`);\n    } catch (err: unknown) {\n      onSaved('Lỗi reset mật khẩu: ' + (err instanceof Error ? err.message : String(err)));\n    }\n  };\n\n  const handleAddNewStaff = (e: React.SyntheticEvent) => {`,
  ],
  [
    'reset password button',
    `            <button\n              type="button"\n              onClick={handleSaveStaffEdit}\n              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-95"\n            >\n              <Save className="size-4" />\n              Lưu thay đổi mức lương\n            </button>`,
    `            <div className="mt-5 grid gap-2 sm:grid-cols-2">\n              <button\n                type="button"\n                onClick={() => void handleResetStaffPassword(editingStaff)}\n                className="flex w-full items-center justify-center gap-2 rounded-xl border bg-background px-4 py-3 text-xs font-bold hover:bg-muted"\n              >\n                <Lock className="size-4" />\n                Reset mật khẩu\n              </button>\n              <button\n                type="button"\n                onClick={handleSaveStaffEdit}\n                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-95"\n              >\n                <Save className="size-4" />\n                Lưu thay đổi mức lương\n              </button>\n            </div>`,
  ],
]);

patchFile('supabase/migrations/202610020001_production_readiness.sql', [
  [
    'detect incomplete attendance',
    `  select * into v_settings\n  from public.settings\n  where organization_id = v_org;\n\n  insert into public.payroll_lines(`,
    `  select * into v_settings\n  from public.settings\n  where organization_id = v_org;\n\n  -- Ended shifts with a missing punch must never silently become zero-pay ready rows.\n  insert into public.attendance_exceptions(\n    organization_id, employee_id, shift_id, kind, status, minutes\n  )\n  select\n    s.organization_id, s.employee_id, s.id, 'missing_check_in', 'open', null\n  from public.shifts s\n  where s.organization_id = v_org\n    and s.status <> 'cancelled'\n    and s.ends_at < now()\n    and s.starts_at >= v_period.starts_on::timestamptz\n    and s.starts_at < (v_period.ends_on + 1)::timestamptz\n    and not exists (\n      select 1 from public.attendance_events ae\n      where ae.shift_id = s.id and ae.employee_id = s.employee_id and ae.event = 'check_in'\n    )\n  on conflict (shift_id, kind) do nothing;\n\n  insert into public.attendance_exceptions(\n    organization_id, employee_id, shift_id, kind, status, minutes\n  )\n  select\n    s.organization_id, s.employee_id, s.id, 'missing_check_out', 'open', null\n  from public.shifts s\n  where s.organization_id = v_org\n    and s.status <> 'cancelled'\n    and s.ends_at < now()\n    and s.starts_at >= v_period.starts_on::timestamptz\n    and s.starts_at < (v_period.ends_on + 1)::timestamptz\n    and exists (\n      select 1 from public.attendance_events ae\n      where ae.shift_id = s.id and ae.employee_id = s.employee_id and ae.event = 'check_in'\n    )\n    and not exists (\n      select 1 from public.attendance_events ae\n      where ae.shift_id = s.id and ae.employee_id = s.employee_id and ae.event = 'check_out'\n    )\n  on conflict (shift_id, kind) do nothing;\n\n  insert into public.payroll_lines(`,
  ],
]);

console.log('Final production safety patch applied.');
