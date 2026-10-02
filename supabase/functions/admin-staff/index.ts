import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Role = 'admin' | 'employee';
type PayrollType = 'hourly' | 'monthly';

type StaffInput = {
  employeeCode: string;
  fullName: string;
  role: Role;
  payrollType: PayrollType;
  hourlyRate: number;
  monthlySalary: number;
  effectiveDate: string;
  phone?: string;
  password?: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getDefaultKey(name: 'SUPABASE_PUBLISHABLE_KEYS' | 'SUPABASE_SECRET_KEYS') {
  const raw = Deno.env.get(name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const candidate = parsed.default || Object.values(parsed)[0] || null;
    if (!candidate) return null;
    const resolved = Deno.env.get(candidate);
    if (resolved) return resolved;
    if (candidate.startsWith('sb_') || candidate.split('.').length === 3) return candidate;
    return null;
  } catch {
    return null;
  }
}

function normalizeEmployeeCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `Meehoa@${suffix}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey =
    getDefaultKey('SUPABASE_PUBLISHABLE_KEYS') || Deno.env.get('SUPABASE_ANON_KEY');
  const secretKey =
    getDefaultKey('SUPABASE_SECRET_KEYS') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = req.headers.get('Authorization');

  if (!supabaseUrl || !publishableKey || !secretKey || !authorization) {
    return json({ error: 'SERVER_AUTH_CONFIGURATION_MISSING' }, 500);
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'UNAUTHENTICATED' }, 401);

  const { data: actor, error: actorError } = await admin
    .from('profiles')
    .select('id, organization_id, role, active')
    .eq('id', userData.user.id)
    .single();
  if (actorError || !actor || !actor.active) return json({ error: 'PROFILE_NOT_ACTIVE' }, 403);
  if (!['owner', 'admin'].includes(actor.role)) return json({ error: 'MANAGER_REQUIRED' }, 403);

  const { data: location } = await admin
    .from('locations')
    .select('id')
    .eq('organization_id', actor.organization_id)
    .eq('active', true)
    .limit(1)
    .maybeSingle();

  async function createOne(staff: StaffInput) {
    const employeeCode = normalizeEmployeeCode(staff.employeeCode || '');
    if (!employeeCode || !staff.fullName?.trim()) throw new Error('INVALID_EMPLOYEE_DATA');
    if (!['admin', 'employee'].includes(staff.role)) throw new Error('INVALID_ROLE');
    if (staff.role === 'admin' && actor.role !== 'owner') {
      throw new Error('OWNER_REQUIRED_TO_CREATE_ADMIN');
    }
    if (!['hourly', 'monthly'].includes(staff.payrollType)) throw new Error('INVALID_PAYROLL_TYPE');

    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('organization_id', actor.organization_id)
      .eq('employee_code', employeeCode)
      .maybeSingle();
    if (existing) throw new Error('EMPLOYEE_CODE_ALREADY_EXISTS');

    const email = `${employeeCode.toLowerCase()}@auth.meehoasg.com`;
    const temporaryPassword = staff.password?.trim() || generatePassword();

    const { data: createdUser, error: createUserError } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      app_metadata: {
        organization_id: actor.organization_id,
        employee_code: employeeCode,
        role: staff.role,
      },
      user_metadata: { full_name: staff.fullName.trim() },
    });
    if (createUserError || !createdUser.user) {
      throw new Error(createUserError?.message || 'AUTH_USER_CREATE_FAILED');
    }

    const profilePayload = {
      id: createdUser.user.id,
      organization_id: actor.organization_id,
      employee_code: employeeCode,
      full_name: staff.fullName.trim(),
      email,
      phone: staff.phone?.trim() || null,
      role: staff.role,
      active: true,
      payroll_type: staff.payrollType,
      hourly_rate: staff.payrollType === 'hourly' ? Number(staff.hourlyRate || 0) : 0,
      monthly_salary: staff.payrollType === 'monthly' ? Number(staff.monthlySalary || 0) : 0,
      effective_date: staff.effectiveDate || new Date().toISOString().slice(0, 10),
      location_id: location?.id || null,
    };

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .insert(profilePayload)
      .select('*')
      .single();

    if (profileError || !profile) {
      await admin.auth.admin.deleteUser(createdUser.user.id);
      throw new Error(profileError?.message || 'PROFILE_CREATE_FAILED');
    }

    await admin.from('wage_histories').insert({
      organization_id: actor.organization_id,
      employee_id: profile.id,
      payroll_type: profile.payroll_type,
      hourly_rate: profile.hourly_rate,
      monthly_salary: profile.monthly_salary,
      effective_date: profile.effective_date,
      note: 'Khởi tạo tài khoản nhân viên',
      created_by: actor.id,
    });

    await admin.from('audit_logs').insert({
      organization_id: actor.organization_id,
      actor_id: actor.id,
      action: 'provision_staff',
      entity_type: 'profiles',
      entity_id: profile.id,
      metadata: { employee_code: employeeCode, role: staff.role },
    });

    return { profile, employeeCode, temporaryPassword };
  }

  try {
    const body = await req.json();

    if (body.action === 'create') {
      return json(await createOne(body.staff as StaffInput));
    }

    if (body.action === 'bulk_create') {
      const staff = Array.isArray(body.staff) ? (body.staff as StaffInput[]).slice(0, 100) : [];
      if (staff.length === 0) return json({ error: 'EMPTY_STAFF_LIST' }, 400);
      const created: unknown[] = [];
      const failed: Array<{ employeeCode: string; error: string }> = [];
      for (const item of staff) {
        try {
          created.push(await createOne(item));
        } catch (error) {
          failed.push({
            employeeCode: normalizeEmployeeCode(item?.employeeCode || ''),
            error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
          });
        }
      }
      return json({ created, failed });
    }

    if (body.action === 'reset_password') {
      const employeeCode = normalizeEmployeeCode(body.employeeCode || '');
      const { data: profile, error: profileError } = await admin
        .from('profiles')
        .select('id, employee_code, role')
        .eq('organization_id', actor.organization_id)
        .eq('employee_code', employeeCode)
        .single();
      if (profileError || !profile) return json({ error: 'EMPLOYEE_NOT_FOUND' }, 404);
      if (['owner', 'admin'].includes(profile.role) && actor.role !== 'owner') {
        return json({ error: 'OWNER_REQUIRED_FOR_PRIVILEGED_RESET' }, 403);
      }

      const temporaryPassword = generatePassword();
      const { error: resetError } = await admin.auth.admin.updateUserById(profile.id, {
        password: temporaryPassword,
      });
      if (resetError) throw resetError;

      await admin.from('audit_logs').insert({
        organization_id: actor.organization_id,
        actor_id: actor.id,
        action: 'reset_staff_password',
        entity_type: 'profiles',
        entity_id: profile.id,
        metadata: { employee_code: employeeCode },
      });

      return json({ employeeCode, temporaryPassword });
    }

    return json({ error: 'UNKNOWN_ACTION' }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'INTERNAL_ERROR' }, 400);
  }
});
