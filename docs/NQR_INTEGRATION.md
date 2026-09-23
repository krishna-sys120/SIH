# Official NQR Integration — Architecture & Operations

**Status:** Implemented · **Data source:** National Qualification Register
(NQR), NCVET — <https://www.nqr.gov.in/> · **Integration date:** 2026-09-23

This document explains how **official NSQF qualification data** from the
National Qualification Register (NCVET) is imported, validated, stored,
matched, recommended, and kept separate from prototype data in SkillSetu
(SIH26097).

---

## 1. Why this exists

The NSQF-aligned course data originally shipped with the app is **prototype
mapping data** — every record is badged "Prototype mapping — requires official
verification". This integration adds a **second, authoritative data layer**:
qualifications imported directly from the official register, badged
"✓ Official NQR Qualification", with the prototype layer preserved as an
explicit fallback.

**Hard rules enforced throughout the codebase:**

- No QP codes, NOS codes, qualification IDs, NSQF levels, awarding bodies,
  durations, or eligibility requirements are ever invented or "filled in".
- Fields the official source does not provide are **NULL**, not guessed.
- Prototype data is **never** presented as official/government-approved.
- Official data is **never** presented as live-synced when it came from a
  static snapshot.

---

## 2. Architecture

```
Official NQR (nqr.gov.in, NCVET)
  │   official search page lists all qualification ids
  │   official POST /downloadSummaryFile → structured XLSX export
  ▼
Importer  (scripts/nqr-import.mjs)
  │   --file <official-export.xlsx>   ← preferred: site's own Download button
  │   --fetch                          ← equivalent single bulk POST (robots-allowed)
  ▼
Zero-dependency XLSX reader  (scripts/lib/nqr-xlsx.mjs)
  ▼
Normalizer / Validator / Status classifier  (scripts/lib/nqr-normalize.mjs)
  │   every row → validated record + provenance + import_errors[]
  │   nothing dropped silently; auditable error report written
  ▼
Idempotent upsert (on qualification_code) → Supabase  [admin/service role]
  │                                        └→ snapshot + error report artifacts
  ▼
Browser data layer  (src/data/nqr.ts) — LIVE → CACHED → PROTOTYPE
  │   1. supabase_official  (admin-synced table, anonymized public view)
  │   2. static_snapshot    (committed public/nqr/official-active.json)
  │   3. none               (prototype pipeline answers alone, UI says so)
  ▼
Explainable matching  (supabase/functions/_shared/nqrmatch.ts)
  │   livelihood match + skill/title match + occupation match +
  │   experience fit + duration fit + entry-level fit
  │   eligibility gate BEFORE ranking (Phase 10) → pathway notes, not options
  ▼
Existing recommendation UI  (Assistant results panel, untouched design)
```

**Deliberate boundaries:** the existing prototype pipeline (`taxonomy.ts` →
`skillgap.ts` → `opportunity.ts`) is **not modified**. The NQR layer runs
*alongside* it and its results render in their own clearly labeled section.

---

## 3. Official data access method (Phase 3) — what was investigated

| Option | Status | Evidence |
| --- | --- | --- |
| Public JSON API | **Not available** | No API advertised on nqr.gov.in; search page is server-rendered HTML |
| Official structured export | **✅ Used** | The site's own *Download Summary* button → `POST https://www.nqr.gov.in/downloadSummaryFile` returns a real XLSX (verified HTTP 200, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, 2814 rows) |
| Qualification detail pages | Available (fallback enrichment) | `GET /qualifications/<id>` is server-rendered; contains eligibility + NOS tables not present in the summary export |
| robots.txt | `User-agent: * / allow: /` | Retrieved 2026-09-23 |

