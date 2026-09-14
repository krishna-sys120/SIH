/**
 * Semantic extraction layer (Phase 6) — deterministic hybrid NLU.
 *
 * Converts free spoken/typed text (any of the 7 UI languages) into structured
 * profile fields. This is the DETERMINISTIC fallback half of the hybrid AI:
 * when an LLM key is configured it can refine these results, but the app must
 * never break without one — so this layer is always present and unit-tested.
 *
 * Pure TypeScript — no DOM/Deno globals; runs in Vite, vitest, and Deno.
 */
import type { LivelihoodId, EducationLevel } from "../../../src/data/model";
import { SKILL_HINTS, type SkillId } from "./taxonomy";

/** The full structured livelihood profile produced by the interview. */
export interface LivelihoodProfile {
  education: EducationLevel;
  age?: number;
  location_district?: string;
  location_state?: string;
  traditional_occupation?: LivelihoodId;
  current_occupation?: LivelihoodId;
  skills: SkillId[];
  /** Raw spoken skill fragments kept for display/trust ("your words"). */
  skill_quotes: string[];
  interests: string[];
  /** Years of work experience (parsed from "3 years", "३ साल", etc.). */
  experience_years: number | null;
  mobility_constraints: {
    can_travel_far: boolean | null;
    can_relocate: boolean | null;
    /** Preferred maximum travel distance in km (roughly parsed). */
    max_travel_km: number | null;
  };
  physical_constraints: {
    avoid_heavy_lifting: boolean | null;
    avoid_outdoor: boolean | null;
    prefer_sitting: boolean | null;
  };
  employment_preference: "wage" | "self" | "either";
  self_employment_interest: boolean | null;
  income_monthly_estimate?: number;
  tools_available: string[];
  training_interest: boolean | null;
  /** Language the beneficiary is conversing in (BCP-ish code, e.g. "kn"). */
  language: string;
  /** Interview bookkeeping: whether each explicit question was already asked. */
  _eduAsked?: boolean;
  _prefAsked?: boolean;
  _mobAsked?: boolean;
  _physAsked?: boolean;
  _toolsAsked?: boolean;
}

export function emptyProfile(lang: string): LivelihoodProfile {
  return {
    education: "secondary",
    skills: [],
    skill_quotes: [],
    interests: [],
    experience_years: null,
    mobility_constraints: { can_travel_far: null, can_relocate: null, max_travel_km: null },
    physical_constraints: { avoid_heavy_lifting: null, avoid_outdoor: null, prefer_sitting: null },
    employment_preference: "either",
    self_employment_interest: null,
    tools_available: [],
    training_interest: null,
    language: lang,
  };
}

// ── Primitive parsers ─────────────────────────────────────────

/** Devanagari + Kannada + Tamil/Telugu/Bengali digit normalization. */
/** Devanagari + Kannada + Tamil/Telugu/Bengali digit normalization. */
const DIGIT_RANGES: Array<[number, number]> = [
  [0x0966, 0x096f], // Devanagari
  [0x0ce6, 0x0cef], // Kannada
  [0x09e6, 0x09ef], // Bengali
  [0x0be6, 0x0bef], // Tamil
  [0x0c66, 0x0c6f], // Telugu
];

export function normalizeDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    let replaced = false;
    for (const [lo, hi] of DIGIT_RANGES) {
      if (code >= lo && code <= hi) {
        out += String(code - lo);
        replaced = true;
        break;
      }
    }
    if (!replaced) out += ch;
  }
  return out;
}

const YEAR_WORDS =
  /(year|yr|saal|saal|साल|वर्ष|बर्ष|সাল|வருட|ஆண்டு|సంవత్సర|वर्षं|वर्षे|ವರ್ಷ|सालं|শত)/i;

/** Parse "3 years experience", "३ वर्ष", "moorku 2 varsha" etc. → years. */
export function parseExperienceYears(text: string): number | null {
  const t = normalizeDigits(text.toLowerCase());
  const m = t.match(/(\d{1,2})\s*(?:\+)?\s*(?:years?|yrs?|saal|साल|वर्ष|वर्षे|ವರ್ಷ|ವರ್ಷಗಳ|सालं|বছর|வருட|ஆண்டு|సంవత్సర)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 45) return n;
  }
  // "saal ka experience" style without digit nearby handled by generic digit+word scan
  if (YEAR_WORDS.test(t)) {
    const d = t.match(/(\d{1,2})/);
    if (d) {
      const n = parseInt(d[1], 10);
      if (n >= 1 && n <= 45) return n;
    }
  }
  return null;
}

