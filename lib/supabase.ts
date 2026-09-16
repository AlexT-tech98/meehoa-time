import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const hasSupabase = Boolean(url && key);
export const supabase = hasSupabase ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