**We do NOT scrape detail pages by default** (fragile HTML selectors, Phase 2
prohibition on hard-coding today's site structure). The importer consumes the
official export. Detail-page enrichment (eligibility, NOS lists) is a
documented future enhancement gated behind an allowlisted, rate-limited fetch.

The search page's hidden `qualificationids` field lists every visible
qualification id; the importer uses it (in `--fetch` mode) to request exactly
the site's own summary export, with token+cookies from one session.

**Attribution:** every record carries `source = NCVET_NQR`,
`source_url = https://www.nqr.gov.in/qualifications/<page-id>`, and the
official `qualification_code` exactly as published. No government logos or
endorsement are implied anywhere in the UI.

---

## 4. Data model

### 4.1 Database — `public.nqr_qualifications` (supabase/nqr-migration.sql)

Fields map 1:1 to the official summary export columns. Highlights:

| Column | Notes |
| --- | --- |
| `qualification_code` | Official code, **unique** — dedup/upsert key (Phase 7) |
| `nqr_page_id` / `source_record_id` | Official detail-page id |
| `nsqf_level_display` | Official string, e.g. `Level 4.5` — **never altered** |
| `nsqf_level_numeric` | `4.5` — for comparisons only, never shown to users |
| `notional_hours_max/min` | Official; `NULL` when absent; `min <= max` enforced |
| `valid_till`, `approval_date` | Official dates, ISO; ordering constraint enforced |
| `awarding_body`, `certifying_bodies` | As published |
| `proposed_occupation`, `progression_pathway`, `qualification_type`, `adopted_qualification`, `training_delivery_hours` | As published; `N.A.` → `NULL` |
| `verification_status` | `OFFICIAL_ACTIVE` / `OFFICIAL_EXPIRED` / `OFFICIAL_ARCHIVED` / `OFFICIAL_UNCERTAIN` / `PROTOTYPE` (check-constrained) |
| `source`, `source_url`, `source_record_id`, `raw_source_hash` | Mandatory provenance (NOT NULL) |
| `first_seen_at`, `last_seen_at`, `last_verified_at`, `imported_at` | Sync bookkeeping (Phase 17) |

Fields the official summary export does **not** provide (therefore absent, not
guessed): `qp_code`, `qp_title`, `nos_codes`, `nos_titles`, `education_requirement`,
`experience_requirement`, `minimum_age`, `sector_sub_sector`, `sub_sector`.
These live on official detail pages; the DB is ready for them via detail-page
enrichment without schema-breaking changes.

### 4.2 Import audit — `public.nqr_import_runs`

One row per run: mode, totals, validity counts, `error_log` (JSONB), who/when.

### 4.3 Browser subset — `public/nqr/official-active.json`

Generated by the importer (`--curated`): only `OFFICIAL_ACTIVE` records in the
app's ten sectors, purpose-shaped to what a recommendation card renders
(~500 KB for 1052 records; descriptions and delivery-hours stay in the DB).
Served as a static asset (PWA-cached), not bundled into JS chunks.

---

## 5. Provenance & status classification (Phase 5/6)

Every record stores: `source`, `source_url`, `source_record_id`,
`last_verified_at`, `imported_at`, `raw_source_hash` (content hash for change
detection), and `verification_status`:

| Status | Meaning | Recommendable? |
| --- | --- | --- |
| `OFFICIAL_ACTIVE` | `valid_till` present and ≥ today | ✅ Yes |
| `OFFICIAL_EXPIRED` | `valid_till` < today | ❌ Historical/reference only |
| `OFFICIAL_ARCHIVED` | type contains withdrawn/archived/… | ❌ Historical/reference only |
| `OFFICIAL_UNCERTAIN` | no `valid_till` in the source | ❌ Never assumed valid |
| `PROTOTYPE` | The original prototype catalog | ⚠ Only as clearly-labeled fallback |

Missing expiry is **never** treated as "valid forever" (explicit Phase 6
requirement). The validity gate is `isCurrentlyValidQualification()` in
`scripts/lib/nqr-normalize.mjs`, mirrored by the DB check-constrained status
column and re-checked client-side against `valid_till` when serving from a
cached snapshot.

---

## 6. Import pipeline (Phase 7/17/18)

```bash
# Preferred: import from an official export you downloaded from the site
node scripts/nqr-import.mjs --file ~/Downloads/NQR-summary.xlsx --db

# Or fetch directly from the official endpoint (single bulk POST, same one
# the site's Download button issues):
node scripts/nqr-import.mjs --fetch --db

# Without database credentials (artifacts only):
node scripts/nqr-import.mjs --file export.xlsx           # snapshot + report
node scripts/nqr-import.mjs --fetch --dry-run --curated public/nqr/official-active.json
```

Properties:

- **Idempotent:** upsert on the official `qualification_code`; re-runs are safe.
- **Transactional batches:** 500-row upserts; a failed batch aborts with a
  clear error, prior batches remain valid (re-run to completion).
- **Fail-safe on format change:** column drift produces validation errors and
  a non-zero exit — never silent corruption. The id-list/export row-count
  mismatch is refused rather than guessed.
- **Auditable:** every run writes a timestamped `*-snapshot-*.json` (all
  records incl. errors) and `*-report-*.json` (counts + validation error log).
- **Sync (Phase 17):** with `--db --mark-missing`, records absent from the
  current official snapshot are marked `OFFICIAL_ARCHIVED` (preserving
  history) rather than deleted. `first_seen_at`/`last_seen_at`/
  `last_verified_at`/`raw_source_hash` support incremental diffing.

### Last real import (2026-09-23, official endpoint)

| Metric | Value |
| --- | --- |
| Total rows | **2814** |
| Valid | **2804** |
| Rejected (validation findings) | **10** (2 approval-after-valid-till, 8 min-hours>max-hours — genuine data-quality findings in the official export, logged with ids) |
| `OFFICIAL_ACTIVE` | **1934** |
| `OFFICIAL_EXPIRED` | **880** |
| `OFFICIAL_ARCHIVED` / `UNCERTAIN` | 0 / 0 |
| Curated browser subset (active, app sectors) | **1052** |
| Source | National Qualification Register (NCVET), nqr.gov.in |

*(These numbers come from the actual import run — see the commit history for
the generated artifacts.)*

---

## 7. Matching & eligibility (Phase 9/10)

`supabase/functions/_shared/nqrmatch.ts` — **pure, explainable, additive**:

```
qualification_score =
    livelihood_match (35)            official sector ↔ livelihood affinity
  + skill/title match  (≤25)         user's skills/aspirations ↔ title+occupation tokens
  + occupation match   (15)          aspiration ↔ official proposed_occupation
  + experience fit      (8)          experienced users ↔ entry-level records
  + short duration      (7)          ≤300 notional hours (constraint-friendly)
  + entry-level fit    (10)          low education ↔ Level ≤ 3
```

- Every scored factor emits a named reason the UI translates — no black box.
- **Eligibility gate (Phase 10) runs before ranking:** records whose NSQF
  level exceeds the user's education guideline are demoted and rendered with
  an explicit pathway note ("complete Class 12 first, then pursue this
  qualification"). They are never shown as direct eligible options.
- **Only `OFFICIAL_ACTIVE` records** enter the pool (Phase 6 gate).
- Data the official export does not provide (age, prior vocational
  qualification, documented minimum education) is **not screened and not
  guessed** — eligibility notes the UI shows are labeled as guidelines.

---

## 8. UI (Phase 14/15/21/24)

- New **"Official NSQF qualifications"** section in the Assistant results
  panel, styled consistently with the existing design.
- Each card: official title, `Level X(.Y)`, official sector, notional hours,
  awarding body, valid-till date, **"✓ Official NQR Qualification"** badge,
  plain-language "Recommended because…" reasons, pathway note when
  applicable, and **"View official record ↗"** linking to the official page.
- Footer: *"Source: National Qualification Register (NCVET)"* — snapshot mode
  additionally shows the honest note that the information was *sourced from*
  the official register.
- When no official data resolves, the section is hidden and the existing
  prototype recommendations (with their ⚠ prototype badges) remain — the
  UI never fakes official coverage.
- Offline/PWA: the curated snapshot ships in the precache; cached official
  data is labeled as sourced-from-official, never as freshly verified.
- Dashboard (admin): "Official NQR data" card with total/active/expired+
  archived/last-verified counters via the admin-only `nqr_admin_summary()`
  RPC; non-admins see the empty note (server-enforced).

---

## 9. Security & privacy (Phase 19/20)

- **RLS deny-by-default:** both NQR tables enable RLS with **no** insert/
  update/delete/select policies — writes require the service role (importer);
  beneficiaries and staff cannot mutate NQR data.
- **Anonymized public read:** `nqr_qualification_public` view
  (`security_invoker = true`) exposes qualification facts only.
- **Admin RPC:** `nqr_admin_summary()` is `SECURITY DEFINER` with pinned
  `search_path`, checks `app_metadata.app_role = 'admin'` server-side, and is
  revoked from `public`/`anon`.
- **No PII mixing:** NQR records are public qualification facts; beneficiary
  profiles reference qualification codes, never duplicate records.
- **SSRF posture:** the importer fetches only `https://www.nqr.gov.in`
  (hard-coded origin, validated content-type, single polite bulk request).
  No user-controlled URLs are ever fetched server-side.
- **Secrets:** the importer requires `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` at run time (server-side env only). No service
  credentials in any `VITE_*` variable; `.env.example` documents names only.
- **Input validation:** every field is parsed/validated/length-bounded before
  upsert; enum constraints in the DB mirror the importer's allowlists.

---

## 10. Testing (Phase 22)

`tests/nqr.test.ts` — 29 tests covering:

- official-format parsers (hours, dates incl. impossible-day rejection,
  half-level NSQF display values) and their rejection paths
- `normalizeRow` validation: missing title/code/level/page-id, impossible
  durations, date-order violations, N.A. normalization, provenance presence
- status classification incl. the missing-expiry → `OFFICIAL_UNCERTAIN` rule
  and boundary (`valid_till == today` is active)
- import-report counting (valid/rejected/active/expired from real rows)
- explainable matching: livelihood/skill/occupation reasons, unrelated-sector
  zeroing, education pathway demotion, min-score/limit behavior
- validity gate for all five statuses
- committed-snapshot integrity: provenance on every record, `valid_till` ≥
  generation date, sector vocabulary restricted to real official sectors
- migration security: RLS with zero write policies, revoked base access,
  admin-gated SECURITY DEFINER RPC, NOT-NULL provenance, service-role-only
  importer env
- regression: the existing prototype opportunity engine still produces
  explainable matches unchanged

---

## 11. Known limitations & honest disclaimers (Phase 26)

1. **No live government API exists** for NQR data (as of integration date).
   This integration uses the official structured export via the site's own
   download endpoint — it is *not* a "live API integration" and is not
   described as one anywhere.
2. **Sync is manual/admin-triggered.** Re-run the importer to refresh.
   The site offers no webhook/subscription mechanism to automate this.
3. **The summary export omits eligibility and NOS tables** (they exist on
   detail pages). Those columns are therefore NULL rather than guessed;
   eligibility shown in the UI is NSQF-level guidance, clearly labeled.
4. **Snapshot freshness:** the committed browser snapshot reflects the import
   date; `valid_till` re-checks prevent expired records from resurfacing, but
   newly added official qualifications require a re-import to appear.
5. **Sector mapping** covers the ten sectors the app serves; other official
   sectors are stored but not surfaced in recommendations.
6. **DLT/robots/ToS:** robots.txt allows retrieval; the importer sends one
   bulk request equivalent to the site's own Download button. If NCVET
   publishes terms prohibiting this flow or an official bulk-download
   appears, the importer switches to the sanctioned source without pipeline
   changes (both paths share validation/upsert).
