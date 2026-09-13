/**
 * Shared edge-function helpers: JSON responses and the service-role DB client.
 * The service-role key is injected by Supabase into edge functions
 * (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY secrets) — never exposed to browsers.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

export function jsonError(status: number, message: string): Response {
  return json({ ok: false, error: message }, status);
}

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
