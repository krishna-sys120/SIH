#!/usr/bin/env node
/**
 * Official NQR import pipeline (Phase 7/17/18/30).
 *
 *   node scripts/nqr-import.mjs --file <export.xlsx> [--ids <ids.txt>] [--dry-run]
 *   node scripts/nqr-import.mjs --fetch [--dry-run]
 *   node scripts/nqr-import.mjs --db                      # push snapshot → Supabase
 *   node scripts/nqr-import.mjs --db --mark-missing       # also archive rows absent from snapshot
 *
 * Data source (Phase 2/3/27): the OFFICIAL National Qualification Register
 * (nqr.gov.in, NCVET). Two supported ingestion modes:
 *
 *   1. --file : an official "Download Summary" XLSX exported from
 *      https://www.nqr.gov.in/qualifications-search (the site's own
 *      downloadSummaryFile endpoint). This is the preferred, sanctioned path.
 *   2. --fetch: retrieves the search page and POSTs downloadSummaryFile with
 *      the site's own qualification-id list (single bulk request, the same one
 *      the site's Download button issues). robots.txt allows all; polite
 *      single-request; provenance recorded on every row.
 *
 * The importer is idempotent (dedup on official code + page id), validates
 * every record, writes an auditable error report, and NEVER fabricates fields
 * the official export does not contain (Phase 3/5/18).
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { readXlsx } from "./lib/nqr-xlsx.mjs";
import {
  normalizeRow,
  buildImportReport,
  isCurrentlyValidQualification,
} from "./lib/nqr-normalize.mjs";

const NQR_ORIGIN = "https://www.nqr.gov.in";
const SEARCH_URL = `${NQR_ORIGIN}/qualifications-search`;
const SUMMARY_URL = `${NQR_ORIGIN}/downloadSummaryFile`;
const UA =
  "Mozilla/5.0 (compatible; SkillSetu-NQR-import/1.0; +https://github.com/krishna-sys120/SIH)";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") args.file = argv[++i];
    else if (a === "--fetch") args.fetch = true;
    else if (a === "--ids") args.ids = argv[++i];
    else if (a === "--db") args.db = true;
    else if (a === "--mark-missing") args.markMissing = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--curated") args.curated = argv[++i];
    else args._.push(a);
  }
  return args;
}

/** GET the search page; return { html, cookieHeader, token } (same Laravel session). */
async function getSearchPage() {
  const res = await fetch(SEARCH_URL, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`search page HTTP ${res.status}`);
  const html = await res.text();
  const cookies = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  const token = html.match(/name="_token" value="([^"]+)"/)?.[1] ?? null;
  if (!token) throw new Error("could not read CSRF token from search page");
  return { html, cookieHeader: cookies, token };
}

/**
 * POST the official downloadSummaryFile endpoint (exactly what the site's
 * "Download Summary" button does) with the given id list. Token and cookies
 * MUST come from the same session as the search page (Laravel CSRF).
 */
