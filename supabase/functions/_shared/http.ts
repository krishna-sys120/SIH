/**
 * SEC-002 — the SINGLE owner of edge-function HTTP/CORS policy.
 *
 * There is no wildcard anywhere: these endpoints are authenticated, same-app
 * surfaces (twilio-send requires a privileged JWT; twilio-webhook is
 * server-to-server from Twilio, where CORS does not apply). The browser
 * allowlist is EMPTY — callers must be our own origin or server-side. Every
 * edge function sends responses through these helpers so the policy cannot
 * drift per endpoint.
 *
 * Deliberately dependency-free so unit tests can assert the REAL emitted
 * headers (runtime proof, not source greps) without pulling in the DB client.
 */

export const corsHeaders = {
  "Access-Control-Allow-Origin": "",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** OPTIONS preflight for the (empty) browser allowlist. */
export function options(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function jsonError(status: number, message: string): Response {
  return json({ ok: false, error: message }, status);
}

/** TwiML/XML response — same empty-origin policy as every edge response. */
export function xmlResponse(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/xml; charset=utf-8" },
  });
}
