/**
 * Skill-gap engine (Phase 8) — computes matched/missing skills and a match %
 * between the beneficiary's extracted skills and a job role's required
 * competencies (NOS-style, from the prototype taxonomy). All output is
 * structured data — the UI renders it; nothing is hardcoded prose.
 *
 * Pure TS — browser, vitest, and Deno safe.
 */
import { roleById, JOB_ROLES, type JobRole, type SkillId } from "./taxonomy";
import type { LivelihoodProfile } from "./extract";

export interface SkillGap {
  roleId: string;
  roleTitle: string;
  /** 0-100: share of required competencies the user already has. */
  matchPercent: number;
  matchedSkills: SkillId[];
  missingSkills: SkillId[];
  /** Weighted by role-importance ordering (first competencies weigh more). */
  weightedMatch: number;
  /** True when physical constraints conflict with the role's demands. */
  constraintConflict: boolean;
}

export function computeSkillGap(profile: LivelihoodProfile, role: JobRole): SkillGap {
  const have = new Set(profile.skills);
  const matched: SkillId[] = [];
  const missing: SkillId[] = [];
  role.competencies.forEach((c, i) => {
    if (have.has(c)) matched.push(c);
    else missing.push(c);
    void i;
  });

  // Weighted: earlier competencies in the role definition are more central.
  const weights = role.competencies.map((_, i) => Math.max(1, role.competencies.length - i));
  let weightedHave = 0;
  let weightedTotal = 0;
  role.competencies.forEach((c, i) => {
    weightedTotal += weights[i];
    if (have.has(c)) weightedHave += weights[i];
  });

  const conflicts: boolean =
    (profile.physical_constraints.avoid_heavy_lifting === true &&
      role.physical_demands.includes("heavy_lifting")) ||
    (profile.physical_constraints.avoid_outdoor === true && role.physical_demands.includes("outdoor"));

  return {
    roleId: role.id,
    roleTitle: role.title,
    matchPercent: role.competencies.length
      ? Math.round((matched.length / role.competencies.length) * 100)
      : 0,
    matchedSkills: matched,
    missingSkills: missing,
    weightedMatch: weightedTotal ? Math.round((weightedHave / weightedTotal) * 100) : 0,
    constraintConflict: conflicts,
  };
}

/** Rank all prototype roles for a profile, best match first. */
export function rankRoles(profile: LivelihoodProfile, limit = 3): SkillGap[] {
  return JOB_ROLES.map((r) => computeSkillGap(profile, r))
    .sort((a, b) => b.weightedMatch - a.weightedMatch)
    .slice(0, limit);
}

export function gapForRole(profile: LivelihoodProfile, roleId: string): SkillGap | null {
  const role = roleById(roleId);
  return role ? computeSkillGap(profile, role) : null;
}

/**
 * Expected outcome copy pieces (structured, i18n-keyed by the UI):
 * e.g. training for missing skills leads to `expectedOutcome` readiness.
 */
export function expectedOutcome(gap: SkillGap): {
  beforePercent: number;
  afterPercent: number;
  trainableMissing: SkillId[];
} {
  return {
    beforePercent: gap.matchPercent,
    afterPercent: gap.missingSkills.length === 0 ? gap.matchPercent : 100,
    trainableMissing: gap.missingSkills,
  };
}
