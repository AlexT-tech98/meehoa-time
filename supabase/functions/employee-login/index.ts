import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

function getManagedKey(envName: string, fallbackName: string): string {
  const raw = Deno.env.get(envName)
  if (raw) {
    try {
      const parsed = JSON.parse(raw)
      const defaultRef = parsed?.default
      if (typeof defaultRef === 'string') {
        const resolved = Deno.env.get(defaultRef)
        if (resolved) return resolved
        if (defaultRef.startsWith('sb_') || defaultRef.split('.').length === 3) return defaultRef
      }
    } catch {
      // use fallback below
    }
  }
  return Deno.env.get(fallbackName) ?? ''
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reply({ error: 'INVALID_CREDENTIALS' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const publishableKey = getManagedKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
  const secretKey = getManagedKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !publishableKey || !secretKey) return reply({ error: 'LOGIN_UNAVAILABLE' }, 503)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return reply({ error: 'INVALID_CREDENTIALS' }, 401)
  }

  const employeeCode = String(body.employeeCode ?? '').trim().toUpperCase()
  const password = String(body.password ?? '')
  if (!/^[A-Z0-9_-]{2,20}$/.test(employeeCode) || !password) {
    return reply({ error: 'INVALID_CREDENTIALS' }, 401)
  }

  const admin = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Employee codes are unique inside an organization. MEEHOA TIME currently has
  // one organization; if a second org is added later the login ID should be
  // namespaced before enabling it for that org.
  const { data: profiles, error: profileError } = await admin
    .from('profiles')
    .select('id, email, active')
    .eq('employee_code', employeeCode)
    .eq('active', true)
    .limit(2)

  if (profileError || !profiles || profiles.length !== 1 || !profiles[0].email) {
    return reply({ error: 'INVALID_CREDENTIALS' }, 401)
  }

  const authClient = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await authClient.auth.signInWithPassword({
    email: profiles[0].email,
    password,
  })

  if (error || !data.session || data.user.id !== profiles[0].id) {
    return reply({ error: 'INVALID_CREDENTIALS' }, 401)
  }

  return reply({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  })
})
