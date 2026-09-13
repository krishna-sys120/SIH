# Twilio Setup — SkillSetu

SMS, WhatsApp, and IVR voice for the SkillSetu PM-AJAY skilling assistant.
Integration runs as **Supabase Edge Functions** (this project has no Node
server); the browser never sees Twilio credentials.

## 1. Twilio account (manual, external)

1. Create/sign in at [twilio.com](https://www.twilio.com) — complete email
   verification and 2FA if prompted.
2. Free trial is enough for development. Trial limits: you can only send to
   **verified caller IDs**, and trial SMS/WhatsApp messages carry a preview
   notice.
3. Buy/provision one **SMS + Voice enabled phone number** (Console →
   Phone Numbers → Manage → Buy a number). India long-codes have heavy
   DLT registration requirements; for demos a US number sending to Indian
   mobiles works, or use an Indian sender ID after DLT registration.
4. WhatsApp: use the **Twilio Sandbox for WhatsApp** for development
   (Console → Messaging → Try it out → Send a WhatsApp message). Join the
   sandbox from your phone by sending `join <code>` to the sandbox number.
   Production WhatsApp requires Meta Business verification and **approved
   message templates** for business-initiated messages — this is a manual
   external process and is NOT complete until done.

## 2. Secrets (never in source)

Set these as Supabase edge-function secrets — not in `.env`, not in Git:

```bash
supabase secrets set \
  TWILIO_ACCOUNT_SID=ACxxxxxxxx \
  TWILIO_AUTH_TOKEN=xxxxxxxx \
  TWILIO_PHONE_NUMBER=+15551234567 \
  TWILIO_WHATSAPP_NUMBER=+14155238886 \
  TWILIO_WEBHOOK_BASE_URL=https://YOUR-PROJECT.supabase.co/functions/v1 \
  IVR_AGENT_NUMBER=+919800000000
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically
into edge functions. `IVR_AGENT_NUMBER` is optional — without it, pressing
0 in the IVR reads the callback-status prompt instead of transferring.

Placeholders live in `.env.example`. Frontend code imports nothing Twilio:
the only `VITE_` variables remain the Supabase URL/anon key.

## 3. Deploy the functions

```bash
supabase functions deploy twilio-send
supabase functions deploy twilio-webhook
```

## 4. Point Twilio at the webhooks

Console → Phone Numbers → your number:

- **A call comes in** → Webhook:
  `https://YOUR-PROJECT.supabase.co/functions/v1/twilio-webhook?type=voice`
- In Messaging → **A message comes in** → Webhook:
  `https://YOUR-PROJECT.supabase.co/functions/v1/twilio-webhook?type=sms`
- Sandbox WhatsApp → same URL with `?type=whatsapp`
- Status callbacks are requested per-send (`StatusCallback` parameter)
  and land on `?type=status` automatically — no console setup needed.

## 5. Database

Run `supabase/schema.sql` in the Supabase SQL editor — it creates the
communications tables (`communications`, `ivr_sessions`, `comm_optouts`,
`webhook_events`), the PII-free `comm_overview` view used by the dashboard,
and their indexes. Sections 1–6 of the file are idempotent (`if not exists`
/ `or replace`), so re-running after an update is safe.

## 6. Local testing of webhooks

Edge functions run remotely even in dev, so no tunnel is required:

1. `supabase functions serve twilio-webhook --env-file ./supabase/.env.local`
   (or use the deployed URL directly).
2. Configure the Twilio console webhook URLs as in §4.
3. Send an SMS/WhatsApp message to your Twilio number, or call it.
4. Watch `supabase functions logs twilio-webhook` and check the
   Dashboard → Communications section in the app.

## 7. Verify

- Send: POST to `/functions/v1/twilio-send` with your anon key JWT and a
  real registered beneficiary uuid.
- Inbound: message your Twilio number; reply STOP → expect the unsubscribe
  confirmation and `comm_optouts` row.
- Voice: call the number → IVR main menu in English (or press nothing and
  hear the timeout retry); select 0 → agent transfer (if configured).
- Dashboard → Communications shows all of the above with masked phones.
