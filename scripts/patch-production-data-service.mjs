import fs from 'node:fs';

const path = 'lib/data-service.ts';
let src = fs.readFileSync(path, 'utf8');

function replaceRequired(label, before, after) {
  if (!src.includes(before)) throw new Error(`Patch target not found: ${label}`);
  src = src.replace(before, after);
}

replaceRequired(
  'staff compensation persistence',
`export async function updateStaffProfile(
  profileId: string,
  updates: Partial<DbProfile>,
): Promise<DbProfile | null> {
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
}`,
`export async function updateStaffProfile(
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
}`,
);

replaceRequired(
  'overnight attendance shift lookup',
`  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('employee_id', employeeId)
    .neq('status', 'cancelled')
    .gte('starts_at', start.toISOString())
    .lt('starts_at', end.toISOString())
    .order('starts_at');

  if (error || !data || data.length === 0) return null;
  const shifts = data as DbShift[];
  const inProgress = shifts.find((shift) => shift.status === 'in_progress');
  if (inProgress) return inProgress;

  const nowMs = now.getTime();
  return (
    shifts.find((shift) => {
      const starts = new Date(shift.starts_at).getTime() - 3 * 60 * 60 * 1000;
      const ends = new Date(shift.ends_at).getTime() + 3 * 60 * 60 * 1000;
      return nowMs >= starts && nowMs <= ends;
    }) || shifts[0]
  );`,
`  const end = new Date(start);
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
  );`,
);

replaceRequired(
  'attendance exception review RPC',
`  } else {
    const { error } = await supabase
      .from('attendance_exceptions')
      .update({
        status: approved ? 'approved' : 'rejected',
        resolved_at: new Date().toISOString(),
      })
      .eq('id', item.id);
    if (error) throw error;
  }`,
`  } else {
    const { error } = await supabase.rpc('review_attendance_exception', {
      p_exception_id: item.id,
      p_decision: approved ? 'approved' : 'rejected',
      p_review_note: approved
        ? 'Duyệt và khôi phục Payable từ MEEHOA TIME'
        : 'Từ chối từ MEEHOA TIME',
    });
    if (error) throw error;
  }`,
);

fs.writeFileSync(path, src);
console.log('Production data service patch applied.');
