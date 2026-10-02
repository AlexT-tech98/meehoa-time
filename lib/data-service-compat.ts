export * from './data-service';
export { getSession as fetchSession } from './data-service';

import { signIn as signInWithEmail } from './data-service';
import { hasSupabase, supabase } from './supabase';

/**
 * UI login adapter.
 * - Employees/managers can enter NV01 / QL01 without knowing any email.
 * - Existing email login remains as a recovery-compatible path for the owner.
 * - The employee-code -> internal email lookup happens only inside the
 *   employee-login Edge Function; the browser never receives that email.
 */
export async function signIn(loginId: string, password: string) {
  const normalized = loginId.trim();
  if (normalized.includes('@')) return signInWithEmail(normalized, password);

  if (!hasSupabase || !supabase) throw new Error('Supabase chưa được cấu hình');

  const { data, error } = await supabase.functions.invoke('employee-login', {
    body: { employeeCode: normalized.toUpperCase(), password },
  });

  if (error || !data?.access_token || !data?.refresh_token) {
    throw new Error('Invalid login credentials');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });

  if (sessionError || !sessionData.session) {
    throw sessionError ?? new Error('Invalid login credentials');
  }

  return sessionData;
}
