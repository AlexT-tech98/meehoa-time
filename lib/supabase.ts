import { createClient } from "@supabase/supabase-js";

interface MetaEnv {
  env?: Record<string, string | undefined>;
}

const metaEnv =
  typeof import.meta !== "undefined" && "env" in import.meta
    ? (import.meta as MetaEnv).env
    : undefined;

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  metaEnv?.VITE_SUPABASE_URL ||
  "";

const key =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  metaEnv?.VITE_SUPABASE_ANON_KEY ||
  metaEnv?.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "";

export const hasSupabase = Boolean(url && key && !url.includes("YOUR_PROJECT"));

export const supabase = hasSupabase
  ? createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
