/**
 * NQR import normalizer + validator + status classifier (Phase 5/6/18).
 *
 * Converts rows from the OFFICIAL NQR summary export (nqr.gov.in
 * downloadSummaryFile XLSX) into validated records. Every field maps 1:1 to
 * an official source column; fields the official export does not provide are
 * left NULL — nothing is guessed, inferred or fabricated.
 *
 * Pure ES module — used by scripts/nqr-import.mjs and tests/nqr.test.ts.
 *
 * @typedef {"OFFICIAL_ACTIVE"|"OFFICIAL_EXPIRED"|"OFFICIAL_ARCHIVED"|"OFFICIAL_UNCERTAIN"|"PROTOTYPE"} VerificationStatus
 */

// ── Status vocabulary (Phase 5) ────────────────────────────────────────────
export const VERIFICATION_STATUSES = [
  "OFFICIAL_ACTIVE",
  "OFFICIAL_EXPIRED",
  "OFFICIAL_ARCHIVED",
  "OFFICIAL_UNCERTAIN",
  "PROTOTYPE",
];

/** Statuses eligible for normal (non-historical) recommendation. */
export const RECOMMENDABLE_STATUSES = ["OFFICIAL_ACTIVE"];

/**
 * Official NQR export columns (verified against a real 2814-row export,
 * September 2026). The importer fails safely if these change.
 */
export const EXPECTED_COLUMNS = [
  "Title",
  "Code",
  "Description",
  "Sector Name",
  "Level",
  "Maximum Notational Hours",
  "Minimum Notational Hours",
  "Version",
  "Originally Approved",
  "Valid Till",
  "Awarding Body",
  "Certifying Bodies",
  "Proposed Occupation",
  "Progression Pathway",
  "Qualifcation Type", // sic — the official export spells it this way
  "Adopted Qualifcation", // sic
  "Training Delivery Hours",
];

/** Qualification-type values that indicate an archived/withdrawn record. */
const ARCHIVED_TYPE_HINTS = /withdrawn|archived|discontinued|superseded/i;

/**
 * @typedef {Object} NormalizedNqrRecord
 * @property {string|null} nqr_page_id        Official NQR page id (source_record_id)
 * @property {string|null} qualification_code Official code exactly as published
 * @property {string|null} qualification_title
 * @property {string|null} qualification_description
 * @property {string|null} sector_official    Official sector name as published
 * @property {string|null} nsqf_level_display Official display value ("Level 4.5")
 * @property {number|null} nsqf_level_numeric Normalized for comparisons only
 * @property {number|null} notional_hours_max
 * @property {number|null} notional_hours_min
 * @property {string|null} version
 * @property {string|null} approval_date      ISO yyyy-mm-dd
 * @property {string|null} valid_till         ISO yyyy-mm-dd
 * @property {string|null} awarding_body
 * @property {string|null} certifying_bodies
 * @property {string|null} proposed_occupation
 * @property {string|null} progression_pathway
 * @property {string|null} qualification_type
 * @property {string|null} adopted_qualification
 * @property {string|null} training_delivery_hours
 * @property {VerificationStatus} verification_status
 * @property {"NCVET_NQR"} source
 * @property {string|null} source_url
 * @property {string|null} source_record_id
 * @property {string} raw_source_hash
 * @property {string[]} import_errors
 */

// ── Parsers for the formats actually observed in the official export ──────

/** "330 Hours" / "4.5 Hours" / "600" → number|null. Rejects nonsense. */
export function parseHours(raw) {
  const m = String(raw ?? "")
    .trim()
    .match(/^([0-9]{1,5}(?:\.[0-9])?)\s*(?:hours?)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0 || n > 10000) return null;
  return n;
}

