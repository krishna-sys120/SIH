/**
 * Minimal ambient declarations for the Deno globals used by the shared edge
 * modules (supabase/functions/_shared/*). The frontend imports the pure IVR
 * engine from there; Deno itself is only touched in twilio.ts (not imported
 * by the browser bundle). Keep this list in sync if the shared modules start
 * using more Deno APIs.
 */
declare namespace Deno {
  interface Env {
    get(key: string): string | undefined;
  }
  const env: Env;
}
