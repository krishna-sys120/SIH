import { useEffect, useMemo, useState } from "react";
import type { Nav } from "../App";
import { useI18n } from "../i18n/context";
import {
  fetchCourses,
  enrollBeneficiary,
  listEnrollments,
  listMyEnrollments,
  resolveActorId,
  usingSupabase,
} from "../data/store";
import { recommendCourses } from "../data/recommend";
import { useOnline } from "../data/offline";
import { SECTORS, type Course, type MatchResult } from "../data/model";

export default function Courses({ nav }: { nav: Nav }) {
  const { t, tl } = useI18n();
  const [courses, setCourses] = useState<Course[]>([]);
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState<string>("all");
  const [enrolled, setEnrolled] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState(false);
  const [enrollErrorMsg, setEnrollErrorMsg] = useState<string | null>(null);
  const [noProfile, setNoProfile] = useState(false);
  const online = useOnline();
  /** Locally-deducted seats in demo mode (persisted store is not writable from the UI). */
  const [seatsUsed, setSeatsUsed] = useState<Record<string, number>>({});

  // Hydrate: last registered profile (for personalized ranking) + the persisted
  // enrollment store (single source of truth for enrolled state & seat counts).
  const [profile, setProfile] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("skillsetu.lastProfile");
      if (raw) setProfile(JSON.parse(raw));
    } catch {
      /* ignore */
    }
    const benId = resolveActorId();
    if (benId) {
      listMyEnrollments(benId)
        .then(setEnrolled)
        .catch((e) => console.warn("[courses] my-enrollments load failed", e));
    }
    // Demo mode only: seed seats are static, so derive deducted seats from the
    // persisted local store. In Supabase mode the DB already reflects seats.
    if (!usingSupabase) {
      listEnrollments()
        .then((rows) => {
          const counts: Record<string, number> = {};
          for (const r of rows) counts[r.course_id] = (counts[r.course_id] ?? 0) + 1;
          setSeatsUsed(counts);
        })
        .catch((e) => console.warn("[courses] enrollments load failed", e));
    }
  }, []);

  useEffect(() => {
    fetchCourses()
      .then(setCourses)
      .catch((e) => console.warn("[courses] load failed", e));
  }, []);

  const scored: MatchResult[] = useMemo(() => {
    if (!profile) return courses.map((c) => ({ course: c, score: 0, reasons: [] }));
    const ranked = recommendCourses(profile as never, courses, courses.length);
    return ranked;
  }, [courses, profile]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return scored.filter((m) => {
      const okSector = sector === "all" || m.course.sector === sector;
      const okQuery =
        !q ||
        m.course.name.toLowerCase().includes(q) ||
        m.course.provider.toLowerCase().includes(q) ||
        m.course.district.toLowerCase().includes(q) ||
        m.course.keywords.some((k) => k.includes(q));
      return okSector && okQuery;
    });
  }, [scored, query, sector]);

  async function handleEnroll(courseId: string) {
    if (enrolled.has(courseId)) return;
    setEnrollError(false);
    setEnrollErrorMsg(null);
    const benId = resolveActorId();
    // Supabase enrollment posts a real uuid — a saved profile is mandatory.
    if (!benId) {
      setNoProfile(true);
      return;
    }
    try {
      const res = await enrollBeneficiary(benId, courseId);
      setEnrolled((s) => new Set(s).add(courseId));
      setSeatsUsed((m) => ({ ...m, [courseId]: (m[courseId] ?? 0) + 1 }));
      if (res.seatsLeft !== null) {
        setCourses((cs) => cs.map((c) => (c.id === courseId ? { ...c, seats_left: res.seatsLeft! } : c)));
      }
    } catch (e) {
      console.warn("[courses] enrollment failed", e);
      setEnrollError(true);
      setEnrollErrorMsg(e instanceof Error ? e.message : null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900">{t("courses.title")}</h1>
      <p className="mt-1 text-slate-600">{t("courses.subtitle")}</p>

      {noProfile && (
        <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 flex flex-wrap items-center gap-2">
          <span>{t("courses.needProfile")}</span>
          <button
            onClick={() => nav.go("register")}
            className="font-semibold underline underline-offset-2"
          >
            {t("nav.register")} →
          </button>
        </div>
      )}
      {!online && (
        <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3">
          📴 {t("offline.notice")}
        </div>
      )}
      {enrollError && (
        <div className="mt-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3">
          {t("courses.enrollFailed")}
          {enrollErrorMsg ? ` — ${enrollErrorMsg}` : ""}
        </div>
      )}

      {/* Search + filters */}
      <div className="mt-6 flex flex-col md:flex-row gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("courses.search")}
          className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigoink-500"
        />
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setSector("all")}
          className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
            sector === "all" ? "bg-indigoink-600 text-white" : "bg-white border border-slate-200 text-slate-600"
          }`}
        >
          {t("courses.all")}
        </button>
        {SECTORS.map((s) => (
          <button
            key={s}
            onClick={() => setSector(s)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
              sector === s ? "bg-indigoink-600 text-white" : "bg-white border border-slate-200 text-slate-600"
            }`}
          >
            {tl(`sec.${s}`)}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="mt-12 text-center text-slate-500">
          <p className="text-4xl">🔍</p>
          <p className="mt-2 font-medium">{t("courses.none.title")}</p>
          <p className="text-sm">{t("courses.none.desc")}</p>
        </div>
      ) : (
        <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((m) => {
            const c = m.course;
            const isEnrolled = enrolled.has(c.id);
            return (
              <div
                key={c.id}
                className="bg-white rounded-2xl border border-slate-100 card-shadow p-5 flex flex-col hover:-translate-y-0.5 transition-transform"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-semibold text-indigoink-700 bg-indigoink-50 rounded-full px-2.5 py-1">
                    {tl(`sec.${c.sector}`)}
                  </span>
                  {m.score > 0 && (
                    <span className="text-xs font-bold text-leaf-600 bg-leaf-500/10 rounded-full px-2.5 py-1">
                      {m.score}% {t("courses.matchScore")}
                    </span>
                  )}
                </div>
                <h3 className="mt-3 font-bold text-slate-900 leading-snug">{c.name}</h3>
                <p className="mt-1 text-sm text-slate-500">{c.provider}</p>

                {/* Data-quality badge (Phase 21) — honest provenance. */}
                {c.verification === "official" ? (
                  <span className="mt-2 inline-block text-[11px] font-semibold text-leaf-700 bg-leaf-500/10 rounded-full px-2 py-0.5">
                    ✓ {t("courses.verified")}
                  </span>
                ) : (
                  <span className="mt-2 inline-block text-[11px] font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
                    ⚠ {t("courses.prototypeData")}
                  </span>
                )}

                <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-slate-600">
                  <span className="bg-slate-100 rounded-md px-2 py-1">
                    {t("courses.level")} {c.nsqf_level}
                  </span>
                  <span className="bg-slate-100 rounded-md px-2 py-1">
                    ⏱ {c.duration_months} {t("courses.months")}
                  </span>
                  <span className="bg-leaf-500/10 text-leaf-600 rounded-md px-2 py-1 font-medium">
                    {t("courses.free")}
                  </span>
                  {c.stipend_monthly > 0 && (
                    <span className="bg-saffron-100 text-saffron-800 rounded-md px-2 py-1">
                      ₹{c.stipend_monthly.toLocaleString()}/{t("courses.months")}
                    </span>
                  )}
                </div>

                <p className="mt-3 text-xs text-slate-500">
                  📍 {c.district}, {c.state} ·{" "}
                  <span className={c.seats_left < 15 ? "text-rose-600 font-medium" : ""}>
                    {Math.max(0, c.seats_left - (seatsUsed[c.id] ?? 0))} {t("courses.seats")}
                  </span>
                </p>

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => handleEnroll(c.id)}
                    disabled={isEnrolled}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 ${
                      isEnrolled
                        ? "bg-leaf-500/10 text-leaf-600 cursor-default"
                        : "bg-indigoink-600 hover:bg-indigoink-700 text-white"
                    }`}
                  >
                    {isEnrolled ? t("courses.enrolled") : t("courses.enroll")}
                  </button>
                  <button
                    onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
                    aria-label={t("courses.why")}
                  >
                    {expanded === c.id ? "▲" : "▼"}
                  </button>
                </div>

                {expanded === c.id && m.reasons.length > 0 && (
                  <div className="mt-3 rounded-xl bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600 space-y-1 fade-up">
                    <p className="font-semibold text-slate-700">{t("courses.why")}</p>
                    {m.reasons.map((r, i) => (
                      <p key={i}>• {tl(r, { liv: tl(`liv.${m.livelihood ?? "farmer"}`), n: c.name })}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
