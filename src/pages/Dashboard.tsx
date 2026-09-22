import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useI18n } from "../i18n/context";
import {
  fetchBeneficiaries,
  fetchCourses,
  listEnrollments,
  usingSupabase,
  useSession,
  signIn,
  signOut,
} from "../data/store";
import { useComms, type CommRow } from "../data/comms";
import type { Beneficiary, Course } from "../data/model";

interface EnrollRow {
  beneficiary_id: string;
  course_id: string;
}

/**
 * Admin dashboard (Phase 16/17): aggregate monitoring + SIH impact funnel.
 * Every figure is an aggregate — names/phones never appear (the demo table is
 * pseudonymous demo data, clearly labeled; the Supabase path reads only the
 * PII-free directory view). "Potential impact" is labeled as a projection and
 * never mixed with verified counts.
 */
export default function Dashboard() {
  const { t, tl, lang } = useI18n();
  // SEC-013/SEC-031: privileged actions (the pseudonymous CSV export) require a
  // signed-in session; server-side authorization is enforced by RLS policies
  // (is_staff/is_admin read app_metadata, which users cannot edit). In demo
  // mode there is no session — the export button is hidden and a demo note shows.
  const { session } = useSession();
  const canExport = usingSupabase && session !== null;
  // SEC-013 sign-in surface: staff/admin authenticate here. Roles live in
  // server-side app_metadata — signing in only ever grants what RLS policies
  // verify against the verified JWT, never a client-controlled flag.
  const [signingIn, setSigningIn] = useState(false);
  const [authErr, setAuthErr] = useState<string | null>(null);
  async function handleSignIn(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const fd = new FormData(ev.currentTarget);
    const email = String(fd.get("email") ?? "").trim();
    const password = String(fd.get("password") ?? "");
    if (!email || !password) return;
    setSigningIn(true);
    setAuthErr(null);
    try {
      await signIn(email, password);
      setSigningIn(false);
    } catch (e) {
      // Safe allowlist: never render raw backend messages (SEC-015).
      const raw = e instanceof Error ? e.message : String(e);
      setAuthErr(
        /invalid login|invalid credentials|email not confirmed/i.test(raw)
          ? t("auth.invalidCredentials")
          : /rate|too many/i.test(raw)
            ? t("auth.rateLimited")
            : /failed to fetch|network/i.test(raw)
              ? t("common.error")
              : t("auth.invalidCredentials"),
      );
      setSigningIn(false);
    }
  }
  const [bens, setBens] = useState<Beneficiary[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrolls, setEnrolls] = useState<EnrollRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const comms = useComms();

  const load = useCallback(async () => {
    setLoading(true);
    setErr(false);
    try {
      const [b, c, e] = await Promise.all([fetchBeneficiaries(), fetchCourses(), listEnrollments()]);
      setBens(b);
      setCourses(c);
      setEnrolls(e);
    } catch (e) {
      console.warn("[dashboard] load failed", e);
      setErr(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const women = bens.filter((b) => b.gender === "female").length;
    const enrolledIds = new Set(enrolls.map((e) => e.beneficiary_id));
    return {
      total: bens.length,
      enrolledPeople: enrolledIds.size,
      enrollments: enrolls.length,
      pending: Math.max(0, bens.length - enrolledIds.size),
      womenPct: bens.length ? Math.round((women / bens.length) * 100) : 0,
    };
  }, [bens, enrolls]);

  const topWork = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of bens) counts.set(b.work_type, (counts.get(b.work_type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [bens]);

  const byDistrict = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of bens) {
      const k = `${b.district}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [bens]);

  const byEducation = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of bens) counts.set(b.education, (counts.get(b.education) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [bens]);

  const sectorEnrolls = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of enrolls) {
      const course = courses.find((c) => c.id === e.course_id);
      if (course) counts.set(course.sector, (counts.get(course.sector) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [enrolls, courses]);

  const topCourses = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of enrolls) counts.set(e.course_id, (counts.get(e.course_id) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, n]) => ({ name: courses.find((c) => c.id === id)?.name ?? id, n }));
  }, [enrolls, courses]);

  // Impact funnel (Phase 17): onboarded → profiled → skills found → gaps
  // detected → recommended → enrolled. Potential (projection) kept separate.
  const funnel = useMemo(() => {
    const onboarded = bens.length;
    const profiled = bens.length; // every registered row carries a profile
    const withSkills = bens.filter((b) => (b.skills ?? "").trim().length > 0).length;
    const enrolledIds = new Set(enrolls.map((e) => e.beneficiary_id));
    const recommended = Math.min(courses.length * Math.max(1, bens.length), Math.max(onboarded * 3, enrolledIds.size));
    return [
      { key: "funnel.onboarded", n: onboarded },
      { key: "funnel.profiled", n: profiled },
      { key: "funnel.skills", n: withSkills },
      { key: "funnel.enrolled", n: enrolledIds.size },
    ];
  }, [bens, enrolls, courses.length]);

  const langUse = useMemo(() => {
    // Voice vs text usage from the comms log (voice calls vs messages).
    const voice = comms.rows.filter((r) => r.channel === "voice").length;
    const text = comms.rows.filter((r) => r.channel !== "voice").length;
    return { voice, text };
  }, [comms.rows]);

  function exportCsv() {
    // PII-safe export (Phase 3/16): pseudonymous directory, no names/phones.
    const header = ["id", "gender", "state", "district", "work_type", "education", "age_band", "created_month"];
    const band = (age: number) =>
      age < 18 ? "under-18" : age < 25 ? "18-24" : age < 35 ? "25-34" : age < 50 ? "35-49" : "50+";
    const rows = bens.map((b) =>
      [
        b.id ?? "",
        b.gender,
        b.state,
        b.district,
        b.work_type,
        b.education,
        band(b.age ?? 0),
        (b.created_at ?? "").slice(0, 7),
      ].join(","),
    );
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "beneficiaries-pseudonymous.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const commStats = useMemo(() => {
    const msgs = comms.rows.filter((r) => r.channel !== "voice");
    const calls = comms.rows.filter((r) => r.channel === "voice");
    return {
      total: msgs.length,
      delivered: msgs.filter((r) => r.status === "delivered").length,
      failed: msgs.filter((r) => r.status === "failed" || r.status === "undelivered").length,
      calls: calls.length,
      ivr: calls.filter((r) => (r.ivr_keys ?? "").length > 0).length,
    };
  }, [comms.rows]);

  function commChannelLabel(c: CommRow["channel"]): string {
    if (c === "sms") return "SMS";
    if (c === "whatsapp") return "WhatsApp";
    return t("comm.channel.voice");
  }

  function fmtWhen(iso: string): string {
    try {
      return new Date(iso).toLocaleString(lang === "en" ? "en-IN" : lang, {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  function statusColor(s: string): string {
    if (s === "delivered" || s === "completed" || s === "received") return "bg-leaf-500/10 text-leaf-600";
    if (s === "failed" || s === "undelivered") return "bg-rose-50 text-rose-600";
    return "bg-amber-100 text-amber-700";
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900">{t("dashboard.title")}</h1>
          <p className="mt-1 text-slate-600">{t("dashboard.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1.5 ${
              usingSupabase ? "bg-leaf-500/10 text-leaf-600" : "bg-amber-100 text-amber-800"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${usingSupabase ? "bg-leaf-500" : "bg-amber-500"}`} />
            {usingSupabase ? t("dashboard.conn.supabase") : t("dashboard.conn.demo")}
          </span>
          {usingSupabase && session && (
            <span className="inline-flex items-center gap-2 text-xs text-slate-500">
              {t("auth.signedInAs")} {session.user.email ?? session.user.id.slice(0, 8)}
              <button
                onClick={() => void signOut()}
                className="px-2.5 py-1 rounded-md border border-slate-200 bg-white font-medium text-slate-600 hover:bg-slate-50"
              >
                {t("auth.signOut")}
              </button>
            </span>
          )}
          {usingSupabase && !session && (
            <form onSubmit={handleSignIn} className="flex flex-wrap items-center gap-2">
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                placeholder="email"
                aria-label="email"
                className="w-44 px-2.5 py-1.5 rounded-md border border-slate-200 text-xs focus:ring-2 focus:ring-indigoink-500 outline-none"
              />
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="password"
                aria-label="password"
                className="w-36 px-2.5 py-1.5 rounded-md border border-slate-200 text-xs focus:ring-2 focus:ring-indigoink-500 outline-none"
              />
              <button
                type="submit"
                disabled={signingIn}
                className="px-3 py-1.5 rounded-md bg-indigoink-600 text-white text-xs font-medium hover:bg-indigoink-700 disabled:opacity-50"
              >
                {t("auth.signIn")}
              </button>
            </form>
          )}
          {authErr && <span className="text-xs text-rose-600 font-medium">{authErr}</span>}
          <button
            onClick={load}
            className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ⟳ {t("dashboard.refresh")}
          </button>
          {canExport && (
            <button
              onClick={exportCsv}
              className="px-3.5 py-2 rounded-lg bg-indigoink-600 text-white text-sm font-medium hover:bg-indigoink-700"
            >
              ⬇ {t("dashboard.export")}
            </button>
          )}
        </div>
      </div>

      {!usingSupabase && (
        <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠ {t("dashboard.demoNote")}
        </p>
      )}

      {err && (
        <p className="mt-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3">
          {t("common.error")} — <button onClick={load} className="underline">{t("common.retry")}</button>
        </p>
      )}

      {loading ? (
        <div className="mt-10 grid sm:grid-cols-4 gap-3 animate-pulse">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-slate-100 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: "👥", n: stats.total, label: t("dashboard.stat.beneficiaries"), color: "bg-indigoink-50" },
              { icon: "🎓", n: stats.enrollments, label: t("dashboard.stat.enrolled"), color: "bg-leaf-500/10" },
              { icon: "⏳", n: stats.pending, label: t("dashboard.stat.pending"), color: "bg-amber-50" },
              { icon: "👩", n: `${stats.womenPct}%`, label: t("dashboard.stat.women"), color: "bg-saffron-100" },
            ].map((s, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-100 card-shadow p-5">
                <div className={`w-10 h-10 rounded-xl ${s.color} grid place-items-center text-lg`}>{s.icon}</div>
                <div className="mt-2 text-3xl font-extrabold text-slate-900">{s.n}</div>
                <div className="text-sm text-slate-500">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Impact funnel (Phase 17) */}
          <div className="mt-6 bg-white rounded-2xl border border-slate-100 card-shadow p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">{t("funnel.title")}</h3>
              <span className="text-xs text-slate-400">{t("funnel.potentialNote")}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              {funnel.map((f, i) => {
                const max = Math.max(1, funnel[0]?.n ?? 1);
                const pct = Math.round((f.n / max) * 100);
                return (
                  <div key={f.key} className="rounded-xl bg-slate-50 p-4">
                    <div className="text-3xl font-extrabold text-slate-900 tabular-nums">{f.n}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{t(f.key as never)}</div>
                    <div className="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${i === funnel.length - 1 ? "bg-leaf-500" : "bg-indigoink-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Charts */}
          <div className="mt-6 grid md:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border border-slate-100 card-shadow p-5">
              <h3 className="font-bold text-slate-900">{t("dashboard.top.work")}</h3>
              {topWork.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{t("dashboard.empty")}</p>
              ) : (
                <div className="mt-4 space-y-2.5">
                  {topWork.map(([work, n]) => {
                    const pct = Math.round((n / Math.max(1, stats.total)) * 100);
                    return (
                      <div key={work}>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-700">{tl(`liv.${work}`)}</span>
                          <span className="text-slate-500 font-medium">{n}</span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-indigoink-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 card-shadow p-5">
              <h3 className="font-bold text-slate-900">{t("dashboard.top.sectors")}</h3>
              {sectorEnrolls.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{t("dashboard.empty")}</p>
              ) : (
                <div className="mt-4 space-y-2.5">
                  {sectorEnrolls.map(([sec, n]) => {
                    const pct = Math.round((n / Math.max(1, stats.enrollments)) * 100);
                    return (
                      <div key={sec}>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-700">{tl(`sec.${sec}`)}</span>
                          <span className="text-slate-500 font-medium">{n}</span>
                        </div>
                        <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-saffron-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 card-shadow p-5">
              <h3 className="font-bold text-slate-900">{t("dashboard.by.district")}</h3>
              <div className="mt-4 flex flex-wrap gap-2">
                {byDistrict.length === 0 && <p className="text-sm text-slate-500">{t("dashboard.empty")}</p>}
                {byDistrict.map(([d, n]) => (
                  <span key={d} className="rounded-full bg-indigoink-50 text-indigoink-700 text-sm font-medium px-3 py-1.5">
                    📍 {d} · {n}
                  </span>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 card-shadow p-5">
              <h3 className="font-bold text-slate-900">{t("dashboard.by.education")}</h3>
              <div className="mt-4 flex flex-wrap gap-2">
                {byEducation.length === 0 && <p className="text-sm text-slate-500">{t("dashboard.empty")}</p>}
                {byEducation.map(([e, n]) => (
                  <span key={e} className="rounded-full bg-slate-100 text-slate-700 text-sm font-medium px-3 py-1.5">
                    🎓 {tl(`edu.${e}`)} · {n}
                  </span>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 card-shadow p-5">
              <h3 className="font-bold text-slate-900">{t("dashboard.top.courses")}</h3>
              {topCourses.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">{t("dashboard.empty")}</p>
              ) : (
                <ol className="mt-3 space-y-1.5 text-sm text-slate-700 list-decimal list-inside">
                  {topCourses.map((c) => (
                    <li key={c.name}>{c.name} <span className="text-slate-400">· {c.n}</span></li>
                  ))}
                </ol>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 card-shadow p-5">
              <h3 className="font-bold text-slate-900">{t("dashboard.usage.title")}</h3>
              <div className="mt-4 grid grid-cols-2 gap-3 text-center">
                <div className="rounded-xl bg-saffron-50 p-4">
                  <div className="text-3xl font-extrabold text-slate-900">{langUse.voice}</div>
                  <div className="text-xs text-slate-500 mt-1">🎙️ {t("dashboard.usage.voice")}</div>
                </div>
                <div className="rounded-xl bg-indigoink-50 p-4">
                  <div className="text-3xl font-extrabold text-slate-900">{langUse.text}</div>
                  <div className="text-xs text-slate-500 mt-1">💬 {t("dashboard.usage.text")}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Communications (SMS / WhatsApp / Voice / IVR) */}
          <div className="mt-6 bg-white rounded-2xl border border-slate-100 card-shadow p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900">{t("comm.title")}</h3>
                <p className="text-sm text-slate-500">{t("comm.subtitle")}</p>
              </div>
              <span className="text-2xl" aria-hidden>📞</span>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { n: commStats.total, label: t("comm.stat.total") },
                { n: commStats.delivered, label: t("comm.stat.delivered") },
                { n: commStats.failed, label: t("comm.stat.failed") },
                { n: commStats.calls, label: t("comm.stat.calls") },
                { n: commStats.ivr, label: t("comm.stat.ivr") },
              ].map((s, i) => (
                <div key={i} className="rounded-xl bg-slate-50 px-4 py-3">
                  <div className="text-2xl font-extrabold text-slate-900 tabular-nums">{s.n}</div>
                  <div className="text-xs text-slate-500">{s.label}</div>
                </div>
              ))}
            </div>
            {comms.loading ? (
              <div className="mt-4 h-24 rounded-xl bg-slate-100 animate-pulse" />
            ) : comms.error ? (
              <p className="mt-4 text-sm text-rose-600">{t("common.error")}</p>
            ) : comms.rows.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">{t("comm.empty")}</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500 text-xs uppercase tracking-wide">
                      <th className="px-3 py-2 font-semibold">{t("comm.table.channel")}</th>
                      <th className="px-3 py-2 font-semibold">{t("comm.table.direction")}</th>
                      <th className="px-3 py-2 font-semibold">{t("comm.table.phone")}</th>
                      <th className="px-3 py-2 font-semibold">{t("comm.table.status")}</th>
                      <th className="px-3 py-2 font-semibold">{t("comm.table.keys")}</th>
                      <th className="px-3 py-2 font-semibold">{t("comm.table.when")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comms.rows.slice(0, 10).map((r, i) => (
                      <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/60">
                        <td className="px-3 py-2 font-medium text-slate-700">{commChannelLabel(r.channel)}</td>
                        <td className="px-3 py-2 text-slate-600">{r.direction === "inbound" ? t("comm.dir.inbound") : t("comm.dir.outbound")}</td>
                        <td className="px-3 py-2 text-slate-600 tabular-nums">{r.phone_masked}</td>
                        <td className="px-3 py-2">
                          <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${statusColor(r.status)}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600 tabular-nums">{r.ivr_keys ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-500">{fmtWhen(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Pseudonymous beneficiary table (no names/phones in Supabase mode) */}
          <div className="mt-6 bg-white rounded-2xl border border-slate-100 card-shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-900 text-sm">{t("dashboard.table.title")}</h3>
              <span className="text-xs text-slate-400">{t("dashboard.table.piiNote")}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-slate-500 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 font-semibold">{t("dashboard.table.id")}</th>
                    <th className="px-4 py-3 font-semibold">{t("dashboard.table.work")}</th>
                    <th className="px-4 py-3 font-semibold">{t("dashboard.table.state")}</th>
                    <th className="px-4 py-3 font-semibold">{t("dashboard.table.edu")}</th>
                    <th className="px-4 py-3 font-semibold">{t("dashboard.table.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {bens.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                        {t("dashboard.empty")}
                      </td>
                    </tr>
                  )}
                  {bens.map((b, i) => {
                    const isEnrolled = enrolls.some((e) => e.beneficiary_id === b.id);
                    const band =
                      b.age < 18 ? "u18" : b.age < 25 ? "18-24" : b.age < 35 ? "25-34" : b.age < 50 ? "35-49" : "50+";
                    return (
                      <tr key={b.id ?? i} className="border-t border-slate-100 hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-slate-500">
                            {(b.id ?? "—").slice(0, 8)}
                          </span>
                          <span className="block text-xs text-slate-400">
                            {band} · {b.gender}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{tl(`liv.${b.work_type}`)}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {b.district}
                          <span className="block text-xs text-slate-400">{b.state}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{tl(`edu.${b.education}`)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs font-semibold rounded-full px-2.5 py-1 ${
                              isEnrolled ? "bg-leaf-500/10 text-leaf-600" : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {isEnrolled ? t("status.enrolled") : t("status.registered")}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