const EDU_MARKERS: Array<[EducationLevel, RegExp]> = [
  ["none", /(no school|never went|नहीं पढ़|पढ़ाई नहीं|शाळा नाही|ಶಾಲೆ ಇಲ್ಲ|ಓದಿಲ್ಲ|படிக்கவில்லை|చదువు లేదు|না পড়|padhle|nai padh)/i],
  ["primary", /(primary|class [1-5]\b|ಪ್ರಾಥಮಿಕ|प्राथमिक|पाचवी|प्राथमिक|தொடக்க|ప్రాథమిక|প্রাথমিক)/i],
  ["secondary", /(secondary|class\s*(?:[6-9]|10)\b|\b10th\b|up to 10|sslc|metric|matric|high school|ಹೈಸ್ಕೂಲ್|10 ನೇ|10वीं|10 वी|धड़ा दहावी|பத்தாம்|పది నుండి|মাধ্যমিক|दहावी)/i],
  ["senior", /(12th|class\s*12\b|intermediate|pu\b|puc|pre-university|diploma|ಪಿಯು|12 ನೇ|12वीं|12 वी|बारावी|பன்னிரண்டு|ইন্টারমিডিয়েট|द्वादश)/i],
  ["graduate", /(graduate|degree|b\.?a\b|b\.?com|b\.?sc|btech|b\.?tech|ಪದವಿ|स्नातक|ग्रॅज्युएट|பட்டப்படிப்பு|గ్రాడ్యుయేట|গ্র্যাজুয়েট)/i],
];

export function parseEducation(text: string): EducationLevel | null {
  for (const [level, re] of EDU_MARKERS) if (re.test(text)) return level;
  return null;
}

const YES = /(yes|haan|ha|हाँ|हां|हो|आहे|ಹೌದು|avunu|అవును|సరే|ஆம்|হ্যাঁ|होय|sure|ok|okay|yes sir)/i;
const NO = /(no|nahi|nahin|नहीं|नाही|ಇಲ್ಲ|ಅಲ್ಲ|ledhu|లేదు|இல்லை|না|नाहीं|not possible|can'?t)/i;

export function parseYesNo(text: string): boolean | null {
  const yes = YES.test(text);
  const no = NO.test(text);
  if (yes && !no) return true;
  if (no && !yes) return false;
  return null;
}

/** Rough distance parse: "10 km", "पाच किमी", "5 kms". */
export function parseMaxTravelKm(text: string): number | null {
  const t = normalizeDigits(text.toLowerCase());
  const m = t.match(/(\d{1,3})\s*(?:kms?|kilometers?|km|किमी|ಕಿಮೀ|కిమీ)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 500) return n;
  }
  return null;
}

/** Monthly income estimate parse ("5000 per month", "₹8000", "महीने के 6000"). */
export function parseMonthlyIncome(text: string): number | null {
  const t = normalizeDigits(text.toLowerCase());
  if (!/month|महीन|महिना|मासिक|నెలకు|ತಿಂಗಳಿಗೆ|महिन्याला|மாதம்|₹|rupee|rs\.?\b/.test(t)) return null;
  const m = t.match(/(\d{3,6})/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 500 && n <= 500000) return n;
  }
  return null;
}

// ── Skill + livelihood classification ─────────────────────────

export function detectSkills(text: string): SkillId[] {
  const lower = text.toLowerCase();
  const hits: SkillId[] = [];
  for (const h of SKILL_HINTS) {
    if (h.words.some((w) => lower.includes(w)) && !hits.includes(h.id)) hits.push(h.id);
  }
  return hits;
}

