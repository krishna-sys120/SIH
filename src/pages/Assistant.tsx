import { useEffect, useMemo, useState } from "react";
import type { Nav } from "../App";
import { useI18n } from "../i18n/context";
import { fetchCourses } from "../data/store";
import { useInterview } from "../voice/useInterview";
import {
  isSpeechSupported,
  isTtsSupported,
  findVoiceFor,
  useVoices,
  speak,
  stopSpeaking,
} from "../voice/speech";
import { LANGUAGES, type LangCode } from "../i18n/languages";
import type { Course } from "../data/model";
import type { LivelihoodProfile } from "../../supabase/functions/_shared/extract";
import { recommendOpportunities, entrepreneurPaths } from "../../supabase/functions/_shared/opportunity";
import { rankRoles } from "../../supabase/functions/_shared/skillgap";
import { SKILLS, JOB_ROLES } from "../../supabase/functions/_shared/taxonomy";
import { useOnline } from "../data/offline";

/**
 * Voice-first adaptive livelihood interview (Phase 4/6/20). One question at a
 * time, large controls, voice + text input, replay + slow speech, and a
 * results panel: structured profile → NSQF roles → skill gaps → explainable
 * recommendations → entrepreneurship pathways.
 */

function skillLabel(id: string): string {
  return SKILLS.find((s) => s.id === id)?.label ?? id;
}

