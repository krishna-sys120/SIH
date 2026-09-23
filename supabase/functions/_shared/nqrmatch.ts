/**
 * Official NQR qualification matching (Phase 9/10/12) — EXTENDS, never
 * replaces, the existing recommendation engine (opportunity.ts).
 *
 * Matching is explainable: every factor contributes a named reason the UI
 * renders in the beneficiary's language. Official records flow through the
 * OFFICIAL_ACTIVE eligibility gate (isCurrentlyValidQualification) before any
 * scoring; expired/archived records are only surfaced as clearly labeled
 * historical reference. Eligibility is checked BEFORE recommendation
 * (Phase 10): ineligible records are never presented as direct options —
 * only as explicit pathway notes, and pathways are never fabricated.
 *
 * Pure TypeScript — browser, vitest, and Deno safe.
 */
import type { LivelihoodProfile } from "./extract";
import type { EducationLevel, Sector } from "../../../src/data/model";

/** Official sector name → the app's Sector id (only where meanings coincide). */
export const NQR_SECTOR_MAP: Record<string, Sector> = {
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

/** Livelihood → NQR sector affinities (overlap with app LIVELIHOOD_SECTORS). */
const LIVELIHOOD_NQR_SECTORS: Record<string, string[]> = {
  farmer: ["Agriculture"],
  "agri-labour": ["Agriculture"],
  "handloom-weaver": ["Textile & Handloom", "Handicrafts & Carpets"],
  tailor: ["Textile & Handloom"],
  artisan: ["Handicrafts & Carpets"],
  "leather-worker": ["Leather", "Handicrafts & Carpets"],
  "construction-labour": ["Construction"],
  "domestic-worker": ["Healthcare", "Home Management and Caregiving", "Food Industry/Food Processing"],
  "street-vendor": ["Food Industry/Food Processing", "Retail"],
  beautician: ["Beauty & Wellness"],
  mechanic: ["Automotive"],
  electrician: ["Construction", "Electronics & HW", "Power"],
  fisher: ["Agriculture", "Food Industry/Food Processing"],
  dairy: ["Agriculture", "Food Industry/Food Processing"],
  "waste-picker": ["Agriculture", "Construction", "Water Supply, Sewerage, Waste Management & Remediation activities"],
  student: ["IT-ITeS", "Electronics & HW", "Healthcare", "BFSI"],
  unemployed: ["IT-ITeS", "Food Industry/Food Processing", "Construction", "Textile & Handloom", "Retail"],
  homemaker: ["Textile & Handloom", "Food Industry/Food Processing", "Beauty & Wellness", "Home Management and Caregiving"],
};

/** Purpose-shaped curated record (see scripts/nqr-import.mjs --curated). */
export interface NqrQualification {
  code: string;
  title: string;
  sector: Sector | null;
  sector_official: string;
  level_display: string;
  level: number | null;
  hours_max: number | null;
  hours_min: number | null;
  valid_till: string | null;
  awarding_body: string | null;
  occupation: string | null;
  source_url: string;
  raw_source_hash: string;
}

export type NqrReasonId =
  | "nqrLivelihoodMatch"
  | "nqrSkillTitleMatch"
  | "nqrOccupationMatch"
  | "nqrEducationFit"
  | "nqrLevelEntry"
  | "nqrExperienceFit"
  | "nqrShortDuration";

export interface NqrReason {
  id: NqrReasonId;
  weight: number;
  vars?: Record<string, string | number>;
}

export interface NqrMatch {
  qualification: NqrQualification;
  score: number;
  reasons: NqrReason[];
  /** Present when eligibility data excludes the record (Phase 10 pathway). */
  pathway: {
    /** i18n key describing which requirement is unmet. */
    blocker: "education" | "level";
    /** User-friendly required value ("Class 10", "NSQF Level 3"). */
    required: string;
  } | null;
  /** True only for explicitly historical lists (expired/archived shown as reference). */
  historical: boolean;
}

const TOKEN_RE = /[a-z0-9\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CEF]{3,}/g;

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(TOKEN_RE) ?? []).filter(
    (t) => !["the", "and", "for", "with", "of", "in", "to", "a", "an"].includes(t),
  );
}

function titleTokens(q: NqrQualification): Set<string> {
  return new Set(tokenize(`${q.title} ${q.occupation ?? ""}`));
}

/** Rank ≥ Level 5 assume senior-secondary entry — used for eligibility checks. */
const EDU_ORDER: EducationLevel[] = ["none", "primary", "secondary", "senior", "graduate"];

