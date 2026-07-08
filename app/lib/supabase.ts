// Server-only Supabase client (service role). The browser NEVER talks to Supabase
// directly — all access goes through our API routes, so the service key stays on
// the server and RLS can stay fully closed.
//
// Env (in .env.local and on Vercel):
//   SUPABASE_URL              e.g. https://xyzcompany.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY the service_role secret from Project Settings → API

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

export function supabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return cached;
}

/** Standard 503 for routes that need the database before it is configured. */
export function dbNotConfigured(): Response {
  return Response.json(
    { error: "Claims library is not configured yet (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)." },
    { status: 503 }
  );
}
