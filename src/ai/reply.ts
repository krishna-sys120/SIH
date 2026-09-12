import type { Course, MatchResult } from "../data/model";
import { parseUtterance, recommendCourses } from "../data/recommend";
import { translateDynamic } from "../i18n/labels";
import type { LangCode } from "../i18n/languages";

export interface AssistantReply {
  text: string;
  matches: MatchResult[];
  intent: "match" | "register" | "courses" | "fallback";
  /** Livelihood detected from the utterance/profile, for reason labels. */
  livelihood?: string;
}

export function generateReply(
  utterance: string,
  lang: LangCode,
  courses: Course[],
  profile?: { work_type?: string; skills?: string; district?: string; state?: string },
): AssistantReply {
  const parse = parseUtterance(utterance);

  if (parse.wantsRegister && !parse.work) {
    return {
      text: translateDynamic("ai.registerHelp", lang),
      matches: [],
      intent: "register",
    };
  }

  const work = parse.work ?? (profile?.work_type as never) ?? null;
  const skills = [...parse.skills, ...(profile?.skills ? [profile.skills] : [])].join(", ");

  if (work || parse.skills.length > 0) {
    const matches = recommendCourses(
      {
        work_type: work ?? undefined,
        skills,
        interest: utterance,
        district: profile?.district,
        state: profile?.state,
        education: "secondary",
      },
      courses,
      3,
    ).filter((m) => m.score >= 25);

    if (matches.length > 0) {
      const top = matches[0];
      const intro = translateDynamic("reason.summary", lang, {
        liv: translateDynamic(`liv.${work}`, lang),
      });
      const lines = matches.map(
        (m, i) =>
          `${i + 1}. ${m.course.name} — ${translateDynamic("courses.level", lang)} ${m.course.nsqf_level}, ${m.course.duration_months} ${translateDynamic("courses.months", lang)}`,
      );
      const text = `${intro}\n${lines.join("\n")}\n\n${translateDynamic("ai.askMore", lang)}`;
      void top;
      return { text, matches, intent: "match", livelihood: work ?? undefined };
    }
  }

  if (parse.wantsCourses) {
    const list = courses
      .slice(0, 3)
      .map(
        (c) =>
          `• ${c.name} (${translateDynamic(`sec.${c.sector}`, lang)}, ${translateDynamic("courses.level", lang)} ${c.nsqf_level})`,
      )
      .join("\n");
    return {
      text: `${translateDynamic("assistant.subtitle", lang)}\n${list}`,
      matches: [],
      intent: "courses",
    };
  }

  return { text: translateDynamic("ai.fallback", lang), matches: [], intent: "fallback" };
}
