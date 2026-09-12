import type { Beneficiary, Course, MatchResult, LivelihoodId, EducationLevel } from "./model";
import { sectorsForLivelihood, educationCeiling } from "./model";

/**
 * Rule-based "AI" matching engine.
 * Scores each course 0-100 against a beneficiary profile and explains itself
 * with human-readable reasons (rendered in the active language).
 */
export function recommendCourses(
  b: Partial<Beneficiary>,
  courses: Course[],
  limit = 4,
): MatchResult[] {
  const work = (b.work_type ?? "unemployed") as LivelihoodId;
  const livSectors = sectorsForLivelihood(work);
  const ceiling = educationCeiling((b.education ?? "secondary") as EducationLevel);
  const skillTokens = tokenize(`${b.skills ?? ""} ${b.interest ?? ""}`);
  const district = (b.district ?? "").toLowerCase().trim();
  const state = (b.state ?? "").toLowerCase().trim();

  const results: MatchResult[] = courses.map((course) => {
    const reasons: string[] = [];
    let score = 0;

    // 1. Sector overlap with livelihood (strongest signal)
    const sectorHit = livSectors.includes(course.sector);
    if (sectorHit) {
      score += 40;
      reasons.push(`reason.sector`);
    }

    // 2. NSQF level vs education
    if (course.nsqf_level <= ceiling) {
      score += 15;
      reasons.push("reason.level");
    } else {
      score -= 25; // realistically not eligible
    }

    // 3. Skill / interest keyword overlap
    const kw = [...course.keywords, course.name.toLowerCase()];
    const skillHits = skillTokens.filter((s) =>
      kw.some((k) => k.includes(s) || s.includes(k)),
    );
    if (skillHits.length > 0) {
      score += Math.min(20, 10 * skillHits.length);
      reasons.push("reason.skill");
    }

    // 4. Location proximity
    if (district && course.district.toLowerCase() === district) {
      score += 15;
      reasons.push("reason.nearby");
    } else if (state && course.state.toLowerCase() === state) {
      score += 8;
      reasons.push("reason.state");
    }

    // 5. Free with stipend
    if (course.stipend_monthly > 0) {
      score += 5;
      reasons.push("reason.free");
    }

    // 6. Seats availability (tiny nudge)
    if (course.seats_left > 0) score += 3;

    if (reasons.length === 0) reasons.push("reason.fallback");

    return {
      course,
      score: Math.max(0, Math.min(100, Math.round(score))),
      reasons: dedupe(reasons).slice(0, 4),
      livelihood: work,
    };
  });

  return results.sort((a, b2) => b2.score - a.score).slice(0, limit);
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[,;/\n]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3);
}

/**
 * Parse a free-text utterance (typed or voice) into a partial profile.
 * This is the "NLU" layer: livelihood detection via bilingual keyword lists.
 */