export default function Assistant({ nav }: { nav: Nav }) {
  const { t, tl, lang } = useI18n();
  const online = useOnline();
  const bcp47 = LANGUAGES.find((l) => l.code === lang)!.bcp47;
  const supported = isSpeechSupported();
  const voices = useVoices();
  const ttsMissing = isTtsSupported() && findVoiceFor(voices, bcp47) === null;

  const [courses, setCourses] = useState<Course[]>([]);
  const [speakEnabled, setSpeakEnabled] = useState(true);
  const [slowSpeech, setSlowSpeech] = useState(false);
  const [input, setInput] = useState("");
  const [loadErr, setLoadErr] = useState(false);

  const q = useMemo(
    () => (key: string, vars?: Record<string, string | number>) => tl(key, vars),
    [tl],
  );

  const interview = useInterview(lang, {
    speakEnabled,
    bcp47,
    rate: slowSpeech ? 0.7 : 0.95,
    q,
  });

  useEffect(() => {
    fetchCourses()
      .then(setCourses)
      .catch((e) => {
        console.warn("[assistant] courses load failed", e);
        setLoadErr(true);
      });
    return () => stopSpeaking();
  }, []);

  const profile = interview.profile;
  const done = interview.state === "ready" && profile;

  const ranked = useMemo(() => (profile ? rankRoles(profile, 3) : []), [profile]);
  const matches = useMemo(
    () => (profile && courses.length ? recommendOpportunities(profile, courses, 3) : []),
    [profile, courses],
  );
  const business = useMemo(
    () => (profile ? entrepreneurPaths(profile, 2) : []),
    [profile],
  );

  function replayQuestion() {
    if (interview.activeQuestion) {
      void speak(tl(interview.activeQuestion), bcp47);
    }
  }

  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (interview.state === "idle") interview.start();
    interview.answer(text);
  }

  function startInterview() {
    stopSpeaking();
    interview.start();
  }

  const introText = tl("interview.intro");

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900">
            {t("assistant.title")}
          </h1>
          <p className="mt-1 text-slate-600">{t("assistant.subtitle")}</p>
        </div>
        {/* Voice conversation language — independent of UI language (Phase 5) */}
        <label className="text-sm">
          <span className="block text-xs font-medium text-slate-500 mb-1">
            {t("assistant.voiceLang")}
          </span>
          <select
            value={lang}
            onChange={(e) => nav.go("home")}
            className="sr-only"
            aria-hidden
            tabIndex={-1}
          />
          <span className="inline-flex items-center gap-1 rounded-lg bg-indigoink-50 text-indigoink-700 px-2.5 py-1.5 text-xs font-semibold">
            🗣️ {LANGUAGES.find((l) => l.code === lang)?.native}
          </span>
        </label>
      </div>

      {!online && (
        <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3">
          📴 {t("offline.notice")}
        </div>
      )}
      {loadErr && (
        <div className="mt-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3">
          {t("courses.loadFailed")}{" "}
          <button className="underline" onClick={() => location.reload()}>
            {t("common.retry")}
          </button>
        </div>
      )}
      {!supported && (
        <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3">
          ⚠️ {t("assistant.mic.unsupported")}
        </div>
      )}
      {ttsMissing && (
        <div className="mt-4 rounded-xl bg-sky-50 border border-sky-200 text-sky-900 text-sm px-4 py-3">
          ℹ️ {t("assistant.tts.missingVoice")}
        </div>
      )}

      {/* Progress */}
      {interview.state !== "idle" && (
        <div className="mt-5">
          <div className="flex justify-between text-xs font-medium text-slate-500 mb-1">
            <span>{t("interview.progress")}</span>
            <span>{Math.round(interview.completeness * 100)}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-saffron-400 to-leaf-500 transition-all duration-500"
              style={{ width: `${Math.max(6, interview.completeness * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Start screen — voice-first CTA (Phase 19) */}
      {interview.state === "idle" && (
        <div className="mt-10 text-center">
          <p className="text-slate-600 max-w-md mx-auto">{introText}</p>
          <button
            onClick={startInterview}
            className="mt-6 w-full max-w-sm mx-auto block px-8 py-5 rounded-2xl bg-saffron-500 hover:bg-saffron-600 text-white text-lg font-bold shadow-lg shadow-saffron-500/25 transition-all active:scale-95"
          >
            🎙️ {t("interview.cta")}
          </button>
          <p className="mt-3 text-xs text-slate-400">{t("interview.textFallback")}</p>
        </div>
      )}

      {/* Interview in progress */}
      {interview.state !== "idle" && (
        <div className="mt-6 space-y-3">
          {interview.chat.map((m, i) => (
            <div
              key={i}
              className={`fade-up flex ${m.who === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-base leading-relaxed whitespace-pre-line card-shadow ${
                  m.who === "user"
                    ? "bg-indigoink-600 text-white rounded-br-sm"
                    : "bg-white text-slate-800 rounded-bl-sm border border-slate-100"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
          {interview.partial && (
            <p className="text-sm italic text-slate-500 text-right">“{interview.partial}”</p>
          )}

          {/* Mic + controls (large buttons, low-literacy UX) */}
          {interview.state !== "ready" && (
            <div className="flex flex-col items-center py-4 gap-3">
              <button
                onClick={interview.toggleMic}
                disabled={!supported}
                aria-label={interview.listening ? t("assistant.mic.stop") : t("assistant.mic.start")}
                className={`w-24 h-24 rounded-full grid place-items-center text-white text-3xl transition-all active:scale-95 disabled:opacity-40 ${
                  interview.listening
                    ? "mic-listening bg-gradient-to-br from-rose-500 to-red-600"
                    : "bg-gradient-to-br from-saffron-400 to-saffron-600 hover:brightness-105 card-shadow"
                }`}
              >
                {interview.listening ? "⏹" : "🎙️"}
              </button>
              <div className="flex flex-wrap justify-center gap-2 text-sm">
                <button
                  onClick={replayQuestion}
                  className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                >
                  🔁 {t("interview.replay")}
                </button>
                <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={slowSpeech}
                    onChange={(e) => setSlowSpeech(e.target.checked)}
                    className="w-4 h-4 accent-indigoink-600"
                  />
                  🐢 {t("interview.slow")}
                </label>
              </div>
            </div>
          )}

          {/* Typed fallback — always available (Phase 5) */}
          {interview.state !== "ready" && (
            <form onSubmit={submitTyped} className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("assistant.placeholder")}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-base bg-white focus:outline-none focus:ring-2 focus:ring-indigoink-500"
              />
              <button
                type="submit"
                className="px-5 py-3 rounded-xl bg-indigoink-600 hover:bg-indigoink-700 text-white font-medium text-sm transition-colors active:scale-95"
              >
                {t("assistant.send")}
              </button>
            </form>
          )}
        </div>
      )}

      {/* ═══ Results (Phase 20 — everything explainable) ═══ */}
      {done && profile && (
        <div className="mt-8 space-y-6 fade-up">
          {/* Structured profile */}
          <section className="bg-white rounded-2xl border border-slate-100 card-shadow p-5">
            <h2 className="font-bold text-slate-900 text-lg">📋 {t("result.profile.title")}</h2>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {profile.current_occupation && (
                <Chip label={`${t("result.profile.work")}: ${tl(`liv.${profile.current_occupation}`)}`} />
              )}
              {profile.experience_years !== null && (
                <Chip label={`${t("result.profile.exp")}: ${profile.experience_years} ${t("result.years")}`} />
              )}
              <Chip label={`${t("result.profile.edu")}: ${tl(`edu.${profile.education}`)}`} />
              {profile.location_district && (
                <Chip label={`📍 ${profile.location_district}`} />
              )}
              <Chip
                label={`${t("result.profile.pref")}: ${
                  profile.employment_preference === "self"
                    ? t("result.pref.self")
                    : profile.employment_preference === "wage"
                      ? t("result.pref.wage")
                      : t("result.pref.either")
                }`}
              />
            </div>
            <div className="mt-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {t("result.skills.identified")}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {profile.skills.map((s) => (
                  <span
                    key={s}
                    className="text-xs font-medium bg-leaf-500/10 text-leaf-700 rounded-full px-2.5 py-1"
                  >
                    ✓ {skillLabel(s)}
                  </span>
                ))}
                {profile.skills.length === 0 && (
                  <span className="text-xs text-slate-400">{t("result.skills.none")}</span>
                )}
              </div>
            </div>
          </section>

          {/* NSQF job roles + skill gaps */}
          <section className="bg-white rounded-2xl border border-slate-100 card-shadow p-5">
            <h2 className="font-bold text-slate-900 text-lg">
              🎯 {t("result.roles.title")}
            </h2>
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
              ⚠ {tl("nsqf.prototypeNotice")}
            </p>
            <div className="mt-3 space-y-4">
              {ranked.map((g) => (
                <div key={g.roleId} className="rounded-xl border border-slate-100 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-bold text-slate-900">{g.roleTitle}</h3>
                    <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-indigoink-50 text-indigoink-700">
                      NSQF {roleLevel(g.roleId)} · {t("result.match")}: {g.matchPercent}%
                    </span>
                  </div>
                  <div className="mt-2 grid sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs font-semibold text-leaf-700 uppercase">
                        {t("result.gap.matched")}
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {g.matchedSkills.map((s) => (
                          <li key={s} className="text-leaf-700">✓ {skillLabel(s)}</li>
                        ))}
                        {g.matchedSkills.length === 0 && (
                          <li className="text-slate-400">{t("result.skills.none")}</li>
                        )}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-rose-600 uppercase">
                        {t("result.gap.missing")}
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {g.missingSkills.map((s) => (
                          <li key={s} className="text-slate-600">• {skillLabel(s)}</li>
                        ))}
                        {g.missingSkills.length === 0 && (
                          <li className="text-slate-400">{t("result.gap.nomissing")}</li>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Top recommendations with WHY */}
          <section className="bg-white rounded-2xl border border-slate-100 card-shadow p-5">
            <h2 className="font-bold text-slate-900 text-lg">🏆 {t("result.reco.title")}</h2>
            <div className="mt-3 space-y-3">
              {matches.map((m) => (
                <div key={m.course.id} className="rounded-xl border border-slate-100 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold text-slate-900">{m.course.name}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {tl(`sec.${m.course.sector}`)} · {t("courses.level")}{" "}
                        {m.course.nsqf_level} · 📍 {m.course.district} ·{" "}
                        {m.course.seats_left} {t("courses.seats")}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-bold text-leaf-600 bg-leaf-500/10 rounded-full px-2.5 py-1">
                      {m.score}%
                    </span>
                  </div>
                  <div className="mt-2">
                    <p className="text-xs font-semibold text-slate-500 uppercase">
                      {t("result.why")}
                    </p>
                    <ul className="mt-1 space-y-1 text-sm text-slate-700">
                      {m.reasons.map((r, i) => (
                        <li key={i}>✓ {reasonText(r.id, r.vars, tl)}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
              {matches.length === 0 && (
                <p className="text-sm text-slate-500">{t("result.reco.empty")}</p>
              )}
            </div>
            <button
              onClick={() => nav.go("courses")}
              className="mt-4 w-full py-3 rounded-xl bg-indigoink-600 hover:bg-indigoink-700 text-white font-semibold transition-colors"
            >
              {t("result.reco.browse")} →
            </button>
          </section>

          {/* Entrepreneurship pathways (Phase 10) */}
          {business.length > 0 && (
            <section className="bg-white rounded-2xl border border-slate-100 card-shadow p-5">
              <h2 className="font-bold text-slate-900 text-lg">
                💼 {t("result.biz.title")}
              </h2>
              <div className="mt-3 space-y-3">
                {business.map((b) => (
                  <div key={b.ideaId} className="rounded-xl border border-slate-100 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-slate-900">{tl(`biz.${b.ideaId}`)}</h3>
                      <span className="text-xs font-bold text-saffron-700 bg-saffron-100 rounded-full px-2.5 py-1">
                        {b.readinessPercent}% {t("result.biz.ready")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      🧰 {t("result.biz.tools")}: {b.tools.join(", ")}
                    </p>
                    <p className="text-xs text-slate-500">
                      🏛️ {t("result.biz.schemes")}: {b.schemes.join(", ")} —{" "}
                      {t("result.biz.schemesNote")}
                    </p>
                    {b.missingSkills.length > 0 && (
                      <p className="mt-1 text-xs text-slate-600">
                        {t("result.gap.missing")}: {b.missingSkills.map(skillLabel).join(", ")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Save / register CTA — confirmation before saving (Phase 19) */}
          <section className="bg-indigoink-50 rounded-2xl border border-indigoink-100 p-5 text-center">
            <p className="text-sm text-slate-600">{t("result.saveAsk")}</p>
            <div className="mt-3 flex flex-wrap gap-3 justify-center">
              <button
                onClick={() => nav.go("register")}
                className="px-6 py-3 rounded-xl bg-saffron-500 hover:bg-saffron-600 text-white font-semibold transition-all active:scale-95"
              >
                {t("result.saveYes")}
              </button>
              <button
                onClick={interview.reset}
                className="px-6 py-3 rounded-xl border border-slate-200 bg-white font-semibold text-slate-700 hover:bg-slate-50"
              >
                {t("result.saveNo")}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function roleLevel(roleId: string): number {
  return JOB_ROLES.find((r) => r.id === roleId)?.nsqf_level ?? 2;
}

function Chip({ label }: { label: string }) {
  return (
    <span className="bg-slate-100 text-slate-700 rounded-full px-3 py-1 text-xs font-medium">
      {label}
    </span>
  );
}

function reasonText(
  id: string,
  vars: Record<string, string | number> | undefined,
  tl: (k: string, v?: Record<string, string | number>) => string,
): string {
  return tl(`reason.${id}`, vars);
}

// Re-export for tests
export { skillLabel };
export type { LivelihoodProfile };
