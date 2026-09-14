/**
 * Local opportunity engine (Phase 9/10/11) — explainable, weighted scoring.
 *
 * Final recommendation score =
 *   skill match + local demand signal + education compatibility +
 *   location compatibility + preference match + training availability +
 *   mobility fit.
 *
 * Every factor contributes a named, structured reason so the UI can show WHY.
 * Demand signals are INDICATIVE (sector presence in seeded district data) and
 * every course carries its own verification badge — no fabricated statistics.
 *
 * Pure TS — browser, vitest, Deno safe.
 */
import type { Course, EducationLevel, LivelihoodId } from "../../../src/data/model";
import { educationCeiling } from "../../../src/data/model";
import type { LivelihoodProfile } from "./extract";
import { computeSkillGap } from "./skillgap";
import { roleById, JOB_ROLES, type SkillId } from "./taxonomy";

export type ReasonId =
  | "skillMatch"
  | "localDemand"
  | "educationFit"
  | "locationFit"
  | "preferenceFit"
  | "trainingAvailable"
  | "mobilityFit"
  | "freeWithStipend"
  | "constraintConflict";

export interface Reason {
  id: ReasonId;
  /** 0-1 contribution strength for progress-bar rendering. */
  weight: number;
  /** Structured details the UI localizes (skill names, district names…). */
  vars?: Record<string, string | number>;
}

export interface OpportunityMatch {
  course: Course;
  score: number;
  reasons: Reason[];
  /** Skill gap vs the course's primary job role (if mapped). */
  gap: {
    roleId: string;
    roleTitle: string;
    matchPercent: number;
    matchedSkills: SkillId[];
    missingSkills: SkillId[];
    verification: "official" | "prototype";
  } | null;
  /** True when physical constraints conflict with mapped role demands. */
  constraintConflict: boolean;
}

/** District sector demand signals — INDICATIVE, from the seed dataset only. */
export const DISTRICT_SECTOR_DEMAND: Record<string, Partial<Record<string, number>>> = {
  nagpur: { textiles: 0.7, construction: 0.8, electronics: 0.7, it: 0.6, automotive: 0.6 },
  gadchiroli: { handicrafts: 0.9, construction: 0.6, agri: 0.7 },
  hyderabad: { healthcare: 0.9, beauty: 0.7, food: 0.8, electronics: 0.8, handicrafts: 0.5 },
  guntur: { agri: 0.9, it: 0.5, handicrafts: 0.4 },
};

function districtDemand(district: string, sector: string): number {
  const key = district.toLowerCase().trim();
  return DISTRICT_SECTOR_DEMAND[key]?.[sector] ?? 0.3;
}

export function educationCeilingFor(profile: LivelihoodProfile): number {
  const levels = ["none", "primary", "secondary", "senior", "graduate"];
  const idx = levels.indexOf(profile.education);
  return educationCeiling((idx >= 0 ? levels[idx] : "secondary") as EducationLevel);
}

