# SkillSetu — AI Voice Assistant for PM-AJAY (GIA) Skilling

An AI-driven voice assistant for **livelihood mapping** and **NSQF-aligned skilling
recommendations** for SC communities under the **GIA component of PM-AJAY**
(Ministry of Social Justice & Empowerment, Government of India).

**Smart India Hackathon 2026 — problem statement SIH26097.**

Speak in your own language → the assistant interviews you about your work →
extracts a structured livelihood profile → maps it to NSQF-aligned job roles →
computes your **skill gap** → and recommends free, nearby training with a clear
**"why this is recommended"** explanation.

## 🎯 What actually works (honest feature matrix)

| Capability | Status |
| --- | --- |
| Multilingual UI — English, हिन्दी, বাংলা, தமிழ், తెలుగు, मराठी, ಕನ್ನಡ | ✅ Working (227 strings × 7 languages, CI-audited) |
| Voice input (Web Speech API) + spoken replies (TTS), replay + slow-speech | ✅ Working (browser-dependent, text fallback always present) |
| **Adaptive conversational interview** (not keyword chat) | ✅ Working — one question at a time, skips answered topics, adaptive follow-ups, early stop |
| **Semantic extraction** → structured livelihood profile | ✅ Working — deterministic multilingual NLU (7 languages), unit-tested |
| **NSQF/QP/NOS mapping** | ⚠️ **Prototype mapping — requires official verification** (clearly badged; no official QP IDs are fabricated) |
| **Skill-gap engine** (matched/missing/gap % per role) | ✅ Working — computed from structured data, unit-tested |
| **Local opportunity engine** (explainable weighted score) | ✅ Working — skill match + indicative district demand + education + location + preference + mobility; demand signals labeled *indicative* |
| Wage-employment vs **entrepreneurship** pathways | ✅ Working — business ideas with tools + real central scheme *names* (eligibility: "verify at official portal") |
| Course catalog + enrollment | ✅ Working (demo store locally; Supabase mode requires auth) |
| **Transactional enrollment RPC** with seats, duplicates, authorization | ✅ Implemented in `supabase/schema.sql` — needs a real Supabase project to exercise |
| **Consent & privacy** (consent fields, notice, PII-free views) | ✅ Implemented (UI + schema) |
| **IVR simulator** running the production IVR engine | ✅ Working demo — clearly labeled **Demo Simulation** |
| **Real Twilio SMS/WhatsApp/IVR** | ⚠️ Architecture complete (edge functions, signature validation, opt-out, idempotency) — needs a Twilio account; nothing is faked |
| **WhatsApp voice-note pipeline** | 📐 Designed (docs/twilio-architecture.md) — webhook adapter pattern; not live |
| Offline draft autosave + **submission outbox** with sync | ✅ Working (localStorage) |
| PWA install + offline shell | ✅ Working |
| Admin dashboard: impact funnel, aggregates, PII-safe table | ✅ Working (demo data labeled **Demo Simulation**) |
| Supabase Auth (beneficiary / staff / admin roles) | ⚠️ Schema + RLS implemented — needs a real project + users to exercise |

## 🎬 3-minute SIH judge demo script

1. **Home** → switch language to **ಕನ್ನಡ / हिन्दी** (or stay English).
2. Click **“Talk to AI Assistant”** (voice-first CTA).
3. Answer naturally: *“I help my father repair motorcycles… 3 years… I studied till 10th… I'm in Nagpur… I want a job nearby.”*
4. Watch the **profile completeness** bar fill and **skills identified** chips appear.
5. Results: **NSQF-aligned job role** (Automotive Service Technician) with **skill gap**
   (✓ mechanical repair, ✓ tool handling… • electrical diagnostics…) and **top-3
   recommendations with reasons** (“Your existing skills match…”, “Training available
   near you (Nagpur)…”).
6. Show **entrepreneurship pathway** (two-wheeler repair shop + MUDRA/PMEGP *name-only*
   with verification note).
7. **Save & register** (consent notice shown first) → **Courses** → **Enroll** →
   seat decrements, enrolled state persists.
8. **Dashboard**: impact funnel, district/education aggregates, voice-vs-text usage —
   all labeled; **📞 IVR Call** page → place the simulated IVR call (**Demo Simulation**).

## 🚀 Run locally

```bash
npm install
npm run dev          # demo mode — no backend needed
npm run typecheck    # tsc --noEmit
npm test             # 70 tests: extraction, skill-gap, opportunity, interview, E2E pipeline
npm run i18n:audit   # 227 keys × 7 languages
npm run build        # typecheck + vite build
```

Open http://localhost:5173. The app runs in **demo mode** (localStorage) until
Supabase env vars are set — every demo surface is explicitly labeled.

## 🔌 Connect Supabase

1. Create a free project at [supabase.com](https://supabase.com)
2. SQL Editor → run [`supabase/schema.sql`](supabase/schema.sql)
   (tables, RLS, roles `is_staff()`/`is_admin()`, transactional
   `enroll_beneficiary()`, consent columns, PII-free views, seed data)
3. Copy `.env.example` → `.env`, paste `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
4. Restart `npm run dev`

**Security model:** beneficiaries own their rows (`auth.uid()`), staff/admin get the
pseudonymous directory, anon can only register via `register_beneficiary()` (consent
mandatory) — anonymous **enrollment inserts are removed**; enrollment goes through the
transactional RPC only. Aggregate views (`public_analytics_view`,
`authorized_admin_view`) expose counts, never PII.

## 📲 Install as an app (PWA)

**Live app:** <https://krishna-sys120.github.io/SIH/>

Android/Chrome: tap **Install app**. Windows: install from the hero button. iOS: Share → Add to Home Screen.
Every push to `main` redeploys automatically — **only after typecheck + i18n audit + tests + build pass** (`.github/workflows/deploy-pages.yml`).

## 🛠 Tech stack

Vite · React 19 · TypeScript · Tailwind CSS v4 · Supabase (Postgres/RLS/RPC) ·
Web Speech API · Twilio (edge functions, optional) · vitest

## 📄 License

MIT — built as a social-impact template for PM-AJAY GIA implementations.
