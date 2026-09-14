import { useEffect, useState } from "react";
import type { Nav } from "../App";
import { useI18n } from "../i18n/context";
import { LANGUAGES } from "../i18n/languages";
import { useInstallPrompt } from "../pwa/useInstallPrompt";
import { fetchCourses, fetchBeneficiaries, usingSupabase } from "../data/store";
import type { Beneficiary, Course } from "../data/model";

export default function Home({ nav }: { nav: Nav }) {
  const { t } = useI18n();
  const { canInstall, installed, install } = useInstallPrompt();
  const [stats, setStats] = useState({ ben: 0, courses: 0, matches: 0 });

  useEffect(() => {
    (async () => {
      const [courses, bens] = await Promise.all([fetchCourses(), fetchBeneficiaries()]);
      setStats({
        ben: bens.length,
        courses: courses.length,
        matches: Math.min(bens.length * 3, courses.length * bens.length),
      });
    })().catch((e) => console.warn("[home] stats load failed", e));
  }, []);

  return (
    <div>
      {/* Hero */}
      <section className="bg-gradient-to-b from-indigoink-50 to-white border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 py-16 md:py-24 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 bg-saffron-100 text-saffron-800 text-xs font-semibold px-3 py-1.5 rounded-full">
              🇮🇳 {t("home.hero.badge")}
            </span>
            <h1 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.1]">
              {t("home.hero.title")}
            </h1>
            <p className="mt-4 text-lg text-slate-600 max-w-xl">{t("home.hero.subtitle")}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <button
                onClick={() => nav.go("assistant")}
                className="px-6 py-3 rounded-xl bg-saffron-500 hover:bg-saffron-600 text-white font-semibold shadow-lg shadow-saffron-500/25 transition-all active:scale-95"
              >
                🎙️ {t("home.hero.ctaVoice")}
              </button>
              <button
                onClick={() => nav.go("register")}
                className="px-6 py-3 rounded-xl bg-white hover:bg-slate-50 text-indigoink-700 font-semibold border border-slate-200 card-shadow transition-all active:scale-95"
              >
                {t("home.hero.ctaRegister")}
              </button>
              {canInstall && (
                <button
                  onClick={() => void install()}
                  className="px-6 py-3 rounded-xl bg-indigoink-600 hover:bg-indigoink-700 text-white font-semibold shadow-lg shadow-indigoink-600/25 transition-all active:scale-95"
                >
                  ⬇️ {t("install.action")}
                </button>
              )}
            </div>
            {installed && (
              <p className="mt-3 text-sm text-slate-500">✅ {t("install.done")}</p>
            )}
          </div>

          {/* Decorative voice orb */}
          <div className="hidden md:grid place-items-center">
            <div className="relative w-64 h-64">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-saffron-400/20 to-indigoink-500/20 animate-ping" />
              <div className="absolute inset-4 rounded-full bg-gradient-to-br from-saffron-400/30 to-indigoink-500/30" />
              <div className="absolute inset-0 grid place-items-center text-7xl">🎙️</div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="max-w-6xl mx-auto px-4 -mt-8 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { n: stats.ben, label: t("home.stats.beneficiaries"), icon: "👥" },
            { n: stats.courses, label: t("home.stats.courses"), icon: "📚" },
            { n: stats.matches, label: t("home.stats.matches"), icon: "🤖" },
            { n: LANGUAGES.length, label: t("home.stats.langs"), icon: "🌐" },
          ].map((s, i) => (
            <div key={i} className="bg-white rounded-2xl card-shadow border border-slate-100 p-5">
              <div className="text-2xl">{s.icon}</div>
              <div className="mt-1 text-3xl font-extrabold text-slate-900">{s.n}</div>
              <div className="text-sm text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Why it works */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 text-center">
          {t("home.why.title")}
        </h2>
        <div className="mt-8 grid sm:grid-cols-3 gap-4">
          {[
            { icon: "🗣️", title: t("home.why.voice.title"), desc: t("home.why.voice.desc") },
            { icon: "🎯", title: t("home.why.nsqf.title"), desc: t("home.why.nsqf.desc") },
            { icon: "🆓", title: t("home.why.free.title"), desc: t("home.why.free.desc") },
          ].map((f, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl border border-slate-100 card-shadow p-6 hover:-translate-y-1 transition-transform"
            >
              <div className="w-11 h-11 rounded-xl bg-indigoink-50 grid place-items-center text-xl">
                {f.icon}
              </div>
              <h3 className="mt-4 font-bold text-slate-900">{f.title}</h3>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-white border-y border-slate-100">
        <div className="max-w-6xl mx-auto px-4 py-16">
          <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 text-center">
            {t("home.how.title")}
          </h2>
          <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { n: 1, icon: "👂", title: t("home.how.s1.title"), desc: t("home.how.s1.desc") },
              { n: 2, icon: "🗺️", title: t("home.how.s2.title"), desc: t("home.how.s2.desc") },
              { n: 3, icon: "🤝", title: t("home.how.s3.title"), desc: t("home.how.s3.desc") },
              { n: 4, icon: "🌱", title: t("home.how.s4.title"), desc: t("home.how.s4.desc") },
            ].map((s) => (
              <div key={s.n} className="relative rounded-2xl border border-slate-100 p-5 bg-slate-50/60">
                <span className="absolute -top-3 left-5 w-7 h-7 rounded-full bg-indigoink-600 text-white text-sm font-bold grid place-items-center">
                  {s.n}
                </span>
                <div className="text-2xl mt-2">{s.icon}</div>
                <h3 className="mt-2 font-bold text-slate-900">{s.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{s.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <button
              onClick={() => nav.go("assistant")}
              className="px-8 py-3.5 rounded-xl bg-indigoink-600 hover:bg-indigoink-700 text-white font-semibold shadow-lg shadow-indigoink-600/25 transition-all active:scale-95"
            >
              {t("home.hero.ctaVoice")} →
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