const WORK_HINTS: Array<{ id: LivelihoodId; words: string[] }> = [
  { id: "farmer", words: ["farmer", "farm", "kheti", "खेती", "खेत", "कृषि", "விவசாய", "వ్యవసాయ", "ಕೃಷಿ", "ಬೇಸಾಯ", "ರೈತ", "शेती", "কৃষক"] },
  { id: "agri-labour", words: ["agri labour", "farm labour", "majdoor", "मजदूर", "मजूर", "ಕೂಲಿ", "கூலி", "कामगार"] },
  { id: "handloom-weaver", words: ["weave", "weaver", "handloom", "बुनकर", "करघा", "நெசவு", "నేత", "ನೇಯ್ಗೆ", "ನೇಕಾರ"] },
  { id: "tailor", words: ["tailor", "stitch", "silai", "दर्जी", "सिलाई", "தையல்", "కుట్టు", "ದರ್ಜಿ", "ಹೊಲಿಗೆ", "शिवणकाम"] },
  { id: "artisan", words: ["artisan", "craft", "karigar", "कारीगर", "கைவினை", "ಕುಶಲಕರ್ಮಿ", "bamboo", "बांस", "ಬುಟ್ಟಿ"] },
  { id: "leather-worker", words: ["leather", "चर्म", "தோல்", "ಚರ್ಮ", "चामड़"] },
  { id: "construction-labour", words: ["construction", "mason", "labour", "मिस्त्री", "निर्माण", "கட்டுமான", "ನಿರ್ಮಾಣ", "ಕಟ್ಟಡ", "बांधकाम"] },
  { id: "domestic-worker", words: ["domestic", "house work", "ghar ka", "घरेलू", "गृहकार्य", "வீட்டு பணி", "ಮನೆ ಕೆಲಸ"] },
  { id: "street-vendor", words: ["vendor", "thela", "reedi", "ठेला", "தெரு வணிக", "ಪೇಟೆ", "hawker", "फेरी"] },
  { id: "beautician", words: ["beauty", "salon", "ब्यूटी", "सलून", "அழகு", "ಸೌಂದರ್ಯ", "ಬ್ಯೂಟಿ"] },
  { id: "mechanic", words: ["mechanic", "repair", "मैकेनिक", "मरम्मत", "பழுது", "ದುರಸ್ತಿ", "मेकॅनिक", "दुरुस्ती"] },
  { id: "electrician", words: ["electric", "bijli", "विद्युत", "बिजली", "மின்", "ವಿದ್ಯುತ್", "ಕರೆಂಟ್"] },
  { id: "fisher", words: ["fish", "मछुआरा", "மீன்", "ಮೀನು", "জেলে"] },
  { id: "dairy", words: ["dairy", "milk", "दुग्ध", "दूध", "பால்", "ಹಾಲು", "डेयरी"] },
  { id: "waste-picker", words: ["waste", "scrap", "kachra", "कचरा", "குப்பை", "ತ್ಯಾಜ್ಯ", "ಕಸ"] },
  { id: "student", words: ["student", "studying", "छात्र", "மாணவ", "ವಿದ್ಯಾರ್ಥಿ", "ओद"] },
  { id: "homemaker", words: ["homemaker", "housewife", "गृहिणी", "இல்லத்தரசி", "ಗೃಹಿಣಿ"] },
  { id: "unemployed", words: ["unemployed", "no work", "बेरोजगार", "berozgar", "வேலையில்லை", "ನಿರುದ್ಯೋಗಿ", "केलस नाही"] },
];

/** Weighted livelihood classifier: exact word matches beat substring matches. */
export function detectWork(text: string): { work: LivelihoodId | null; score: number } {
  const lower = text.toLowerCase();
  let best: { id: LivelihoodId; score: number } | null = null;
  for (const h of WORK_HINTS) {
    let s = 0;
    for (const w of h.words) {
      if (lower.includes(w)) s += w.includes(" ") || w.length >= 6 ? 2 : 1;
    }
    if (s > 0 && (!best || s > best.score)) best = { id: h.id, score: s };
  }
  return best ? { work: best.id, score: best.score } : { work: null, score: 0 };
}

/**
 * District/state detection for the seed dataset's coverage area (plus common
 * Indian states). Extend DISTRICT_NAMES when the course catalog grows.
 */
const DISTRICT_NAMES = ["nagpur", "gadchiroli", "hyderabad", "guntur", "warangal", "nanded", "amravati"];
const STATE_NAMES = [
  "maharashtra", "telangana", "andhra pradesh", "karnataka", "tamil nadu",
  "kerala", "madhya pradesh", "chhattisgarh", "odisha", "gujarat", "rajasthan",
  "uttar pradesh", "bihar", "jharkhand", "west bengal",
];

export function detectLocation(text: string): { district?: string; state?: string } {
  const lower = text.toLowerCase();
  const out: { district?: string; state?: string } = {};
  for (const d of DISTRICT_NAMES) {
    if (lower.includes(d)) {
      out.district = d.replace(/\b\w/, (c) => c.toUpperCase());
      break;
    }
  }
  for (const s of STATE_NAMES) {
    if (lower.includes(s)) {
      out.state = s.replace(/\b\w/, (c) => c.toUpperCase());
      break;
    }
  }
  return out;
}

export function detectIntent(text: string): { enroll: boolean; courses: boolean; help: boolean } {
  const lower = text.toLowerCase();
  return {
    enroll: /(enroll|enrol|join|register|admission|प्रवेश|नामांकन|नोंदणी|ಸೇರಬೇಕು|ನೋಂದಣಿ|சேர|पंजीकरण|নিবন্ধন|joining)/i.test(lower),
    courses: /(course|training|skilling|प्रशिक्षण|कोर्स|कौशल|ತರಬೇತಿ|ಕೋರ್ಸ್|பயிற்சி|శిక्षణ|কোর্স|learn|सीख)/i.test(lower),
    help: /(help|मदद|ಸಹಾಯ|साहाय्य|உதவি|সাহায্য)/i.test(lower),
  };
}

