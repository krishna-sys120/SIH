# Twilio Testing — SkillSetu

## Automated tests (no account needed)

`tests/twilio.test.ts` runs with `npm test` (vitest) and covers the pure
logic shared by both edge functions — no network, no Twilio account, no
paid calls:

- **Keyword opt-out**: STOP/UNSUBSCRIBE/CANCEL/QUIT variants
  (case-insensitive, word-boundary aware), START/YES opt-in exactness,
  HELP, and ordinary conversational text returning null.
- **Localized replies**: Hindi rendering and English fallback.
- **Phone normalization**: Indian 10-digit → `+91…`, E.164 passthrough,
  rejection of landline-shaped/garbage input.
- **TwiML builders**: XML escaping of `& < > "`, Gather attributes, Dial.
- **Webhook signature validation**: a valid HMAC-SHA1 signature computed
  with the documented algorithm validates; missing/tampered signatures are
  rejected.
- **IVR engine**: fresh call serves the menu; routing 1/3 to submenus;
  status action; agent fallback; invalid input and timeout increment
  retries; retry ceiling hangs up; valid jumps reset retries; Hindi/Kannada
  prompt localization; unknown-language fallback; unknown menu hangup.
- **IVR config integrity**: every configured option resolves to a defined
  menu or response, and every prompt/response exists in all 7 languages
  (en/hi/bn/ta/te/mr/kn) — this test fails if someone edits
  `ivr-config.json` and forgets a language.

Run everything (typecheck + unit tests + i18n audit + build):

```bash
npm run typecheck && npm test && npm run i18n:audit && npm run build
```

## What tests deliberately do NOT do

- No real SMS/WhatsApp/calls (trial or paid) — the REST layer is thin and
  only exercised against the live API during setup verification.
- No HTTP-level tests of the Deno functions themselves; their handlers are
  thin orchestration over the tested pure modules.

## Manual webhook testing (needs a Twilio account)

Follow `docs/twilio-setup.md` §6:

1. Deploy/serve the functions and point the Twilio console webhooks at
   `.../twilio-webhook?type=sms|whatsapp|voice`.
2. Message or call your Twilio number.
3. `supabase functions logs twilio-webhook` shows the request flow.
4. Verify rows in `communications` / `ivr_sessions` (service role) and the
   masked view in Dashboard → Communications.

Security spot-checks worth doing once after deploy:

- POST a forged webhook without a signature → expect 403, no DB writes.
- POST the same status callback twice → second is deduped (`webhook_events`).
- Call `twilio-send` with an opted-out beneficiary → 403.
- Call `twilio-send` with an unknown uuid → 404, no SMS.