/** Core explainable scorer for one course against a profile. */
export function scoreCourse(profile: LivelihoodProfile, course: Course): OpportunityMatch {
  const reasons: Reason[] = [];
  let score = 0;
  let constraintConflict = false;

  // 1. Skill match (via mapped role when possible).
  let skillScore = 0;
  let gap: OpportunityMatch["gap"] = null;
  const role = JOB_ROLE_BY_SECTOR[course.sector];
  if (role) {
    const g = computeSkillGap(profile, roleById(role)!);
    skillScore = g.weightedMatch / 100;
    gap = {
      roleId: g.roleId,
      roleTitle: g.roleTitle,
      matchPercent: g.matchPercent,
      matchedSkills: g.matchedSkills,
      missingSkills: g.missingSkills,
      verification: "prototype",
    };
    constraintConflict = g.constraintConflict;
    if (g.matchedSkills.length > 0) {
      reasons.push({ id: "skillMatch", weight: skillScore, vars: { n: g.matchedSkills.length } });
    }
  }
  score += skillScore * 30;

  // 2. Local demand signal (indicative).
  const demand = districtDemand(course.district, course.sector);
  if (profile.location_district && demand > 0.3) {
    score += demand * 20;
    reasons.push({ id: "localDemand", weight: demand });
  }

  // 3. Education compatibility.
  const ceiling = educationCeilingFor(profile);
  const eduFit = course.nsqf_level <= ceiling ? 1 : 0.2;
  score += eduFit * 15;
  if (eduFit === 1) reasons.push({ id: "educationFit", weight: 1, vars: { level: course.nsqf_level } });
  else constraintConflict = constraintConflict || true;

  // 4. Location compatibility.
  const sameDistrict =
    (profile.location_district ?? "").toLowerCase().trim() === course.district.toLowerCase().trim();
  const sameState =
    (profile.location_state ?? "").toLowerCase().trim() === course.state.toLowerCase().trim();
  const locFit = sameDistrict ? 1 : sameState ? 0.6 : 0.25;
  score += locFit * 15;
  if (sameDistrict || sameState) {
    reasons.push({ id: "locationFit", weight: locFit, vars: { district: course.district } });
  }

  // 5. Preference match (wage vs self).
  const courseSelfFriendly = (roleById(role ?? "")?.business.length ?? 0) > 0;
  const prefFit =
    profile.employment_preference === "either"
      ? 0.7
      : profile.employment_preference === "self"
        ? courseSelfFriendly
          ? 1
          : 0.4
        : 0.8;
  score += prefFit * 10;
  reasons.push({ id: "preferenceFit", weight: prefFit });

  // 6. Training availability.
  const seats = Math.max(0, course.seats_left);
  const availFit = seats > 0 ? Math.min(1, seats / 20) : 0;
  score += availFit * 5;
  if (seats > 0) reasons.push({ id: "trainingAvailable", weight: availFit, vars: { seats } });

  // 7. Mobility fit: low-mobility users need nearby training.
  const farOk = profile.mobility_constraints.can_travel_far !== false;
  const kmCap = profile.mobility_constraints.max_travel_km;
  const mobilityFit = !farOk || kmCap !== null ? locFit : 0.7;
  if (!farOk || kmCap !== null) {
    score += mobilityFit * 5;
    reasons.push({ id: "mobilityFit", weight: mobilityFit, vars: { district: course.district } });
  }

  // 8. Free with stipend nudge.
  if (course.stipend_monthly > 0) {
    score += 3;
    reasons.push({ id: "freeWithStipend", weight: 1, vars: { amount: course.stipend_monthly } });
  }

  if (constraintConflict) reasons.push({ id: "constraintConflict", weight: 1 });

  return {
    course,
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    gap,
    constraintConflict,
  };
}

/** Sector → primary prototype job role id (for skill-gap anchoring). */
export const JOB_ROLE_BY_SECTOR: Record<string, string> = {
  automotive: "automotive_service_tech",
  textiles: "sewing_machine_operator",
  healthcare: "general_duty_assistant",
  electronics: "mobile_repair_tech",
  construction: "mason_general",
  beauty: "beauty_therapist",
  food: "food_service_steward",
  agri: "organic_grower",
  it: "data_entry_operator",
  handicrafts: "bamboo_craft_artisan_ent",
};

/** Full ranking with explanations. */
export function recommendOpportunities(
  profile: LivelihoodProfile,
  courses: Course[],
  limit = 5,
): OpportunityMatch[] {
  return courses
    .map((c) => scoreCourse(profile, c))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Entrepreneurship pathway suggestions (Phase 10) derived from the profile's
 * skills — self-employment ideas whose required skills overlap what the user
 * has; includes honest scheme labels and required tools.
 */
export interface EntrepreneurPath {
  ideaId: string;
  /** i18n key: `biz.<ideaId>` (falls back to role business idea id). */
  roleTitle: string;
  matchedSkills: SkillId[];
  missingSkills: SkillId[];
  tools: string[];
  schemes: string[];
  readinessPercent: number;
}

export function entrepreneurPaths(profile: LivelihoodProfile, limit = 3): EntrepreneurPath[] {
  const out: EntrepreneurPath[] = [];
  for (const role of JOB_ROLES) {
    for (const idea of role.business) {
      const have = new Set(profile.skills);
      const matched = idea.skills.filter((s) => have.has(s));
      const missing = idea.skills.filter((s) => !have.has(s));
      const readiness = Math.round((matched.length / Math.max(1, idea.skills.length)) * 100);
      // Only surface ideas with at least one existing skill or explicit interest.
      if (matched.length === 0 && profile.employment_preference !== "self") continue;
      out.push({
        ideaId: idea.id,
        roleTitle: role.title,
        matchedSkills: matched,
        missingSkills: missing,
        tools: idea.tools,
        schemes: idea.schemes,
        readinessPercent: readiness,
      });
    }
  }
  return out.sort((a, b) => b.readinessPercent - a.readinessPercent).slice(0, limit);
}
