import { useMemo, useState } from "react";
import type { Nav } from "../App";
import { useI18n } from "../i18n/context";
import { saveBeneficiary, fetchCourses } from "../data/store";
import { recommendCourses } from "../data/recommend";
import {
  LIVELIHOOD_IDS,
  type LivelihoodId,
  type Beneficiary,
  type MatchResult,
  EDUCATION_LEVELS,
  type EducationLevel,
} from "../data/model";
import { translateDynamic } from "../i18n/labels";

const STATES = [
  "Andhra Pradesh",
  "Bihar",
  "Chhattisgarh",
  "Gujarat",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Odisha",
  "Rajasthan",
  "Tamil Nadu",
  "Telangana",
  "Uttar Pradesh",
  "West Bengal",
];

const EMPTY: Form = {
  name: "",
  age: "",
  gender: "female",
  phone: "",
  state: "Maharashtra",
  district: "",
  category: "sc",
  income: "",
  work_type: "agri-labour",
  education: "secondary",
  skills: "",
  interest: "",
  consent: false,
};

interface Form {
  name: string;
  age: string;
  gender: Beneficiary["gender"];
  phone: string;
  state: string;
  district: string;
  category: Beneficiary["category"];
  income: string;
  work_type: LivelihoodId;
  education: EducationLevel;
  skills: string;
  interest: string;
  consent: boolean;
}

