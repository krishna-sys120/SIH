import type { LangCode } from "./languages";
import type { Entry } from "./labels.livelihoods";
import { LIVELIHOODS } from "./labels.livelihoods";
import { SECTOR_LABELS, EDU_LABELS } from "./labels.misc";
import { REASONS, AI_PHRASES } from "./labels.ai";
import { SKILL_LABELS, QUESTION_LABELS, REASON_V2, BUSINESS_LABELS, NSQF_NOTICES } from "./labels.core";
import { STRINGS } from "./strings";

export type { Entry };

function withPrefix(
  map: Record<string, Entry>,
  prefix: string,
): Record<string, Record<LangCode, string>> {
  const out: Record<string, Record<LangCode, string>> = {};
  for (const [id, entry] of Object.entries(map)) {
    out[`${prefix}${id}`] = entry as Record<LangCode, string>;
  }
  return out;
}

/** All dynamic labels, keyed by their canonical prefixed key ("liv.x", "sec.x", …). */
export const DYNAMIC: Record<string, Record<LangCode, string>> = {
  ...withPrefix(LIVELIHOODS, "liv."),
  ...withPrefix(SECTOR_LABELS, "sec."),
  ...(EDU_LABELS as Record<string, Record<LangCode, string>>),
  ...(REASONS as Record<string, Record<LangCode, string>>),
  ...(AI_PHRASES as Record<string, Record<LangCode, string>>),
  ...(SKILL_LABELS as Record<string, Record<LangCode, string>>),
  ...(QUESTION_LABELS as Record<string, Record<LangCode, string>>),
  ...(REASON_V2 as Record<string, Record<LangCode, string>>),
  ...(BUSINESS_LABELS as Record<string, Record<LangCode, string>>),
  ...(NSQF_NOTICES as Record<string, Record<LangCode, string>>),
};

/**
 * Translate a dynamic label like "liv.farmer", "sec.textiles" or "reason.sector"
 * with {placeholders} filled from vars. Falls back to the UI dictionary (STRINGS)
 * and finally to a humanized key.
 */
export function translateDynamic(
  key: string,
  lang: LangCode,
  vars?: Record<string, string | number>,
): string {
  const entry = DYNAMIC[key];
  let out: string;
  if (entry) {
    out = entry[lang] ?? entry.en;
  } else {
    const s = STRINGS[key as keyof typeof STRINGS] as Record<string, string> | undefined;
    out = s?.[lang] ?? s?.en ?? key.replace(/^\w+\./, "").replace(/[-_]/g, " ");
  }
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, String(v));
    }
  }
  return out;
}
