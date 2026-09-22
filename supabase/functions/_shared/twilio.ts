/**
 * Shared Twilio integration for the twilio-* edge functions (Deno runtime).
 *
 * Zero-dependency by design: the Twilio REST API is called with plain `fetch`,
 * and TwiML is built as escaped XML strings — no SDK to install on the edge.
 *
 * Credentials come ONLY from edge-function environment variables (supabase
 * secrets): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER,
 * TWILIO_WHATSAPP_NUMBER. They are never imported into frontend code.
 */

// ── Configuration ─────────────────────────────────────────────

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  smsFrom: string;
  whatsappFrom: string;
}

/** Throws when required secrets are missing — callers return a safe 500. */
export function twilioConfig(): TwilioConfig {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const smsFrom = Deno.env.get("TWILIO_PHONE_NUMBER") ?? "";
  const whatsappFrom = Deno.env.get("TWILIO_WHATSAPP_NUMBER") ?? smsFrom;
  if (!accountSid || !authToken || !smsFrom) {
    throw new Error("missing Twilio configuration (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)");
  }
  return { accountSid, authToken, smsFrom, whatsappFrom };
}

export function basicAuth(cfg: TwilioConfig): string {
  return "Basic " + btoa(`${cfg.accountSid}:${cfg.authToken}`);
}

// ── REST calls ────────────────────────────────────────────────

export interface TwilioSendResult {
  sid: string | null;
  status: string;
  errorCode?: number;
  errorMessage?: string;
}

async function twilioPost(
  cfg: TwilioConfig,
  path: string,
  params: Record<string, string>,
): Promise<TwilioSendResult> {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/${path}`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(cfg),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      sid: null,
      status: "failed",
      errorCode: typeof data.code === "number" ? data.code : undefined,
      errorMessage: typeof data.message === "string" ? data.message : `HTTP ${res.status}`,
    };
  }
  return {
    sid: typeof data.sid === "string" ? data.sid : null,
    status: typeof data.status === "string" ? data.status : "queued",
  };
}

/** Outbound SMS. Returns the Twilio message SID (or failure details). */
export function sendSms(cfg: TwilioConfig, to: string, body: string, statusCallback: string) {
  return twilioPost(cfg, "Messages.json", {
    To: to,
    From: cfg.smsFrom,
    Body: body,
    StatusCallback: statusCallback,
  });
}

/**
 * Outbound WhatsApp. Free-form messages are ONLY allowed inside a 24h user
 * window; outside it Twilio requires an approved template — callers must use
 * template sends (Content SID) for business-initiated traffic.
 */
export function sendWhatsApp(cfg: TwilioConfig, to: string, body: string, statusCallback: string) {
  return twilioPost(cfg, "Messages.json", {
    To: `whatsapp:${to}`,
    From: cfg.whatsappFrom.startsWith("whatsapp:") ? cfg.whatsappFrom : `whatsapp:${cfg.whatsappFrom}`,
    Body: body,
    StatusCallback: statusCallback,
  });
}

/**
 * Outbound voice call whose flow is driven by TwiML served by twilio-voice
 * (Twilio fetches the instructions from `url` when the call is answered).
 */
export function makeCall(cfg: TwilioConfig, to: string, url: string, statusCallback: string) {
  return twilioPost(cfg, "Calls.json", {
    To: to,
    From: cfg.smsFrom,
    Url: url,
    StatusCallback: statusCallback,
    StatusCallbackEvent: "completed",
  });
}

// ── Webhook signature validation ──────────────────────────────
// Twilio signs requests with HMAC-SHA1 over (full URL + sorted POST params).
// The X-Twilio-Signature header is base64. Uses crypto.subtle (Deno native).

function pctEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export async function validateTwilioSignature(
  authToken: string,
  signature: string | null,
  url: string,
  params: Record<string, string>,
): Promise<boolean> {
  if (!signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + pctEncode(params[k])).join("");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  // Constant-time-ish comparison
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// ── TwiML ─────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function twiml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

export const say = (text: string, voice = "Polly.Aditi", language = "en-IN") =>
  `<Say voice="${esc(voice)}" language="${esc(language)}">${esc(text)}</Say>`;

export const play = (url: string) => `<Play>${esc(url)}</Play>`;

export const gather = (inner: string, opts: {
  numDigits?: number;
  timeout?: number;
  action: string;
  finishOnKey?: string;
  input?: "dtmf" | "speech" | "dtmf speech";
  speechTimeout?: number | "auto";
  language?: string;
}) => {
  const attrs = [
    `action="${esc(opts.action)}"`,
    `method="POST"`,
    opts.numDigits != null ? `numDigits="${opts.numDigits}"` : "",
    opts.timeout != null ? `timeout="${opts.timeout}"` : "",
    opts.finishOnKey ? `finishOnKey="${esc(opts.finishOnKey)}"` : "",
    opts.input ? `input="${opts.input}"` : "",
    opts.speechTimeout != null ? `speechTimeout="${opts.speechTimeout}"` : "",
    opts.language ? `language="${esc(opts.language)}"` : "",
  ].filter(Boolean).join(" ");
  return `<Gather ${attrs}>${inner}</Gather>`;
};

export const dial = (number: string, opts?: { timeout?: number; callerId?: string }) => {
  const attrs = [
    opts?.timeout != null ? `timeout="${opts.timeout}"` : "",
    opts?.callerId ? `callerId="${esc(opts.callerId)}"` : "",
  ].filter(Boolean).join(" ");
  return `<Dial ${attrs}>${esc(number)}</Dial>`;
};

export const hangup = () => "<Hangup/>";
export const redirect = (url: string) => `<Redirect method="POST">${esc(url)}</Redirect>`;

// ── Helpers ───────────────────────────────────────────────────
// HTTP/CORS responses are owned by _shared/http.ts (SEC-002, single owner);
// this module stays HTTP-free so unit tests can import it without a runtime.

/** Normalize a phone to E.164-ish (+XXXXXXXXXX); accepts 10-digit Indian numbers. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return "+91" + digits;
  if (digits.length === 12 && digits.startsWith("91")) return "+" + digits;
  return null;
}

/** Parse x-www-form-urlencoded body into a plain object (webhook payloads). */
export async function parseForm(req: Request): Promise<Record<string, string>> {
  const text = await req.text();
  return Object.fromEntries(new URLSearchParams(text));
}