/** Merge an utterance's extractions into the running profile (immutably). */
export function mergeUtterance(p: LivelihoodProfile, text: string): LivelihoodProfile {
  const t = text.trim();
  if (!t) return p;
  const lower = t.toLowerCase();

  const next: LivelihoodProfile = { ...p,
    skills: [...p.skills],
    skill_quotes: [...p.skill_quotes],
    interests: [...p.interests],
    tools_available: [...p.tools_available],
    mobility_constraints: { ...p.mobility_constraints },
    physical_constraints: { ...p.physical_constraints },
  };

  const work = detectWork(t);
  if (work.work && work.score >= 2) {
    if (p.current_occupation === undefined) next.current_occupation = work.work;
    else if (p.traditional_occupation === undefined && work.work !== p.current_occupation) {
      next.traditional_occupation = work.work;
    }
  }

  const skills = detectSkills(t);
  for (const s of skills) if (!next.skills.includes(s)) next.skills.push(s);
  if (skills.length > 0 && next.skill_quotes.length < 6) next.skill_quotes.push(t.slice(0, 120));

  const edu = parseEducation(t);
  if (edu) next.education = edu;

  const yrs = parseExperienceYears(t);
  if (yrs !== null) next.experience_years = yrs;

  const income = parseMonthlyIncome(t);
  if (income !== null) next.income_monthly_estimate = income;

  const km = parseMaxTravelKm(t);
  if (km !== null) next.mobility_constraints.max_travel_km = km;

  // Free-form district/state detection ("I am from Nagpur", "ನಾನು ನಾಗಪುರದಲ್ಲಿ").
  const loc = detectLocation(t);
  if (loc.district) next.location_district = loc.district;
  if (loc.state) next.location_state = loc.state;

  // Mobility / physical constraints via polarity detection on theme words.
  const canTravel = parseYesNo(t);
  if (canTravel !== null) {
    if (/(relocat|shift city|dusre shehar|बाहर|ಹೊರಗೆ|move out)/i.test(lower)) {
      next.mobility_constraints.can_relocate = canTravel;
    } else if (/(travel|door|durr|दूर|ದೂರ|தூர)/i.test(lower)) {
      next.mobility_constraints.can_travel_far = canTravel;
    }
  }
  if (/(heavy|weight|भारी|वजन|ಭಾರ|கனம)/i.test(lower) && canTravel !== null) {
    next.physical_constraints.avoid_heavy_lifting = !canTravel;
  }
  if (/(sit|बैठ|ಕುಳಿತ)/i.test(lower) && canTravel !== null) {
    next.physical_constraints.prefer_sitting = canTravel;
  }

  // Employment preference.
  if (/(self|business|apna|अपना|व्यवसाय|उद्योग|ಸ್ವಂತ|ವ್ಯಾಪಾರ|சொந்த|వ్యాపార|उद्यम|enterprise|shop own|my own)/i.test(lower)) {
    next.employment_preference = "self";
    next.self_employment_interest = true;
  } else if (/(job|naukri|नौकरी|नोकरी|wage|काम मिल|ಉದ್ಯೋಗ|வேலை|ఉద్యోగం|employ)/i.test(lower) && canTravel !== null) {
    next.employment_preference = "wage";
    next.self_employment_interest = false;
  } else if (/(job|naukri|नौकरी|नोकरी|wage|ಉದ್ಯೋಗ|வேலை|ఉద్యోగం)/i.test(lower)) {
    if (next.employment_preference === "either") next.employment_preference = "wage";
  }

  // Tools / resources mentioned.
  const toolMatch = t.match(/(?:have|has|पास|ಹತ್ರ|उपलब्ध|available)\s+([a-z\u0900-\u0DFF ]{3,40})/i);
  if (toolMatch) {
    const tool = toolMatch[1].trim().slice(0, 60);
    if (tool && !next.tools_available.includes(tool)) next.tools_available.push(tool);
  }

  // Training interest.
  if (/(learn|सीख|कलिय|கற்க|నేర్చుಕೋ|ಕಲಿಯ|तरबेति|प्रशिक्षण|ತರಬೇತಿ)/i.test(lower) && canTravel !== null) {
    next.training_interest = canTravel;
  }

  return next;
}
