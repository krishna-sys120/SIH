import { useState } from "react";
import { useI18n } from "./i18n/context";
import { LANGUAGES, type LangCode } from "./i18n/languages";
import HomePage from "./pages/Home";
import AssistantPage from "./pages/Assistant";
import CoursesPage from "./pages/Courses";
import RegisterPage from "./pages/Register";
import DashboardPage from "./pages/Dashboard";
import { isTtsSupported } from "./voice/speech";

export type Page = "home" | "assistant" | "courses" | "register" | "dashboard";

export interface Nav {
  page: Page;
  go: (p: Page) => void;
}

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const { lang, setLang, t } = useI18n();

  const nav: Nav = { page, go: setPage };

  const navItems: Array<{ id: Page; label: string; icon: string }> = [
    { id: "home", label: t("nav.home"), icon: "🏠" },
    { id: "assistant", label: t("nav.assistant"), icon: "🎙️" },
    { id: "courses", label: t("nav.courses"), icon: "📚" },
    { id: "register", label: t("nav.register"), icon: "📝" },
    { id: "dashboard", label: t("nav.dashboard"), icon: "📊" },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <button
            onClick={() => setPage("home")}
            className="flex items-center gap-2.5 shrink-0"
            aria-label="SkillSetu home"
          >
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-saffron-500 to-indigoink-600 grid place-items-center text-white text-lg">
              🎙️
            </span>
            <span className="leading-tight text-left">
              <span className="block font-extrabold text-slate-900">{t("app.name")}</span>
              <span className="block text-[11px] text-slate-500 hidden sm:block">
                PM-AJAY · GIA
              </span>
              <span className="block text-[11px] text-slate-500 sm:hidden">GIA</span>
            </span>
          </button>

          <nav className="hidden md:flex items-center gap-1" aria-label="Main">
            {navItems.map((n) => (
              <button
                key={n.id}
                onClick={() => setPage(n.id)}
                className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  page === n.id
                    ? "bg-indigoink-600 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {n.label}
              </button>
            ))}
          </nav>

          <LanguageSelect lang={lang} setLang={setLang} />
        </div>

        {/* Mobile nav */}
        <nav
          className="md:hidden flex overflow-x-auto border-t border-slate-100 bg-white"
          aria-label="Mobile"
        >
          {navItems.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              className={`flex-1 min-w-fit px-3 py-2.5 text-xs font-medium whitespace-nowrap ${
                page === n.id ? "text-indigoink-700 border-b-2 border-saffron-500" : "text-slate-500"
              }`}
            >
              <span className="mr-1">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Pages */}
      <main className="flex-1">
        {page === "home" && <HomePage nav={nav} />}
        {page === "assistant" && <AssistantPage nav={nav} />}
        {page === "courses" && <CoursesPage nav={nav} />}
        {page === "register" && <RegisterPage nav={nav} />}
        {page === "dashboard" && <DashboardPage />}
      </main>

      {/* Footer */}
      <footer className="bg-indigoink-950 text-indigoink-100 mt-12">
        <div className="max-w-6xl mx-auto px-4 py-8 text-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-white">{t("app.name")}</p>
              <p className="mt-1 text-indigoink-100/80">{t("footer.line")}</p>
            </div>
            <p className="text-indigoink-100/60 text-xs">{t("footer.ministry")}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function LanguageSelect({ lang, setLang }: { lang: LangCode; setLang: (l: LangCode) => void }) {
  const { t } = useI18n();
  const voiceAvailable = isTtsSupported();
  return (
    <label className="relative shrink-0">
      <span className="sr-only">{t("lang.label")}</span>
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as LangCode)}
        className="appearance-none bg-slate-100 hover:bg-slate-200 transition-colors rounded-lg pl-8 pr-7 py-2 text-sm font-medium text-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigoink-500"
        aria-label={t("lang.label")}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native} · {l.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm">
        🌐
      </span>
    </label>
  );
}
