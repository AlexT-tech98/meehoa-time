import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }
const syntheticDomain = 'auth.meehoasg.com'

function getJsonKey(envName: string, fallbackName: string): string {
  const raw = Deno.env.get(envName)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.default) return parsed.default
    } catch {
      // fall through to legacy/default variable
    }
  }
  return Deno.env.get(fallbackName) ?? ''
}

function normalizeCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function loginEmail(code: string): string {
  return `${code.toLowerCase()}@${syntheticDomain}`
}

function generatePassword(length = 14): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%_-'
  const all = upper + lower + digits + symbols
  const bytes = new Uint8Array(Math.max(length, 12))
  crypto.getRandomValues(bytes)
  const chars = [
    upper[bytes[0] % upper.length],
    lower[bytes[1] % lower.length],
    digits[bytes[2] % digits.length],
    symbols[bytes[3] % symbols.length],
  ]
  for (let i = 4; i < bytes.length; i++) chars.push(all[bytes[i] % all.length])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[i % bytes.length] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = getJsonKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const secretKey = getJsonKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  const authHeader = req.headers.get('Authorization') ?? ''

  if (!supabaseUrl || !publishableKey || !secretKey || !authHeader.startsWith('Bearer ')) {
    return response({ error: 'SERVER_OR_AUTH_CONFIGURATION_ERROR' }, 401)
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const token = authHeader.replace(/^Bearer\s+/i, '')
  const { data: userData, error: userError } = await userClient.auth.getUser(token)
  const caller = userData?.user
  if (userError || !caller) return response({ error: 'INVALID_SESSION' }, 401)

  const { data: callerProfile, error: profileError } = await userClient
    .from('profiles')
    .select('id, organization_id, role, active, location_id')
    .eq('id', caller.id)
    .single()

  if (profileError || !callerProfile?.active || !['owner', 'admin'].includes(callerProfile.role)) {
    return response({ error: 'MANAGER_REQUIRED' }, 403)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return response({ error: 'INVALID_JSON' }, 400)
  }

  const action = String(body.action ?? '')

  if (action === 'create_many') {
    const staff = Array.isArray(body.staff) ? body.staff : []
    if (!staff.length || staff.length > 100) {
      return response({ error: 'STAFF_LIST_MUST_HAVE_1_TO_100_ROWS' }, 400)
    }

    let locationId = callerProfile.location_id as string | null
    if (!locationId) {
      const { data: loc } = await admin
        .from('locations')
        .select('id')
        .eq('organization_id', callerProfile.organization_id)
        .eq('active', true)
        .limit(1)
        .maybeSingle()
      locationId = loc?.id ?? null
    }

    const created: Array<{ employeeCode: string; fullName: string; password: string }> = []
    const errors: Array<{ row: number; employeeCode?: string; error: string }> = []

    for (let i = 0; i < staff.length; i++) {
      const raw = (staff[i] ?? {}) as Record<string, unknown>
      const code = normalizeCode(raw.employeeCode)
      const fullName = String(raw.fullName ?? '').trim()
      const role = String(raw.role ?? 'employee')
      const payrollType = String(raw.payrollType ?? 'hourly')
      const effectiveDate = String(raw.effectiveDate ?? new Date().toISOString().slice(0, 10))
      const hourlyRate = Math.max(0, Number(raw.hourlyRate ?? 0) || 0)
      const monthlySalary = Math.max(0, Number(raw.monthlySalary ?? 0) || 0)
      const password = String(raw.password ?? '').trim() || generatePassword()

      if (!/^[A-Z0-9_-]{2,20}$/.test(code)) {
        errors.push({ row: i + 1, employeeCode: code, error: 'Mã NV chỉ gồm A-Z, 0-9, _ hoặc -, dài 2-20 ký tự' })
        continue
      }
      if (!fullName) {
        errors.push({ row: i + 1, employeeCode: code, error: 'Thiếu tên nhân viên' })
        continue
      }
      if (!['employee', 'admin'].includes(role)) {
        errors.push({ row: i + 1, employeeCode: code, error: 'Role không hợp lệ' })
        continue
      }
      if (role === 'admin' && callerProfile.role !== 'owner') {
        errors.push({ row: i + 1, employeeCode: code, error: 'Chỉ owner được tạo admin' })
        continue
      }
      if (!['hourly', 'monthly'].includes(payrollType)) {
        errors.push({ row: i + 1, employeeCode: code, error: 'Loại lương không hợp lệ' })
        continue
      }
      if (password.length < 8) {
        errors.push({ row: i + 1, employeeCode: code, error: 'Mật khẩu tối thiểu 8 ký tự' })
        continue
      }

      const { data: existing } = await admin
        .from('profiles')
        .select('id')
        .eq('organization_id', callerProfile.organization_id)
        .eq('employee_code', code)
        .maybeSingle()
      if (existing) {
        errors.push({ row: i + 1, employeeCode: code, error: 'Mã nhân viên đã tồn tại' })
        continue
      }

      const email = loginEmail(code)
      const { data: authData, error: authError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, employee_code: code },
      })
      if (authError || !authData.user) {
        errors.push({ row: i + 1, employeeCode: code, error: authError?.message ?? 'Không tạo được tài khoản' })
        continue
      }

      const userId = authData.user.id
      const { error: insertError } = await admin.from('profiles').insert({
        id: userId,
        organization_id: callerProfile.organization_id,
        employee_code: code,
        full_name: fullName,
        email,
        role,
        active: true,
        payroll_type: payrollType,
        hourly_rate: payrollType === 'hourly' ? hourlyRate : 0,
        monthly_salary: payrollType === 'monthly' ? monthlySalary : 0,
        effective_date: effectiveDate,
        location_id: locationId,
      })

      if (insertError) {
        await admin.auth.admin.deleteUser(userId)
        errors.push({ row: i + 1, employeeCode: code, error: insertError.message })
        continue
      }

      await admin.from('wage_histories').insert({
        organization_id: callerProfile.organization_id,
        employee_id: userId,
        payroll_type: payrollType,
        hourly_rate: payrollType === 'hourly' ? hourlyRate : 0,
        monthly_salary: payrollType === 'monthly' ? monthlySalary : 0,
        effective_date: effectiveDate,
        note: 'Khởi tạo tài khoản nhân viên',
        created_by: caller.id,
      })

      created.push({ employeeCode: code, fullName, password })
    }

    return response({ created, errors })
  }

  if (action === 'reset_password') {
    const code = normalizeCode(body.employeeCode)
    if (!code) return response({ error: 'EMPLOYEE_CODE_REQUIRED' }, 400)

    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('id, employee_code, full_name, role')
      .eq('organization_id', callerProfile.organization_id)
      .eq('employee_code', code)
      .single()

    if (targetError || !target) return response({ error: 'EMPLOYEE_NOT_FOUND' }, 404)
    if (target.role === 'owner' && callerProfile.role !== 'owner') {
      return response({ error: 'OWNER_ONLY' }, 403)
    }

    const password = String(body.password ?? '').trim() || generatePassword()
    if (password.length < 8) return response({ error: 'PASSWORD_MIN_8' }, 400)

    const { error } = await admin.auth.admin.updateUserById(target.id, { password })
    if (error) return response({ error: error.message }, 400)

    return response({ employeeCode: target.employee_code, fullName: target.full_name, password })
  }

  return response({ error: 'UNKNOWN_ACTION' }, 400)
})