async function postDownloadSummary(idsCsv, cookieHeader, token) {
  const body = new URLSearchParams({ _token: token, qualificationids: idsCsv });
  const res = await fetch(SUMMARY_URL, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: SEARCH_URL,
      Cookie: cookieHeader,
    },
    body,
  });
  if (!res.ok) throw new Error(`downloadSummaryFile HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!/spreadsheetml|octet-stream/i.test(ct)) {
    throw new Error(`unexpected content-type: ${ct}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Extract the site's own visible-qualification id list from the search page. */
function extractQualificationIds(html) {
  const m = html.match(/name="qualificationids"[^>]*value="([0-9,]+)"/);
  if (!m) throw new Error("qualification id list not found on search page");
  return m[1];
}

/** Zip the site's page-id list onto export rows (order verified 1:1). */
function addPageIds(rows, idsCsv) {
  const ids = idsCsv.split(",").map((s) => s.trim());
  if (ids.length !== rows.length) {
    throw new Error(
      `id-list length (${ids.length}) does not match export row count (${rows.length}) — refusing to guess provenance`,
    );
  }
  return rows.map((r, i) => ({ ...r, __page_id: ids[i] }));
}

// ── Supabase upsert (Phase 7/17) ───────────────────────────────────────────

const UPSERT_COLUMNS = [
  "nqr_page_id", "qualification_code", "qualification_title", "qualification_description",
  "sector_official", "nsqf_level_display", "nsqf_level_numeric",
  "notional_hours_max", "notional_hours_min", "version", "approval_date", "valid_till",
  "awarding_body", "certifying_bodies", "proposed_occupation", "progression_pathway",
  "qualification_type", "adopted_qualification", "training_delivery_hours",
  "verification_status", "source", "source_url", "source_record_id", "raw_source_hash",
];

async function upsertToDb(records) {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required for --db (service role, server-side only — never a VITE_ variable)",
    );
  }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  // Phase 7 dedup: official code is the natural key (unique per qualification
  // version); page id is the stable NQR identifier. Upsert on
  // (qualification_code) keeps import idempotent.
  const rows = records.map((r) => {
    const row = {};
    for (const c of UPSERT_COLUMNS) row[c] = r[c] ?? null;
    row.imported_at = new Date().toISOString();
    row.last_verified_at = new Date().toISOString();
    return row;
  });

  const valid = rows.filter((_, i) => records[i].import_errors.length === 0);
  const BATCH = 500;
  let upserted = 0;
  for (let i = 0; i < valid.length; i += BATCH) {
    const batch = valid.slice(i, i + BATCH);
    const { error } = await admin
      .from("nqr_qualifications")
      .upsert(batch, { onConflict: "qualification_code", ignoreDuplicates: false });
    if (error) throw new Error(`upsert batch ${i}: ${error.message}`);
    upserted += batch.length;
  }

  // Phase 17 sync: rows in DB but absent from this snapshot get archived
  // (only with --mark-missing; requires admin intent).
  let archivedMissing = 0;
  if (process.argv.includes("--mark-missing")) {
    const seenCodes = new Set(valid.map((r) => r.qualification_code));
    const { data: existing, error } = await admin
      .from("nqr_qualifications")
      .select("qualification_code, raw_source_hash")
      .eq("source", "NCVET_NQR");
    if (error) throw new Error(`archive scan: ${error.message}`);
    const missing = (existing ?? []).filter((e) => !seenCodes.has(e.qualification_code));
    for (const m of missing) {
      const { error: uerr } = await admin
        .from("nqr_qualifications")
        .update({
          verification_status: "OFFICIAL_ARCHIVED",
          last_verified_at: new Date().toISOString(),
        })
        .eq("qualification_code", m.qualification_code);
      if (uerr) throw new Error(`archive update: ${uerr.message}`);
      archivedMissing += 1;
    }
  }
  return { upserted, archivedMissing };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file && !args.fetch) {
    console.error(
      "usage: node scripts/nqr-import.mjs (--file <export.xlsx> | --fetch) [--ids <ids.txt>] [--db] [--mark-missing] [--dry-run] [--out <report.json>]",
    );
    process.exit(2);
  }

  let buf;
  let idsCsv = null;
  if (args.file) {
    buf = fs.readFileSync(path.resolve(args.file));
    if (args.ids) idsCsv = fs.readFileSync(path.resolve(args.ids), "utf8").trim();
  } else {
    console.error(`[nqr] fetching official search page ${SEARCH_URL} …`);
    const { html, cookieHeader, token } = await getSearchPage();
    idsCsv = extractQualificationIds(html);
    console.error(`[nqr] ${idsCsv.split(",").length} qualification ids listed by the official site`);
    console.error("[nqr] POSTing the official downloadSummaryFile endpoint …");
    buf = await postDownloadSummary(idsCsv, cookieHeader, token);
  }

  console.error("[nqr] parsing workbook …");
  const rawRows = readXlsx(buf);
  console.error(`[nqr] ${rawRows.length} data rows parsed`);

  const rows = idsCsv ? addPageIds(rawRows, idsCsv) : rawRows;
  const records = rows.map((r) => normalizeRow(r));
  const report = buildImportReport(records);
  const currentlyValid = records.filter(isCurrentlyValidQualification);

  // Phase 30 — real numbers only, printed from the actual import.
  console.log("── NQR import report ─────────────────────────────");
  console.log(`source:            National Qualification Register (NCVET), ${NQR_ORIGIN}`);
  console.log(`total rows:        ${report.counts.total}`);
  console.log(`valid:             ${report.counts.valid}`);
  console.log(`rejected:          ${report.counts.rejected}`);
  console.log(`  OFFICIAL_ACTIVE:    ${report.counts.active}`);
  console.log(`  OFFICIAL_EXPIRED:   ${report.counts.expired}`);
  console.log(`  OFFICIAL_ARCHIVED:  ${report.counts.archived}`);
  console.log(`  OFFICIAL_UNCERTAIN: ${report.counts.uncertain}`);
  console.log(`currently valid:   ${currentlyValid.length} (recommendable)`);
  if (report.errorLog.length > 0) {
    console.log("validation errors:");
    for (const e of report.errorLog.slice(0, 10)) {
      console.log(`  - [${e.source_record_id ?? "?"}] ${e.title ?? "?"}: ${e.errors.join("; ")}`);
    }
    if (report.errorLog.length > 10) console.log(`  … +${report.errorLog.length - 10} more`);
  }

  // Auditable artifacts (Phase 18): normalized snapshot + error report.
  const outBase = args.out ?? "nqr-import";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotPath = `${outBase}-snapshot-${stamp}.json`;
  const reportPath = `${outBase}-report-${stamp}.json`;
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify({ generated_at: new Date().toISOString(), source: "NCVET_NQR", records }, null, 1),
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
  console.log(`snapshot:   ${snapshotPath}`);
  console.log(`error log:  ${reportPath}`);

  // Phase 21 — small curated subset for the browser/offline layer: only
  // currently-valid (OFFICIAL_ACTIVE) records in sectors the app serves,
  // description trimmed. The full snapshot is NOT shipped to the browser.
  if (args.curated) {
    const SECTOR_MAP = {
      "Textile & Handloom": "textiles",
      Agriculture: "agri",
      Construction: "construction",
      "Beauty & Wellness": "beauty",
      Automotive: "automotive",
      "Electronics & HW": "electronics",
      "Food Industry/Food Processing": "food",
      "Handicrafts & Carpets": "handicrafts",
      "IT-ITeS": "it",
      Healthcare: "healthcare",
    };
    const APP_SECTORS = new Set(Object.keys(SECTOR_MAP));
    const curated = currentlyValid
      .filter((r) => r.sector_official && APP_SECTORS.has(r.sector_official))
      .map((r) => ({
        // Purpose-shaped subset: exactly what the recommendation card renders
        // (Phase 14/21). Full records live in the DB / import snapshot only.
        code: r.qualification_code,
        title: r.qualification_title,
        sector: SECTOR_MAP[r.sector_official] ?? null,
        sector_official: r.sector_official,
        level_display: r.nsqf_level_display,
        level: r.nsqf_level_numeric,
        hours_max: r.notional_hours_max,
        hours_min: r.notional_hours_min,
        valid_till: r.valid_till,
        awarding_body: r.awarding_body,
        occupation: r.proposed_occupation,
        source_url: r.source_url,
        raw_source_hash: r.raw_source_hash,
      }));
    fs.writeFileSync(
      args.curated,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          source: "NCVET_NQR",
          source_note:
            "Official qualification data from the National Qualification Register (nqr.gov.in), NCVET. Only OFFICIAL_ACTIVE records with a current valid_till date are included.",
          count: curated.length,
          records: curated,
        },
        null,
        1,
      ),
    );
    console.log(`curated:    ${args.curated} (${curated.length} active official records)`);
  }

  if (args.dryRun) {
    console.log("[nqr] dry-run — no database writes.");
    return;
  }
  if (args.db) {
    const res = await upsertToDb(records);
    console.log(`db upsert:  ${res.upserted} rows${res.archivedMissing ? `, archived ${res.archivedMissing} missing` : ""}`);
  }
}

main().catch((e) => {
  console.error("[nqr] import failed:", e.message);
  process.exit(1);
});