const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Official date format: "17 Nov 2022" → "2022-11-17" (ISO). */
export function parseOfficialDate(raw) {
  const m = String(raw ?? "")
    .trim()
    .match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  if (!(day >= 1 && day <= 31)) return null; // reject impossible days (32 Dec …)
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${String(day).padStart(2, "0")}`;
}

/** "Level 4.5" → {display:"Level 4.5", numeric:4.5} ; garbage → null. */
export function parseLevel(raw) {
  const m = String(raw ?? "")
    .trim()
    .match(/^Level\s*([0-9]+(?:\.[0-9])?)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!(n >= 1 && n <= 10)) return null;
  return { display: `Level ${m[1]}`, numeric: n };
}

/** Today's date in ISO (yyyy-mm-dd) — injectable for tests. */
function isoToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Phase 6 classifier. Rules (in order):
 *  - qualification_type mentioning withdrawn/archived/… → OFFICIAL_ARCHIVED
 *  - valid_till present and < today → OFFICIAL_EXPIRED
 *  - valid_till present and ≥ today → OFFICIAL_ACTIVE
 *  - no valid_till at all → OFFICIAL_UNCERTAIN (missing expiry is NOT "valid
 *    forever" — Phase 6 explicitly forbids that assumption)
 */
export function classifyStatus(validTillIso, qualificationType, today = isoToday()) {
  const type = qualificationType ?? "";
  if (ARCHIVED_TYPE_HINTS.test(type)) return "OFFICIAL_ARCHIVED";
  if (validTillIso && validTillIso < today) return "OFFICIAL_EXPIRED";
  if (validTillIso) return "OFFICIAL_ACTIVE";
  return "OFFICIAL_UNCERTAIN";
}

/** FNV-1a 32-bit hex — stable content hash for change detection (Phase 17). */
export function contentHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}

/** Decode HTML entities + unicode ligatures that survive into the export. */
export function cleanText(raw) {
  return String(raw ?? "")
    .replace(/\uFB01/g, "fi")
    .replace(/\uFB02/g, "fl")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))) // e.g. &#039; → '
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize + validate one official row. Invalid rows are returned with a
 * non-empty `import_errors` array (never silently dropped — Phase 18 requires
 * an auditable error report).
 * @param {Record<string, string|number|undefined>} row
 * @param {{today?: string}} [opts]
 * @returns {NormalizedNqrRecord}
 */
export function normalizeRow(row, opts = {}) {
  const errors = [];
  const title = cleanText(String(row["Title"] ?? ""));
  const code = cleanText(String(row["Code"] ?? ""));
  const description = cleanText(String(row["Description"] ?? ""));
  const sector = cleanText(String(row["Sector Name"] ?? ""));
  const levelRaw = String(row["Level"] ?? "");

  if (!title) errors.push("missing title");
  if (!code) errors.push("missing official code");

  const level = parseLevel(levelRaw);
  if (!level && levelRaw.trim()) errors.push(`invalid NSQF level "${levelRaw.trim().slice(0, 20)}"`);
  if (!level && !levelRaw.trim()) errors.push("missing NSQF level");

  const hoursMaxRaw = String(row["Maximum Notational Hours"] ?? "");
  const hoursMinRaw = String(row["Minimum Notational Hours"] ?? "");
  const hoursMax = parseHours(hoursMaxRaw);
  const hoursMin = parseHours(hoursMinRaw);
  if (hoursMaxRaw.trim() && hoursMax === null) {
    errors.push(`invalid max notional hours "${hoursMaxRaw.slice(0, 20)}"`);
  }
  if (hoursMax !== null && hoursMin !== null && hoursMin > hoursMax) {
    errors.push("min notional hours exceed max");
  }

  const approval = parseOfficialDate(String(row["Originally Approved"] ?? ""));
  const validTill = parseOfficialDate(String(row["Valid Till"] ?? ""));
  const validTillRaw = String(row["Valid Till"] ?? "");
  if (validTillRaw.trim() && !validTill) {
    errors.push(`invalid valid_till date "${validTillRaw.slice(0, 20)}"`);
  }
  if (approval && validTill && approval > validTill) errors.push("approval date after valid_till");

  const nqrPageId = String(row["__page_id"] ?? "").trim() || null;
  if (!nqrPageId) errors.push("missing NQR page id (source_record_id)");

  // Type / adopted columns carry "N.A.", "NA" or "N/A" for none.
  const na = (v) => {
    const t = cleanText(v);
    return !t || /^n[./]?a\.?$/i.test(t) ? null : t;
  };

  const qualificationType = na(String(row["Qualifcation Type"] ?? ""));
  const verificationStatus = classifyStatus(validTill, qualificationType, opts.today);

  // Stable change-detection hash over the official content (Phase 17).
  const rawSourceHash = contentHash(
    JSON.stringify([title, code, sector, levelRaw, row["Maximum Notational Hours"], row["Valid Till"], qualificationType]),
  );

  return {
    nqr_page_id: nqrPageId,
    qualification_code: code || null,
    qualification_title: title || null,
    qualification_description: description || null,
    sector_official: sector || null,
    nsqf_level_display: level ? level.display : null,
    nsqf_level_numeric: level ? level.numeric : null,
    notional_hours_max: hoursMax,
    notional_hours_min: hoursMin,
    version: cleanText(String(row["Version"] ?? "")) || null,
    approval_date: approval,
    valid_till: validTill,
    awarding_body: cleanText(String(row["Awarding Body"] ?? "")) || null,
    certifying_bodies: cleanText(String(row["Certifying Bodies"] ?? "")) || null,
    proposed_occupation: na(String(row["Proposed Occupation"] ?? "")),
    progression_pathway: na(String(row["Progression Pathway"] ?? "")),
    qualification_type: qualificationType,
    adopted_qualification: na(String(row["Adopted Qualifcation"] ?? "")),
    training_delivery_hours: cleanText(String(row["Training Delivery Hours"] ?? "")) || null,
    verification_status: verificationStatus,
    source: "NCVET_NQR",
    source_url: nqrPageId ? `https://www.nqr.gov.in/qualifications/${nqrPageId}` : null,
    source_record_id: nqrPageId,
    raw_source_hash: rawSourceHash,
    import_errors: errors,
  };
}

/**
 * True when a record may be recommended as a current qualification (Phase 6).
 * Deliberately strict: uncertain validity is NOT current validity.
 */
export function isCurrentlyValidQualification(rec, today = isoToday()) {
  if (rec.verification_status !== "OFFICIAL_ACTIVE") return false;
  if (rec.valid_till && rec.valid_till < today) return false; // belt & braces
  return true;
}

/** Aggregate import report (Phase 18/30) — real numbers only. */
export function buildImportReport(records) {
  const counts = {
    total: records.length,
    valid: 0,
    rejected: 0,
    active: 0,
    expired: 0,
    archived: 0,
    uncertain: 0,
  };
  const errorLog = [];
  for (const r of records) {
    if (r.import_errors.length > 0) {
      counts.rejected += 1;
      errorLog.push({ source_record_id: r.source_record_id, title: r.qualification_title, errors: r.import_errors });
    } else {
      counts.valid += 1;
    }
    if (r.verification_status === "OFFICIAL_ACTIVE") counts.active += 1;
    else if (r.verification_status === "OFFICIAL_EXPIRED") counts.expired += 1;
    else if (r.verification_status === "OFFICIAL_ARCHIVED") counts.archived += 1;
    else if (r.verification_status === "OFFICIAL_UNCERTAIN") counts.uncertain += 1;
  }
  return { counts, errorLog };
}
