/**
 * Shared edge-function helper: the service-role DB client.
 * The service-role key is injected by Supabase into edge functions
 * (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY secrets) — never exposed to browsers.
 *
 * HTTP/CORS policy lives in _shared/http.ts (SEC-002, single owner) — import
 * json/jsonError/options/xmlResponse from there; never re-declare headers here.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

let cached: SupabaseClient | null = null;

/** Service-role client for RLS-bypassing DB access inside edge functions. */
export function serviceClient(): SupabaseClient {
  if (cached) return cached;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
