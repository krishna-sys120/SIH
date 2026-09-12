import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { LangCode } from "./languages";
import { isLangCode } from "./languages";
import { STRINGS, type DictKey } from "./strings";
import { translateDynamic } from "./labels";

const STORAGE_KEY = "skillsetu.lang";

function initialLang(): LangCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isLangCode(saved)) return saved;
    const nav = navigator.language.slice(0, 2);
    if (isLangCode(nav)) return nav;
  } catch {
    /* ignore */
  }
  return "en";
}

interface I18nCtx {
  lang: LangCode;
  setLang: (l: LangCode) => void;
  /** Translate a UI key */
  t: (key: DictKey) => string;
  /** Translate a dynamic label like a livelihood or sector name */
  tl: (key: string, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(initialLang);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: LangCode) => setLangState(l), []);

  const t = useCallback(
    (key: DictKey): string => {
      const entry = STRINGS[key] as Record<string, string> | undefined;
      return entry?.[lang] ?? entry?.en ?? key;
    },
    [lang],
  );

  /** Dynamic labels (sectors, livelihoods, education, AI phrases). */
  const tl = useCallback(
    (key: string, vars?: Record<string, string | number>): string =>
      translateDynamic(key, lang, vars),
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t, tl }), [lang, setLang, t, tl]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
