/**
 * twilio-send — outbound communications edge function (Deno).
 *
 * POST /functions/v1/twilio-send
 *   { "channel": "sms" | "whatsapp" | "voice", "beneficiaryId": "<uuid>",
 *     "body": "...", "ivrUrl"?: "https://..." (voice only) }
 *
 * Security model:
 *  - Requires a valid Supabase service-role or anon JWT (verify_jwt is on by
 *    default; the frontend calls it with the anon key). Deny-by-default.
 *  - The phone number is NEVER taken from the request — it is resolved from
 *    beneficiaries by id inside the service-role DB access. Browsers cannot
 *    send arbitrary SMS to arbitrary numbers through this function.
 *  - Opt-out registry (comm_optouts) is checked before every send.
 *  - Per-beneficiary rate limit: max SEND_RATE_LIMIT messages per hour.
 *  - Every attempt (success or failure) is logged into public.communications.
 *
 * Environment (supabase secrets):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER,
 *   TWILIO_WHATSAPP_NUMBER, TWILIO_WEBHOOK_BASE_URL,
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided)
 */
import { json, serviceClient, jsonError } from "../_shared/db.ts";
import {
  twilioConfig,
  sendSms,
  sendWhatsApp,
  makeCall,
  normalizePhone,
} from "../_shared/twilio.ts";

const SEND_RATE_LIMIT = 5; // max messages per beneficiary per rolling hour
const ALLOWED_CHANNELS = new Set(["sms", "whatsapp", "voice"]);

interface SendBody {
  channel?: string;
  beneficiaryId?: string;
  body?: string;
  ivrUrl?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return jsonError(405, "method not allowed");

  try {
    const cfg = twilioConfig(); // throws when secrets missing → safe 500 below
    const admin = serviceClient();
    const payload = (await req.json().catch(() => ({}))) as SendBody;

    const channel = String(payload.channel ?? "");
    const beneficiaryId = String(payload.beneficiaryId ?? "");
    if (!ALLOWED_CHANNELS.has(channel)) return jsonError(400, "invalid channel");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(beneficiaryId)) {
      return jsonError(400, "beneficiaryId must be a uuid");
    }

    // Resolve the phone SERVER-SIDE from the beneficiary record.
    const { data: ben, error: benErr } = await admin
      .from("beneficiaries")
      .select("id, phone")
      .eq("id", beneficiaryId)
      .maybeSingle();
    if (benErr) return jsonError(500, "database error");
    if (!ben?.phone) return jsonError(404, "beneficiary not found or has no phone");

    const phone = normalizePhone(String(ben.phone));
    if (!phone) return jsonError(422, "beneficiary phone is not a valid Indian mobile number");

    // Opt-out check (channel-specific, then global).
    const { data: optout } = await admin
      .from("comm_optouts")
      .select("opted_out")
      .in("channel", [channel, "all"])
      .eq("phone", phone)
      .maybeSingle();
    if (optout?.opted_out) {
      return jsonError(403, "beneficiary has opted out of this channel");
    }

    // Rolling-hour rate limit per beneficiary.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("communications")
      .select("id", { count: "exact", head: true })
      .eq("beneficiary_id", beneficiaryId)
      .eq("direction", "outbound")
      .gte("created_at", since);
    if ((count ?? 0) >= SEND_RATE_LIMIT) {
      return jsonError(429, "rate limit: too many messages to this beneficiary this hour");
    }

    const base = Deno.env.get("TWILIO_WEBHOOK_BASE_URL") ?? "";
    const statusCb = `${base.replace(/\/$/, "")}/twilio-webhook?type=status`;
    const voiceUrl = `${base.replace(/\/$/, "")}/twilio-webhook?type=voice`;

    // Insert the outbound record first (status queued), update after the API call.
    const { data: rec, error: insErr } = await admin
      .from("communications")
      .insert({
        channel,
        direction: "outbound",
        status: "queued",
        beneficiary_id: beneficiaryId,
        phone,
        body: channel === "voice" ? null : String(payload.body ?? "").slice(0, 1000),
        meta: { source: "twilio-send" },
      })
      .select("id")
      .single();
    if (insErr || !rec) return jsonError(500, "could not record outgoing message");

    let result;
    if (channel === "sms") {
      result = await sendSms(cfg, phone, String(payload.body ?? ""), statusCb);
    } else if (channel === "whatsapp") {
      result = await sendWhatsApp(cfg, phone, String(payload.body ?? ""), statusCb);
    } else {
      if (!payload.ivrUrl) return jsonError(400, "voice sends require ivrUrl");
      result = await makeCall(cfg, phone, payload.ivrUrl, statusCb);
    }

    const failed = result.sid === null;
    await admin
      .from("communications")
      .update({
        twilio_sid: result.sid,
        status: result.status,
        error_code: result.errorCode ?? null,
        error_message: result.errorMessage ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rec.id);

    return json({
      ok: !failed,
      communicationId: rec.id,
      twilioSid: result.sid,
      status: result.status,
      error: failed ? { code: result.errorCode, message: result.errorMessage } : undefined,
    }, failed ? 502 : 200);
  } catch (e) {
    // Never leak secrets or stack traces — safe, generic message only.
    console.error("twilio-send error:", e instanceof Error ? e.message : e);
    return jsonError(500, "internal error");
  }
});
