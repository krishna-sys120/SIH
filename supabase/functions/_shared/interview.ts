/**
 * Adaptive interview engine (Phase 4) — pure state machine.
 *
 * Decides the NEXT question from what the profile already knows, asks each
 * question at most once, skips what's answered, and stops once the profile is
 * sufficient (never interrogate beneficiaries — stop once enough info exists).
 *
 * Pure TypeScript: runs in the browser (with TTS), in edge functions, and in
 * vitest. All question/response texts are i18n keys — the UI layer renders
 * them via tl()/translateDynamic in the beneficiary's language.
 */
import type { LivelihoodProfile } from "./extract";
import { emptyProfile, mergeUtterance, detectWork } from "./extract";

export interface QuestionDef {
  id: string;
  /** i18n key for the question text: `q.<id>` */
  key: string;
  /** Follow-up spoken when the answer yields a rich extraction (adaptive probe). */
  followUpKey?: string;
}

/** Ordered interview plan; asked only when the field is still unknown. */
export const QUESTIONS: QuestionDef[] = [
  { id: "work", key: "q.work", followUpKey: "q.work.followup" },
  { id: "experience", key: "q.experience" },
  { id: "skills_more", key: "q.skills_more" },
  { id: "education", key: "q.education" },
  { id: "district", key: "q.district" },
  { id: "preference", key: "q.preference" },
  { id: "mobility", key: "q.mobility" },
  { id: "physical", key: "q.physical" },
  { id: "tools", key: "q.tools" },
];

/** Minimum profile completeness before the interview may end early. */
const SUFFICIENT = {
  mustHave: ["current_occupation", "skills>0", "experience_years", "district"] as const,
};

export type InterviewPhase = "interview" | "ready";

export interface InterviewTurn {
  profile: LivelihoodProfile;
  /** i18n keys of questions to render (first is the active question). */
  asked: string[];
  /**
   * Accumulated question IDS already asked — the engine-owned interview
   * state. Pass this back into the next interviewTurn() call so each
   * question is asked at most once, even when an answer fails to extract.
   */
  askedIds: string[];
  /** i18n keys of adaptive follow-ups triggered by the last answer. */
  followUps: string[];
  phase: InterviewPhase;
  /** Set when the interview becomes ready — quick summary for confirmation. */
  complete: boolean;
  /** Human explanation of what was understood (i18n keys for chips). */
  understood: {
    work?: string;
    skillsCount: number;
    experienceYears?: number;
    education?: string;
  };
}

/** Interview completeness 0..1 — drives the progress indicator. */
export function profileCompleteness(p: LivelihoodProfile): number {
  let n = 0;
  const total = 7;
  if (p.current_occupation !== undefined) n++;
  if (p.skills.length > 0) n++;
  if (p.experience_years !== null) n++;
  if (p.location_district) n++;
  if (p.employment_preference !== "either") n++;
  if (p.education !== "secondary" || p._eduAsked) n++;
  if (p.mobility_constraints.can_travel_far !== null) n++;
  return Math.min(1, n / total);
}

/** True when the interview has collected everything the engine needs. */
export function isSufficient(p: LivelihoodProfile): boolean {
  if (p.current_occupation === undefined) return false;
  if (p.skills.length === 0) return false;
  if (p.location_district === undefined && !p.location_state) return false;
  return true;
}

/**
 * Process one user answer: merge extractions, then decide the next question.
 * `askedIds` is caller-owned interview state (which question ids were asked).
 */
export function interviewTurn(
  prev: LivelihoodProfile,
  utterance: string,
  askedIds: string[],
): InterviewTurn {
  let profile = mergeUtterance(prev, utterance);

  // If the answer named an occupation, traditional occupation may be inferable
  // from an earlier mention — keep first as current, second mention as traditional.
  const followUps: string[] = [];
  const work = detectWork(utterance);
  if (work.work && profile.current_occupation === work.work && profile.experience_years === null) {
    followUps.push("q.experience");
  }

  const askedSet = new Set(askedIds);
  // Mark implicit asks done when extraction answered them.
  if (profile.current_occupation !== undefined) askedSet.add("work");
  if (profile.experience_years !== null) askedSet.add("experience");
  if (profile.skills.length >= 2) askedSet.add("skills_more");
  if (profile.education !== "secondary") askedSet.add("education");
  if (profile.employment_preference !== "either") askedSet.add("preference");
  if (profile.mobility_constraints.can_travel_far !== null) askedSet.add("mobility");
  if (profile.location_district !== undefined) askedSet.add("district");

  // Pick next unasked question.
  let nextKey: string | null = null;
  for (const q of QUESTIONS) {
    if (!askedSet.has(q.id)) {
      nextKey = q.key;
      askedSet.add(q.id);
      break;
    }
  }

  const phase: InterviewPhase = isSufficient(profile) && askedSet.size >= QUESTIONS.length - 4 ? "ready" : "interview";
  // If nothing left to ask, the interview is complete regardless.
  const complete = nextKey === null || isSufficient(profile);

  return {
    profile,
    asked: nextKey ? [nextKey] : [],
    /** Engine-owned accumulated state — pass back into the next turn. */
    askedIds: [...askedSet],
    followUps,
    phase: complete ? "ready" : phase,
    complete,
    understood: {
      work: profile.current_occupation,
      skillsCount: profile.skills.length,
      experienceYears: profile.experience_years ?? undefined,
      education: profile.education,
    },
  };
}

/** Kick off an interview: empty profile, first question queued. */
export function startInterview(lang: string): InterviewTurn {
  const p = emptyProfile(lang);
  return {
    profile: p,
    asked: ["q.work"],
    /** The first question (work) is asked immediately at start. */
    askedIds: ["work"],
    followUps: [],
    phase: "interview",
    complete: false,
    understood: { skillsCount: 0 },
  };
}

/** Convenience for edge/IVR: build a profile from a list of utterances. */
export function interviewFromUtterances(lang: string, utterances: string[]): LivelihoodProfile {
  let p = emptyProfile(lang);
  for (const u of utterances) p = mergeUtterance(p, u);
  return p;
}
