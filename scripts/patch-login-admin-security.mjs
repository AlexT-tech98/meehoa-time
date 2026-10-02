import fs from 'node:fs';

function patch(path, replacements) {
  let src = fs.readFileSync(path, 'utf8');
  for (const [label, before, after] of replacements) {
    if (!src.includes(before)) throw new Error(`Patch target not found: ${label}`);
    src = src.replace(before, after);
  }
  fs.writeFileSync(path, src);
}

patch('lib/data-service.ts', [
  [
    'employee code login',
`function normalizeLoginId(loginId: string) {
  const value = loginId.trim();
  if (value.includes('@')) return value.toLowerCase();
  return \`${'${value.toLowerCase().replace(/\\s+/g, \'\')}'}@${'${AUTH_EMAIL_DOMAIN}'}\`;
}`,
`function normalizeLoginId(loginId: string) {
  return loginId.trim().toLowerCase();
}`,
  ],
  [
    'signin through employee-login',
`export async function signIn(loginId: string, pass: string) {
  if (!hasSupabase || !supabase) {
    throw new Error('Supabase chưa được cấu hình');
  }
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizeLoginId(loginId),
    password: pass,
  });
  if (error) throw error;
  return data;
}`,
`export async function signIn(loginId: string, pass: string) {
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
}`,
  ],
]);

patch('supabase/functions/admin-staff/index.ts', [
  [
    'managed key resolution',
`    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed.default || Object.values(parsed)[0] || null;`,
`    const parsed = JSON.parse(raw) as Record<string, string>;
    const candidate = parsed.default || Object.values(parsed)[0] || null;
    if (!candidate) return null;
    const resolved = Deno.env.get(candidate);
    if (resolved) return resolved;
    if (candidate.startsWith('sb_') || candidate.split('.').length === 3) return candidate;
    return null;`,
  ],
  [
    'admin creation owner only',
`    if (!['admin', 'employee'].includes(staff.role)) throw new Error('INVALID_ROLE');
    if (!['hourly', 'monthly'].includes(staff.payrollType)) throw new Error('INVALID_PAYROLL_TYPE');`,
`    if (!['admin', 'employee'].includes(staff.role)) throw new Error('INVALID_ROLE');
    if (staff.role === 'admin' && actor.role !== 'owner') {
      throw new Error('OWNER_REQUIRED_TO_CREATE_ADMIN');
    }
    if (!['hourly', 'monthly'].includes(staff.payrollType)) throw new Error('INVALID_PAYROLL_TYPE');`,
  ],
  [
    'privileged reset owner only',
`        .select('id, employee_code')
        .eq('organization_id', actor.organization_id)
        .eq('employee_code', employeeCode)
        .single();
      if (profileError || !profile) return json({ error: 'EMPLOYEE_NOT_FOUND' }, 404);

      const temporaryPassword = generatePassword();`,
`        .select('id, employee_code, role')
        .eq('organization_id', actor.organization_id)
        .eq('employee_code', employeeCode)
        .single();
      if (profileError || !profile) return json({ error: 'EMPLOYEE_NOT_FOUND' }, 404);
      if (['owner', 'admin'].includes(profile.role) && actor.role !== 'owner') {
        return json({ error: 'OWNER_REQUIRED_FOR_PRIVILEGED_RESET' }, 403);
      }

      const temporaryPassword = generatePassword();`,
  ],
]);

patch('app/page.tsx', [
  [
    'login placeholder',
`placeholder="Ví dụ: NV01 (quản lý cũ có thể nhập email)"`,
`placeholder="Ví dụ: QL01 hoặc NV01"`,
  ],
]);

console.log('Login and admin security patch applied.');