const WORK_HINTS: Array<{ id: LivelihoodId; words: string[] }> = [
  { id: "farmer", words: ["farm", "kheti", "खेती", "खेत", "कृषि", "চাষ", "விவசாய", "వ్యవసాయ", "शेती", "ಕೃಷಿ", "ಬೇಸಾಯ", "ರೈತ"] },
  { id: "agri-labour", words: ["labour", "majdoor", "मजदूर", "मजूर", "কৃষি শ্রমিক", "வேளாண் தொழிலாள", "ಕೃಷಿ ಕೂಲಿ", "ಕೂಲಿ"] },
  { id: "handloom-weaver", words: ["weave", "weaver", "handloom", "बुनकर", "करघा", "ताँत", "நெசவு", "నేత", "ನೇಯ್ಗೆ", "ನೇಕಾರ"] },
  { id: "tailor", words: ["tailor", "stitch", "silai", "दर्जी", "सिलाई", "দর্জি", "தையல்", "కుట్టు", "शिवण", "ದರ್ಜಿ", "ಹೊಲಿಗೆ"] },
  { id: "artisan", words: ["artisan", "craft", "karigar", "कारीगर", "कारागीर", "শিল্পী", "கைவினை", "bamboo", "बांस", "টোকরা", "கூடை", "ಬುಟ್ಟಿ", "ಕುಶಲಕರ್ಮಿ", "ಬೆತ್ತ"] },
  { id: "leather-worker", words: ["leather", "चर्म", "चामड", "চামড়া", "தோல்", "చర్మ", "ಚರ್ಮ"] },
  { id: "construction-labour", words: ["construction", "mason", "मिस्त्री", "राज", "निर्माण", "बांधकाम", "கட்டுமான", "ನಿರ್ಮಾಣ", "ಕಟ್ಟಡ"] },
  { id: "domestic-worker", words: ["domestic", "ghar", "घरेलू", "गृहकार्य", "गृहकর্মী", "வீட்டு பணி", "ಮನೆ ಕೆಲಸ"] },
  { id: "street-vendor", words: ["vendor", "thela", "reedi", "ठेला", "फेरी", "রেড়ি", "தெரு வணிக", "ಪೇಟೆ", "ಅಂಗಡಿ"] },
  { id: "beautician", words: ["beauty", "salon", "ब्यूटी", "सलून", "বিউটি", "அழகு", "బ్యూటీ", "सौंदर्य", "ಸೌಂದರ್ಯ", "ಬ್ಯೂಟಿ"] },
  { id: "mechanic", words: ["mechanic", "repair", "मैकेनिक", "मरम्मत", "मेकॅनिक", "দুরুস্ত", "பழுது", "రిపేర్", "ದುರಸ್ತಿ", "ಮೆಕ್ಯಾನಿಕ್"] },
  { id: "electrician", words: ["electric", "bijli", "विद्युत", "बिजली", "वीज", "மின்", "కరెంట్", "ವಿದ್ಯುತ್", "ಕರೆಂಟ್"] },
  { id: "fisher", words: ["fish", "machh", "मछुआरा", "मासे", "জেলে", "மீன்", "చేప", "ಮೀನು", "ಮೀನುಗಾರ"] },
  { id: "dairy", words: ["dairy", "milk", "दुग्ध", "दूध", "ডেইরি", "பால்", "పాల", "ಹಾಲು", "ಡೈರಿ"] },
  { id: "waste-picker", words: ["waste", "kachra", "कचरा", "गोळा", "আবর্জনা", "குப்பை", "ತ್ಯಾಜ್ಯ", "ಕಸ"] },
  { id: "student", words: ["student", "छात्र", "छात्रा", "ছাত্র", "மாணவ", "విద్యార్థి", "विद्यार्थी", "पढ़", "ವಿದ್ಯಾರ್ಥಿ", "ಓದು"] },
  { id: "homemaker", words: ["homemaker", "grihini", "गृहिणी", "घर संभाल", "இல்லத்தரசி", "గృహిణి", "ಗೃಹಿಣಿ"] },
  { id: "unemployed", words: ["unemployed", "berozgar", "बेरोज़गार", "बेरोजगार", "বেকার", "வேலையில்லை", "నిరుద్యోగ", "ನಿರುದ್ಯೋಗಿ", "ಕೆಲಸವಿಲ್ಲ"] },
];

export interface UtteranceParse {
  work: LivelihoodId | null;
  wantsRegister: boolean;
  wantsCourses: boolean;
  skills: string[];
}

export function parseUtterance(text: string): UtteranceParse {
  const lower = text.toLowerCase();

  let work: LivelihoodId | null = null;
  for (const h of WORK_HINTS) {
    if (h.words.some((w) => lower.includes(w))) {
      work = h.id;
      break;
    }
  }

  const wantsRegister =
    /regist|\u092A\u0902\u091C\u0940\u0915\u0930\u0923|\u0928\u093E\u092E\u093E\u0902\u0915\u0928|\u0928\u094B\u0902\u0926\u0923\u0940|\u09A8\u09BF\u09AC\u09A8\u09CD\u09A7\u09A8|\u0BAA\u0BA4\u0BBF\u0BB5\u0BC1|\u0C28\u0C2E\u0C4B\u0C26\u0C41|enroll|\u0C95\u0CA8\u0CCB\u0C82\u0CA6\u0CA3\u0CBF|\u0CB8\u0CC7\u0CB0\u0CAC\u0CC7\u0C95\u0CC1|\u0CB8\u0CC7\u0CB0\u0CB2\u0CC1|\u0936\u093E\u092E\u093F\u0932/i.test(text);
  const wantsCourses = /course|पाठ्यक्रम|कोर्स|कौशल|प्रशिक्षण|कोर्स|কোর্স|பாடநெறி|பயிற்சி|కోర్సు|ಕೋರ್ಸ್|ತರಬೇತಿ|శిక్షణ|नोंद/i.test(
    text,
  );

  // Extract skill-ish words after "learn/sikh/क्या सीख" patterns
  const skillMatch = lower.match(
    /(?:learn|sikhn|सीख|शिकण|শিখতে|கற்க|నేర్చుಕೋ|ಕಲಿಯ)\s*([a-z\u0900-\u097F\u0980-\u09FF\u0B80-\u0BFF\u0C00-\u0C7F \u0C80-\u0CEF ]{3,40})/,
  );
  const skills = skillMatch ? [skillMatch[1].trim()] : [];

  return { work, wantsRegister, wantsCourses, skills };
}
