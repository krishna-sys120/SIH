# Twilio Architecture — SkillSetu

## Where it fits

The app is a React SPA + Supabase. There is no Node server, so all Twilio
server-side code lives in **Supabase Edge Functions** (Deno) under
`supabase/functions/`, and all state lives in Postgres under
`supabase/schema.sql` §7. The browser talks to Supabase only — never to
Twilio directly — so credentials never reach the client.

```
React SPA (demo or Supabase mode)
        │  anon key + JWT
        ▼
┌─────────────────────────────┐        Twilio REST (fetch, Basic auth)
│ twilio-send  (edge function)│ ─────────────────────────────────►  SMS/WhatsApp/Calls API
└─────────────────────────────┘
        ▲  supabase-js (comm_overview view, service-role inside)
        │
┌─────────────────────────────┐   ◄──── webhooks: SMS / WhatsApp / voice / status
│ twilio-webhook (edge fn)    │ ────► TwiML responses (XML) for voice
└─────────────────────────────┘
        │  service role
        ▼
Postgres: communications · ivr_sessions · comm_optouts · webhook_events
        │  PII-free view (masked phones, no bodies)
        ▼
Dashboard → Communications section
```

## Modules

| Path | Role |
| --- | --- |
| `supabase/functions/_shared/twilio.ts` | Zero-dependency Twilio REST client, TwiML builders, webhook signature validation (HMAC-SHA1 via `crypto.subtle`), E.164 normalization |
| `supabase/functions/_shared/db.ts` | JSON helpers + service-role Supabase client |
| `supabase/functions/_shared/keywords.ts` | STOP/START/HELP classification + localized replies (pure, unit-tested) |
| `supabase/functions/_shared/ivr.ts` | Pure IVR decision engine + TwiML renderers (pure, unit-tested) |
| `supabase/functions/twilio-webhook/ivr-config.json` | The whole IVR menu tree: prompts in 7 languages, options, retries, voices. Edit this file, not code, to change the phone menu |
| `supabase/functions/twilio-send/index.ts` | Outbound only — validates channel/uuid, resolves the phone server-side from `beneficiaries`, checks opt-outs and a rolling-hour rate limit, records everything |
| `supabase/functions/twilio-webhook/index.ts` | Signature-validated inbound: SMS/WhatsApp keyword handling, idempotent status callbacks (webhook_events), voice IVR with per-call session tracking |

## Security model

- **Credentials** live only in edge-function secrets. No `VITE_*` Twilio vars.
- **twilio-send** takes a beneficiary `uuid`, never a phone number; the
  recipient is resolved from `beneficiaries` with the service role. A browser
  cannot send SMS to arbitrary numbers. Rate limit: 5 outbound per
  beneficiary per rolling hour; opt-outs short-circuit with 403.
- **twilio-webhook** validates `X-Twilio-Signature` on every request;
  invalid signatures get 403 and no DB writes.
- **Idempotency**: status callbacks record `(sid:status)` in
  `webhook_events`; duplicates are acknowledged and skipped.
- **PII**: raw tables are RLS-locked to the service role (no anon/auth
  policies at all). The dashboard reads `comm_overview` only — masked
  phones (`•••••1234`), no message bodies, minutes-truncated timestamps.
  Opt-out keyword bodies are stored only for audit inside the service-role
  boundary.
- **WhatsApp rules**: free-form outbound only inside the 24h session window;
  business-initiated traffic requires approved templates (setup doc §1).
  The code does not pretend otherwise — template sends are a deliberate
  post-MVP extension.

## Data model (schema.sql §7)

- `communications` — one row per message/call: channel, direction, status,
  `twilio_sid` (unique), beneficiary FK, phone, body (service-role only),
  duration, error fields. Indexed on sid/beneficiary/phone/status/time.
- `ivr_sessions` — per-call: call SID, selections JSON array, language.
- `comm_optouts` — per phone+channel opt state (keyword-maintained).
- `webhook_events` — idempotency ledger.
- `comm_overview` — the only anon-readable surface; the dashboard uses it.

## Demo mode

Without Supabase configured, the Dashboard's Communications section shows a
seeded local dataset (masked phones) so the UX is reviewable offline; all
sending paths are Supabase-mode only by design.
