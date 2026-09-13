# SkillSetu — AI Voice Assistant for PM-AJAY (GIA) Skilling

An AI-driven voice assistant for **livelihood mapping** and **NSQF-aligned skilling
recommendations** for SC communities under the **GIA component of PM-AJAY**
(Ministry of Social Justice & Empowerment, Government of India).

Speak in your own language → the assistant understands your work → it maps your
livelihood to skill sectors → and recommends free, nearby, NSQF-certified courses.

## ✨ Features

- 🎙️ **Voice-first**: speech recognition + spoken replies (Web Speech API)
- 🌐 **7 languages**: English, हिन्दी, বাংলা, தமிழ், తెలుగు, मराठी, ಕನ್ನಡ — every UI string,
  livelihood name, course sector and AI reply is translated
- 🤖 **AI matching engine**: maps 18 livelihoods → 10 skill sectors → NSQF levels 1–4,
  explains *why* each course matches (reasons shown in your language)
- 📝 **3-step beneficiary registration** with validation and instant AI matches
- 📚 **Course catalog** with search, sector filters and one-tap enrollment
- 📊 **Admin dashboard** with stats, top livelihoods, enrollments by sector, CSV export
- 🔌 **Supabase-ready** with automatic **demo mode** (localStorage) when env vars are absent

## 🚀 Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. The app works instantly in **demo mode** — no backend needed.

## 🔌 Connect Supabase (5 minutes)

1. Create a free project at [supabase.com](https://supabase.com)
2. Open **SQL Editor** and run the contents of [`supabase/schema.sql`](supabase/schema.sql)
   (creates `courses`, `beneficiaries`, `enrollments` tables + RLS + seed data)
3. Copy `.env.example` to `.env` and paste your credentials:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```
4. Restart `npm run dev` — the dashboard badge flips from
   **"Demo mode"** to **"Connected to Supabase"**.

### Make it manageable (admin features)

- Dashboard → **Export CSV** for reporting to district mission offices
- **RLS policies** are included in the schema; for production, require Supabase Auth
  (add login for mission staff) and change `for select using (true)` policies accordingly
- Edit courses any time in Supabase Table Editor — the app reads them live
- Seat counts decrement atomically via the `decrement_seats` RPC on every enrollment

## 🗂 Project structure

```
src/
├── ai/reply.ts           # assistant reply generation (NLU + matching)
├── data/
│   ├── model.ts          # domain types, livelihood→sector map
│   ├── recommend.ts      # matching engine + multilingual keyword NLU
│   ├── store.ts          # data facade: Supabase ⇄ demo mode
│   ├── courses.ts        # seed catalog (16 NSQF courses)
│   └── demo.ts           # localStorage store for demo mode
├── i18n/
│   ├── languages.ts      # 7 languages with BCP-47 voice tags
│   ├── strings.ts        # all UI strings × 7 languages
│   ├── labels.*.ts       # livelihoods, sectors, education, AI phrases
│   └── context.tsx       # I18nProvider + t()/tl() hooks
├── voice/speech.ts       # Web Speech API: recognition + synthesis
├── pages/                # Home, Assistant, Courses, Register, Dashboard
└── App.tsx               # shell + navigation + language switcher
```

## 📲 Install as an app (PWA)

**Live app:** <https://krishna-sys120.github.io/SIH/>

The app is a full PWA — installable, offline-capable, with its own icon:

- **Android (Chrome):** open the link → tap **Install app** in the hero, or
  Chrome menu → *Add to Home screen*.
- **Windows (Chrome/Edge):** open the link → click **Install app**, or the
  install icon in the address bar. It then runs in its own window like a
  native app (also from the Start menu).
- **iOS (Safari):** Share → *Add to Home Screen*.

Every push to `main` redeploys the site automatically
(`.github/workflows/deploy-pages.yml`). The hosted app runs in demo mode;
point `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` at a real project for
live data, and see `docs/twilio-setup.md` to enable SMS/WhatsApp/IVR.

## 🛠 Tech stack

Vite · React 19 · TypeScript · Tailwind CSS v4 · Supabase · Web Speech API

## 📄 License

MIT — built as a social-impact template for PM-AJAY GIA implementations.