export default function Register({ nav }: { nav: Nav }) {
  const { t, tl } = useI18n();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState<Beneficiary | null>(null);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [courses, setCourses] = useState<MatchResult[]>([]);

  const stepTitles = [t("register.step.personal"), t("register.step.livelihood"), t("register.step.skills")];

  const canNext = useMemo(() => {
    if (step === 0)
      return form.name.trim().length >= 2 && /^[6-9]\d{9}$/.test(form.phone) && form.age && Number(form.age) >= 15 && Number(form.age) <= 60;
    if (step === 1) return form.district.trim().length >= 2;
    return form.consent;
  }, [form, step]);

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function handleSubmit() {
    setSaving(true);
    setError(false);
    const ben: Beneficiary = {
      name: form.name.trim(),
      age: Number(form.age),
      gender: form.gender,
      phone: form.phone,
      state: form.state,
      district: form.district.trim(),
      category: form.category,
      income: Number(form.income) || 0,
      work_type: form.work_type,
      education: form.education,
      skills: form.skills.trim(),
      interest: form.interest.trim(),
    };
    try {
      const rec = await saveBeneficiary(ben);
      const all = await fetchCourses();
      const ranked = recommendCourses(ben, all, 4);
      setMatches(ranked);
      setSaved(rec);
      try {
        localStorage.setItem("skillsetu.lastProfile", JSON.stringify(ben));
        localStorage.setItem("skillsetu.lastId", JSON.stringify(rec.id ?? "local"));
      } catch {
        /* ignore */
      }
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="text-center fade-up">
          <div className="w-16 h-16 mx-auto rounded-full bg-leaf-500/10 grid place-items-center text-3xl">
            ✅
          </div>
          <h1 className="mt-4 text-2xl md:text-3xl font-extrabold text-slate-900">
            {t("register.success.title")}
          </h1>
          <p className="mt-2 text-slate-600">{t("register.success.desc")}</p>
        </div>
        <div className="mt-8 space-y-3">
          {matches.map((m) => (
            <div key={m.course.id} className="bg-white rounded-2xl border border-slate-100 card-shadow p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-slate-900">{m.course.name}</h3>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {tl(`sec.${m.course.sector}`)} · {t("courses.level")} {m.course.nsqf_level} ·{" "}
                    {m.course.district}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold text-leaf-600 bg-leaf-500/10 rounded-full px-3 py-1">
                  {m.score}%
                </span>
              </div>
              <ul className="mt-3 space-y-1">
                {m.reasons.slice(0, 3).map((r, i) => (
                  <li key={i} className="text-sm text-slate-600">
                    ✨ {tl(r, { liv: tl(`liv.${form.work_type}`), n: m.course.name })}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-8 flex gap-3 justify-center">
          <button
            onClick={() => nav.go("courses")}
            className="px-6 py-3 rounded-xl bg-indigoink-600 hover:bg-indigoink-700 text-white font-semibold transition-colors"
          >
            {t("register.success.matches")}
          </button>
          <button
            onClick={() => {
              setSaved(null);
              setForm(EMPTY);
              setStep(0);
              setMatches([]);
            }}
            className="px-6 py-3 rounded-xl border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50"
          >
            + {t("nav.register")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900">{t("register.title")}</h1>
      <p className="mt-1 text-slate-600">{t("register.subtitle")}</p>

      {/* Stepper */}
      <div className="mt-6 flex items-center gap-2">
        {stepTitles.map((s, i) => (
          <div key={i} className="flex items-center gap-2 flex-1 last:flex-none">
            <div
              className={`w-8 h-8 rounded-full grid place-items-center text-sm font-bold transition-colors ${
                i < step
                  ? "bg-leaf-500 text-white"
                  : i === step
                    ? "bg-indigoink-600 text-white"
                    : "bg-slate-200 text-slate-500"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </div>
            <span className={`text-sm hidden sm:block ${i === step ? "font-semibold text-slate-900" : "text-slate-500"}`}>
              {s}
            </span>
            {i < stepTitles.length - 1 && <div className="flex-1 h-0.5 bg-slate-200 rounded" />}
          </div>
        ))}
      </div>

      {/* Step 0: personal */}
      {step === 0 && (
        <div className="mt-6 space-y-4 fade-up">
          <Field label={t("field.name")}>
            <input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              className="input"
              placeholder="e.g. Sunita"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("field.age")}>
              <input
                type="number"
                min={15}
                max={60}
                value={form.age}
                onChange={(e) => set("age", e.target.value)}
                className="input"
              />
            </Field>
            <Field label={t("field.gender")}>
              <select value={form.gender} onChange={(e) => set("gender", e.target.value as never)} className="input">
                <option value="female">{t("gender.female")}</option>
                <option value="male">{t("gender.male")}</option>
                <option value="other">{t("gender.other")}</option>
              </select>
            </Field>
          </div>
          <Field label={t("field.phone")} hint={t("field.phoneHint")}>
            <input
              inputMode="numeric"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value.replace(/\D/g, "").slice(0, 10))}
              className="input"
              placeholder="98XXXXXXXX"
            />
          </Field>
        </div>
      )}

      {/* Step 1: livelihood & location */}
      {step === 1 && (
        <div className="mt-6 space-y-4 fade-up">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={t("field.state")}>
              <select value={form.state} onChange={(e) => set("state", e.target.value)} className="input">
                {STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("field.district")}>
              <input value={form.district} onChange={(e) => set("district", e.target.value)} className="input" placeholder="Nagpur" />
            </Field>
          </div>
          <Field label={t("field.category")}>
            <select value={form.category} onChange={(e) => set("category", e.target.value as never)} className="input">
              <option value="sc">{t("category.sc")}</option>
              <option value="st">{t("category.st")}</option>
              <option value="obc">{t("category.obc")}</option>
              <option value="gen">{t("category.gen")}</option>
            </select>
          </Field>
          <Field label={t("field.income")} hint={t("common.optional")}>
            <input
              type="number"
              value={form.income}
              onChange={(e) => set("income", e.target.value.replace(/\D/g, "").slice(0, 8))}
              className="input"
              placeholder="72000"
            />
          </Field>
          <Field label={t("register.work.title")} hint={t("register.work.hint")}>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {LIVELIHOOD_IDS.map((id) => (
                <button
                  key={id}
                  onClick={() => set("work_type", id)}
                  className={`rounded-xl border px-2 py-2.5 text-xs font-medium transition-all active:scale-95 ${
                    form.work_type === id
                      ? "border-indigoink-600 bg-indigoink-50 text-indigoink-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {LIV_ICONS[id] ?? "🧑‍🌾"} {tl(`liv.${id}`)}
                </button>
              ))}
            </div>
          </Field>
        </div>
      )}

      {/* Step 2: skills */}
      {step === 2 && (
        <div className="mt-6 space-y-4 fade-up">
          <Field label={t("register.skills.education")}>
            <select value={form.education} onChange={(e) => set("education", e.target.value as never)} className="input">
              {EDUCATION_LEVELS.map((e) => (
                <option key={e} value={e}>
                  {tl(`edu.${e}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("register.skills.known")} hint={t("register.skills.knownHint")}>
            <input
              value={form.skills}
              onChange={(e) => set("skills", e.target.value)}
              className="input"
              placeholder="stitching, farming…"
            />
          </Field>
          <Field label={t("register.skills.interest")}>
            <input
              value={form.interest}
              onChange={(e) => set("interest", e.target.value)}
              className="input"
              placeholder={t("assistant.try.q1")}
            />
          </Field>
          <label className="flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={form.consent}
              onChange={(e) => set("consent", e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-indigoink-600"
            />
            {t("register.consent")}
          </label>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3">
          {t("register.error")}
        </p>
      )}

      {/* Nav buttons */}
      <div className="mt-6 flex gap-3">
        {step > 0 && (
          <button
            onClick={() => setStep(step - 1)}
            className="px-6 py-3 rounded-xl border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50"
          >
            ← {t("register.prev")}
          </button>
        )}
        {step < 2 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={!canNext}
            className="flex-1 px-6 py-3 rounded-xl bg-indigoink-600 hover:bg-indigoink-700 text-white font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("register.next")} →
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!canNext || saving}
            className="flex-1 px-6 py-3 rounded-xl bg-saffron-500 hover:bg-saffron-600 text-white font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? t("common.loading") : t("register.submit")}
          </button>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700">
        {label}
        {hint && <span className="ml-2 text-xs text-slate-400">({hint})</span>}
      </span>
      <span className="block mt-1.5">{children}</span>
    </label>
  );
}

const LIV_ICONS: Partial<Record<LivelihoodId, string>> = {
  farmer: "🌾",
  "agri-labour": "👨‍🌾",
  "handloom-weaver": "🧶",
  tailor: "🧵",
  artisan: "🪵",
  "leather-worker": "👞",
  "construction-labour": "👷",
  "domestic-worker": "🏠",
  "street-vendor": "🛒",
  beautician: "💅",
  mechanic: "🔧",
  electrician: "🔌",
  fisher: "🎣",
  dairy: "🐄",
  "waste-picker": "♻️",
  student: "🎒",
  unemployed: "🔍",
  homemaker: "🏡",
};
