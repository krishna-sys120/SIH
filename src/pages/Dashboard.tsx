import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n/context";
import { fetchBeneficiaries, fetchCourses, usingSupabase } from "../data/store";
import type { Beneficiary, Course } from "../data/model";

interface EnrollRow {
  beneficiary_id: string;
  course_id: string;
}

export default function Dashboard() {
  const { t, tl } = useI18n();
  const [bens, setBens] = useState<Beneficiary[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrolls, setEnrolls] = useState<EnrollRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(false);
    try {
      const [b, c] = await Promise.all([fetchBeneficiaries(), fetchCourses()]);
      setBens(b);
      setCourses(c);
      // Demo-mode enrollments from localStorage
      try {
        const raw = localStorage.getItem("skillsetu.enrollments");
        if (raw) setEnrolls(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    } catch {
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
    return {
      total: bens.length,
      enrolled: enrolls.length,
      pending: Math.max(0, bens.length - enrolls.length),
      womenPct: bens.length ? Math.round((women / bens.length) * 100) : 0,
    };
  }, [bens, enrolls]);

  const topWork = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of bens) counts.set(b.work_type, (counts.get(b.work_type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [bens]);

  const sectorEnrolls = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of enrolls) {
      const course = courses.find((c) => c.id === e.course_id);
      if (course) counts.set(course.sector, (counts.get(course.sector) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [enrolls, courses]);

  function exportCsv() {
    const header = ["name", "age", "gender", "phone", "state", "district", "category", "work_type", "education", "created_at"];
    const rows = bens.map((b) => header.map((h) => String((b as never as Record<string, unknown>)[h] ?? "")).join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "beneficiaries.csv";
    a.click();
    URL.revokeObjectURL(url);
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
          <button
            onClick={load}
            className="px-3.5 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ⟳ {t("dashboard.refresh")}
          </button>
          <button
            onClick={exportCsv}
            className="px-3.5 py-2 rounded-lg bg-indigoink-600 text-white text-sm font-medium hover:bg-indigoink-700"
          >
            ⬇ {t("dashboard.export")}
          </button>
        </div>
      </div>

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
              { icon: "🎓", n: stats.enrolled, label: t("dashboard.stat.enrolled"), color: "bg-leaf-500/10" },
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

          {/* Charts row */}
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
                    const pct = Math.round((n / Math.max(1, stats.enrolled)) * 100);
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
          </div>

          {/* Table */}
          <div className="mt-6 bg-white rounded-2xl border border-slate-100 card-shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-slate-500 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3 font-semibold">{t("dashboard.table.name")}</th>
                    <th className="px-4 py-3 font-semibold">{t("dashboard.table.work")}</th>
                    <th className="px-4 py-3 font-semibold">{t("dashboard.table.state")}</th>
                    <th className="px-4 py-3 font-semibold">{t("dashboard.table.phone")}</th>
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
                    return (
                      <tr key={b.id ?? i} className="border-t border-slate-100 hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-900">{b.name}</span>
                          <span className="block text-xs text-slate-400">
                            {b.age} · {b.gender}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{tl(`liv.${b.work_type}`)}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {b.district}
                          <span className="block text-xs text-slate-400">{b.state}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 tabular-nums">{b.phone}</td>
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
