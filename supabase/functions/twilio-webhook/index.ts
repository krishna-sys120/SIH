/**
 * twilio-webhook — inbound SMS/WhatsApp, delivery status callbacks, and voice
 * (IVR) webhook for Twilio, running as a Supabase edge function (Deno).
 *
 * Twilio POSTs here (form-encoded). Route selected by ?type=:
 *   type=sms      inbound SMS          → store + keyword reply (STOP/START/HELP)
 *   type=whatsapp inbound WhatsApp     → store + keyword reply
 *   type=status   delivery/call status → update communications row (idempotent)
 *   type=voice    inbound call         → IVR engine TwiML (Gather/Say/Dial)
 *   type=voice-action  Gather result   → IVR engine TwiML (next menu/transfer)
 *
 * Security:
 *  - Every request's X-Twilio-Signature is validated (HMAC-SHA1, auth token).
 *  - Status updates are idempotent via the webhook_events table.
 *  - Opt-out keywords (STOP etc.) update comm_optouts; opt-ins (START) revert.
 *  - Inbound messages are stored; bodies never leave the service role.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER,
 *      TWILIO_WHATSAPP_NUMBER, TWILIO_WEBHOOK_BASE_URL,
 *      IVR_AGENT_NUMBER (optional warm-transfer target),
 *      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import {
  twilioConfig,
  validateTwilioSignature,
  parseForm,
  normalizePhone,
  xmlResponse,
  jsonResponse,
  sendSms,
  sendWhatsApp,
} from "../_shared/twilio.ts";
import { classifyKeyword, keywordReply, detectLang } from "../_shared/keywords.ts";
import { serviceClient } from "../_shared/db.ts";
import {
  ivrProcess,
  renderMenuGather,
  renderSayThenMenu,
  renderTransfer,
  renderGoodbye,
  type IvrConfig,
} from "../_shared/ivr.ts";
import ivrConfigJson from "./ivr-config.json" with { type: "json" };

const IVR_CONFIG = ivrConfigJson as unknown as IvrConfig;

// Keyword classification lives in _shared/keywords.ts (pure, unit-tested).

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "sms";

  try {
    const cfg = twilioConfig();

    // ── 1. Validate the Twilio signature (URL + sorted form params) ──
    const params = await parseForm(req);
    const signature = req.headers.get("x-twilio-signature");
    // For status callbacks Twilio signs the full public URL; when running
    // behind a proxy the URL may be rewritten, so rebuild from forwarded proto
    // headers when present (Supabase edge runtime sets them).
    const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    const host = req.headers.get("x-forwarded-host") ?? url.host;
    const signedUrl = `${proto}://${host}${url.pathname}${url.search}`;
    const valid = await validateTwilioSignature(cfg.authToken, signature, signedUrl, params);
    if (!valid) {
      console.error("twilio-webhook: invalid signature");
      return new Response("invalid signature", { status: 403 });
    }

    const admin = serviceClient();
    const from = normalizePhone(params.From?.replace(/^whatsapp:/, "") ?? "");
    if (!from) return xmlResponse("<Response><Hangup/></Response>");

    // Identify the beneficiary by phone (registered users only get associations).
    let beneficiaryId: string | null = null;
    {
      const { data } = await admin
        .from("beneficiaries")
        .select("id")
        .eq("phone", from)
        .limit(1)
        .maybeSingle();
      beneficiaryId = (data as { id: string } | null)?.id ?? null;
    }

    // ── 2. Route ──
    if (type === "sms" || type === "whatsapp") {
      const body = (params.Body ?? "").trim();
      const channel = type;

      // Keyword handling first — STOP beats everything.
      const keyword = classifyKeyword(body);

      if (keyword) {
        const channelCol = type === "sms" ? "sms" : "whatsapp";
        if (keyword === "optout" || keyword === "optin") {
          const optedOut = keyword === "optout";
          await admin.from("comm_optouts").upsert({
            phone: from,
            channel: channelCol,
            opted_out: optedOut,
            source: "keyword",
            updated_at: new Date().toISOString(),
          });
        }
        // Record the inbound message, then reply through the same channel.
        await admin.from("communications").insert({
          channel,
          direction: "inbound",
          status: "received",
          beneficiary_id: beneficiaryId,
          phone: from,
          body: body.slice(0, 1000),
          meta: { keyword },
        });
        const reply = keywordReply(keyword, detectLang(body));
        const res =
          channel === "sms"
            ? await sendSms(cfg, from, reply, `${Deno.env.get("TWILIO_WEBHOOK_BASE_URL") ?? ""}/twilio-webhook?type=status`)
            : await sendWhatsApp(cfg, from, reply, `${Deno.env.get("TWILIO_WEBHOOK_BASE_URL") ?? ""}/twilio-webhook?type=status`);
        await admin.from("communications").insert({
          channel,
          direction: "outbound",
          status: res.sid ? "queued" : "failed",
          twilio_sid: res.sid,
          beneficiary_id: beneficiaryId,
          phone: from,
          body: reply,
          error_code: res.errorCode ?? null,
          error_message: res.errorMessage ?? null,
          meta: { keyword_reply: keyword },
        });
        return xmlResponse("<Response></Response>");
      }

      // Regular inbound message: store; light auto-reply pointing at the web app.
      await admin.from("communications").insert({
        channel,
        direction: "inbound",
        status: "received",
        beneficiary_id: beneficiaryId,
        phone: from,
        body: body.slice(0, 1000),
        meta: {},
      });
      const lang = detectLang(body);
      const autoReply =
        lang === "hi"
          ? "धन्यवाद! हमारी टीम जल्द ही आपसे संपर्क करेगी। वेब ऐप: skillsetu.app"
          : "Thank you! Our team will reach out shortly. Web app: skillsetu.app";
      const res =
        channel === "sms"
          ? await sendSms(cfg, from, autoReply, `${Deno.env.get("TWILIO_WEBHOOK_BASE_URL") ?? ""}/twilio-webhook?type=status`)
          : await sendWhatsApp(cfg, from, autoReply, `${Deno.env.get("TWILIO_WEBHOOK_BASE_URL") ?? ""}/twilio-webhook?type=status`);
      await admin.from("communications").insert({
        channel,
        direction: "outbound",
        status: res.sid ? "queued" : "failed",
        twilio_sid: res.sid,
        beneficiary_id: beneficiaryId,
        phone: from,
        body: autoReply,
        meta: { auto_reply: true },
      });
      return xmlResponse("<Response></Response>");
    }

    if (type === "status") {
      // Idempotency: (MessageSid|CallSid + MessageStatus/CallStatus) seen → skip.
      const sid = params.MessageSid ?? params.CallSid ?? "";
      const status = params.MessageStatus ?? params.CallStatus ?? "";
      const eventId = `${sid}:${status}`;
      const { error: evErr } = await admin
        .from("webhook_events")
        .insert({ event_id: eventId, kind: "status", payload: { sid, status } });
      if (evErr) return jsonResponse({ ok: true, dedup: true }); // already processed

      const commStatus = mapCommStatus(status);
      const lookupCol = params.MessageSid ? "twilio_sid" : "call_sid";
      // calls live in communications too (twilio_sid holds the CallSid)
      const { data: existing } = await admin
        .from("communications")
        .select("id")
        .eq("twilio_sid", sid)
        .maybeSingle();
      if (existing) {
        await admin
          .from("communications")
          .update({
            status: commStatus,
            duration_secs: params.CallDuration ? parseInt(params.CallDuration, 10) : undefined,
            error_code: params.ErrorCode ? parseInt(params.ErrorCode, 10) : null,
            error_message: params.ErrorMessage ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      } else if (lookupCol === "call_sid") {
        // Voice status for a call whose TwiML we served but never created a row
        // (e.g. user called IN) — record the completed call.
        await admin.from("communications").insert({
          channel: "voice",
          direction: "inbound",
          status: commStatus,
          twilio_sid: sid,
          beneficiary_id: beneficiaryId,
          phone: from,
          duration_secs: params.CallDuration ? parseInt(params.CallDuration, 10) : null,
          meta: { ivr_keys: params.Digits ?? null },
        });
      }
      return xmlResponse("<Response></Response>");
    }

    if (type === "voice" || type === "voice-action") {
      const callSid = params.CallSid ?? "";
      // Fresh inbound call (type=voice) → undefined digits = serve the menu.
      // Gather results (type=voice-action) → "" on timeout, else pressed keys.
      const digits = type === "voice" ? undefined : params.Digits ?? "";
      const menuParam = url.searchParams.get("menu") ?? "main";
      const retries = parseInt(url.searchParams.get("r") ?? "0", 10) || 0;
      const lang = detectLang(params.Language ?? "") || "en";

      // Upsert the IVR session row for this call.
      if (callSid) {
        await admin.from("ivr_sessions").upsert({
          call_sid: callSid,
          beneficiary_id: beneficiaryId,
          phone: from,
          language: lang,
          updated_at: new Date().toISOString(),
        }, { onConflict: "call_sid" });
      }

      const actionBase = `${(Deno.env.get("TWILIO_WEBHOOK_BASE_URL") ?? "").replace(/\/$/, "")}/twilio-webhook`;
      const actionUrl = `${actionBase}?type=voice-action&menu=__MENU__&r=__R__`;

      const outcome = ivrProcess(IVR_CONFIG, menuParam, digits, retries, lang);

      // Record the selection on action requests.
      if (type === "voice-action" && callSid && digits !== null) {
        const { data: sess } = await admin
          .from("ivr_sessions")
          .select("id, selections")
          .eq("call_sid", callSid)
          .maybeSingle();
        if (sess) {
          const selections = Array.isArray(sess.selections) ? [...sess.selections] : [];
          selections.push({ key: digits, menu: menuParam, at: new Date().toISOString() });
          await admin
            .from("ivr_sessions")
            .update({ selections, updated_at: new Date().toISOString() })
            .eq("id", (sess as { id: string }).id);
        }
      }

      switch (outcome.kind) {
        case "menu":
          return xmlResponse(
            renderMenuGather(IVR_CONFIG, outcome.menuId, lang, actionUrl.replace("__MENU__", outcome.menuId).replace("__R__", String(outcome.retries))),
          );
        case "say":
          return xmlResponse(
            renderSayThenMenu(
              IVR_CONFIG,
              outcome.text,
              outcome.thenMenu,
              lang,
              actionUrl.replace("__MENU__", outcome.thenMenu).replace("__R__", String(outcome.retries)),
            ),
          );
        case "transfer":
          return xmlResponse(renderTransfer(IVR_CONFIG, outcome.number, lang));
        case "hangup":
        default:
          if (callSid) {
            await admin.from("ivr_sessions").update({ status: "completed", updated_at: new Date().toISOString() }).eq("call_sid", callSid);
          }
          return xmlResponse(renderGoodbye(IVR_CONFIG, lang));
      }
    }

    return new Response("unknown type", { status: 400 });
  } catch (e) {
    console.error("twilio-webhook error:", e instanceof Error ? e.message : e);
    // Twilio treats non-2xx webhook responses as failures — always answer XML.
    return xmlResponse("<Response><Hangup/></Response>");
  }
});

function mapCommStatus(tw: string): string {
  switch (tw) {
    case "queued":
    case "accepted":
    case "scheduled":
      return "queued";
    case "sent":
    case "initiated":
    case "ringing":
      return "sent";
    case "delivered":
      return "delivered";
    case "undelivered":
      return "undelivered";
    case "failed":
      return "failed";
    case "in-progress":
      return "in-progress";
    case "completed":
      return "completed";
    case "busy":
    case "no-answer":
    case "canceled":
      return tw;
    default:
      return "queued";
  }
}