/**
 * Phase 10 eligibility screen — data-driven, never fabricated:
 *  - education: official records do NOT publish minimum education in the
 *    summary export, so education gating uses only the NSQF level guideline
 *    (levels ≥ 5 target post-senior-secondary learners) and is always
 *    explained in the UI as a guideline, not an official requirement.
 *  - experience / age / vocational prerequisites: NULL in the official
 *    summary export → not screened, never guessed.
 */
function eligibilityBlocker(
  profile: LivelihoodProfile,
  q: NqrQualification,
): NqrMatch["pathway"] {
  const level = q.level;
  if (level === null) return null;
  const eduIdx = EDU_ORDER.indexOf(profile.education);
  // Guideline: Level 1-3 entry-level, 4 mid, ≥5 assumes 10+2 / diploma.
  if (level >= 5 && eduIdx < EDU_ORDER.indexOf("senior")) {
    return { blocker: "education", required: "Class 12" };
  }
  if (level === 4 && eduIdx < EDU_ORDER.indexOf("secondary")) {
    return { blocker: "education", required: "Class 10" };
  }
  return null;
}

/** Explainable match of one official qualification against a profile. */
export function scoreNqrQualification(
  profile: LivelihoodProfile,
  q: NqrQualification,
): NqrMatch {
  const reasons: NqrReason[] = [];
  let score = 0;

  // 1. Livelihood ↔ official-sector affinity (strongest signal).
  const livSectors = LIVELIHOOD_NQR_SECTORS[profile.current_occupation ?? ""] ?? [];
  if (q.sector_official && livSectors.includes(q.sector_official)) {
    score += 35;
    reasons.push({ id: "nqrLivelihoodMatch", weight: 1, vars: { sector: q.sector_official } });
  }

  // 2. Skill / interest words against the official title + occupation.
  const words = new Set([
    ...profile.skills.map((s) => s.replace(/_/g, " ")),
    ...profile.interests.map((i) => i.toLowerCase()),
  ]);
  const qTokens = titleTokens(q);
  let wordHits = 0;
  for (const w of words) {
    for (const t of tokenize(w)) {
      if (qTokens.has(t)) {
        wordHits += 1;
        break;
      }
    }
  }
  if (wordHits > 0) {
    score += Math.min(25, 12 * wordHits);
    reasons.push({ id: "nqrSkillTitleMatch", weight: wordHits, vars: { n: wordHits } });
  }

  // 3. Aspiration ↔ proposed occupation (exact official occupation string).
  if (
    q.occupation &&
    profile.interests.some((i) => q.occupation!.toLowerCase().includes(i.toLowerCase().trim())) 
  ) {
    score += 15;
    reasons.push({ id: "nqrOccupationMatch", weight: 1, vars: { occupation: q.occupation } });
  }

  // 4. Experience: entry-level roles (≤3) welcome first-time workers; higher
  //    levels value experience. Both directions are explainable, not punitive.
  if (profile.experience_years !== null) {
    if (q.level !== null && q.level <= 3 && profile.experience_years >= 3) {
      score += 8;
      reasons.push({ id: "nqrExperienceFit", weight: 1 });
    }
  }

  // 5. Shorter commitments nudge for low-mobility / constrained users.
  if (q.hours_max !== null && q.hours_max <= 300) {
    score += 7;
    reasons.push({ id: "nqrShortDuration", weight: 1, vars: { hours: q.hours_max } });
  }

  // 6. Entry-level friendliness for low education (guideline, explained).
  const eduIdx = EDU_ORDER.indexOf(profile.education);
  if (q.level !== null && q.level <= 3 && eduIdx <= EDU_ORDER.indexOf("primary")) {
    score += 10;
    reasons.push({ id: "nqrLevelEntry", weight: 1 });
  }

  // Eligibility gate (Phase 10) — computed last so pathway reasons survive.
  const pathway = eligibilityBlocker(profile, q);
  if (pathway) {
    score = Math.round(score * 0.3); // demoted, never presented as direct option
  }

  return {
    qualification: q,
    score: Math.max(0, Math.min(100, score)),
    reasons,
    pathway,
    historical: false,
  };
}

/**
 * Rank official qualifications for a profile. Only currently-valid records
 * are scored (Phase 6); the caller may additionally pass expired/archived
 * records for a clearly-labeled historical section (returned with
 * `historical: true`, never mixed into the main ranking).
 */
export function recommendNqrQualifications(
  profile: LivelihoodProfile,
  pool: NqrQualification[],
  opts: { limit?: number; minScore?: number } = {},
): NqrMatch[] {
  const { limit = 4, minScore = 20 } = opts;
  return pool
    .filter((q) => q.level !== null) // level is required for explainability
    .map((q) => scoreNqrQualification(profile, q))
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
