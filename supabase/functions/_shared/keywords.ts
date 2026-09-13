/**
 * Inbound keyword classification (SMS/WhatsApp) — pure, unit-testable.
 * STOP-style keywords beat everything else per Twilio/WhatsApp convention.
 */
export const OPT_OUT_WORDS = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit"] as const;
export const OPT_IN_WORDS = ["start", "unstop", "yes"] as const;
export const HELP_WORDS = ["help", "info"] as const;

export type KeywordKind = "optout" | "optin" | "help";

/** Classify an inbound message body. Returns null for non-keyword text. */
export function classifyKeyword(raw: string): KeywordKind | null {
  const lower = raw.trim().toLowerCase();
  if (!lower) return null;
  if (OPT_OUT_WORDS.some((w) => lower === w || lower.startsWith(w + " "))) return "optout";
  if (OPT_IN_WORDS.some((w) => lower === w)) return "optin";
  if (HELP_WORDS.some((w) => lower === w)) return "help";
  return null;
}

/** Script-range language detection for auto-replies (en fallback). */
export function detectLang(text: string): string {
  if (/[\u0900-\u097F]/.test(text)) return "hi"; // Devanagari (Hindi/Marathi)
  if (/[\u0980-\u09FF]/.test(text)) return "bn";
  if (/[\u0B80-\u0BFF]/.test(text)) return "ta";
  if (/[\u0C00-\u0C7F]/.test(text)) return "te";
  if (/[\u0C80-\u0CFF]/.test(text)) return "kn";
  return "en";
}

const REPLIES: Record<string, Record<KeywordKind, string>> = {
  en: {
    optout: "You have been unsubscribed and will receive no further messages. Reply START to resubscribe.",
    optin: "You are subscribed again. Thank you!",
    help: "SkillSetu assistant: reply STOP to unsubscribe, START to resubscribe.",
  },
  hi: {
    optout: "आप अनसब्सक्राइब हो गए हैं। दोबारा जुड़ने के लिए START भेजें।",
    optin: "आप फिर से जुड़ गए हैं। धन्यवाद!",
    help: "स्किलसेतु सहायक: अनसब्सक्राइब के लिए STOP भेजें, दोबारा जुड़ने के लिए START भेजें।",
  },
};

/** Localized reply for a keyword (en fallback). */
export function keywordReply(kind: KeywordKind, lang: string): string {
  const table = REPLIES[lang] ?? REPLIES.en;
  return table[kind];
}
