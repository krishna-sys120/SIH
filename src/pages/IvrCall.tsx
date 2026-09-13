import { useState } from "react";
import { useI18n } from "../i18n/context";
import { useIvrCall } from "../voice/useIvrCall";
import { LANGUAGES, type LangCode } from "../i18n/languages";
import ivrConfigJson from "../../supabase/functions/twilio-webhook/ivr-config.json";
import type { IvrConfig } from "../../supabase/functions/_shared/ivr";

const IVR = ivrConfigJson as unknown as IvrConfig;

/**
 * IVR Call demo — place a simulated call to the demo number and drive the
 * caller through the production IVR engine (ivrProcess + ivr-config.json),
 * exactly what the twilio-webhook edge function serves to real Twilio calls.
 * Real dialing needs TWILIO_* secrets + deployed functions: docs/twilio-setup.md.
 */

type Phase = "idle" | "ringing" | "connected" | "ended";

export default function IvrCallPage() {
  const { t } = useI18n();
  const ivr = useIvrCall();
  const [ivrLang, setIvrLang] = useState<LangCode>("en");

  const promptFor = (menuId: string, l: LangCode): string =>
    IVR.menus[menuId]?.prompt[l] ?? IVR.menus[menuId]?.prompt.en ?? "";

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900">
            📞 {t("ivr.title")}
          </h1>
          <p className="mt-1 text-slate-600">{t("ivr.subtitle")}</p>
        </div>
      </div>

      <div className="mt-6 grid lg:grid-cols-2 gap-4 items-start">
        {/* Dialer card */}
        <div className="bg-white rounded-2xl border border-slate-100 card-shadow p-6">
          <div className="flex items-center gap-3">
            <div
              className={`w-14 h-14 rounded-2xl grid place-items-center text-2xl text-white ${
                ivr.phase === "connected"
                  ? "bg-leaf-500 animate-pulse"
                  : ivr.phase === "ringing"
                    ? "bg-amber-500 animate-pulse"
                    : ivr.phase === "ended"
                      ? "bg-slate-400"
                      : "bg-indigoink-600"
              }`}
            >
              📞
            </div>
            <div>
              <div className="font-mono text-lg font-bold text-slate-900">+91 63638 18634</div>
              <div className="text-xs text-slate-500">
                {ivr.phase === "idle" && t("ivr.idle")}
                {ivr.phase === "ringing" && t("ivr.ringing")}
                {ivr.phase === "connected" && `${t("ivr.connected")} · ${fmt(ivr.seconds)} · ${ivr.menu}`}
                {ivr.phase === "ended" && t("ivr.ended")}
              </div>
            </div>
          </div>

          {/* Language + call controls */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <select
              value={ivrLang}
              onChange={(e) => setIvrLang(e.target.value as LangCode)}
              className="input max-w-40"
              aria-label={t("ivr.voiceLang")}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.native} ({l.code.toUpperCase()})
                </option>
              ))}
            </select>
            {ivr.phase === "idle" || ivr.phase === "ended" ? (
              <button
                onClick={() => ivr.call(ivrLang)}
                className="px-5 py-2.5 rounded-xl bg-leaf-600 text-white font-semibold hover:bg-leaf-700"
              >
                📞 {t("ivr.call")}
              </button>
            ) : (
              <button
                onClick={ivr.hangUp}
                className="px-5 py-2.5 rounded-xl bg-rose-600 text-white font-semibold hover:bg-rose-700"
              >
                ⛔ {t("ivr.hangup")}
              </button>
            )}
            <button
              onClick={() => ivr.setMuted(!ivr.muted)}
              className="px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
              title={t("ivr.mute")}
            >
              {ivr.muted ? "🔇" : "🔊"} {t("ivr.mute")}
            </button>
          </div>

          {/* Keypad */}
          <div className={`mt-5 grid grid-cols-3 gap-2 ${ivr.phase !== "connected" ? "opacity-40 pointer-events-none" : ""}`}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((d) => (
              <button
                key={d}
                onClick={() => ivr.press(d)}
                disabled={ivr.phase !== "connected"}
                className="py-3 rounded-xl bg-slate-50 border border-slate-200 text-lg font-bold text-slate-800 hover:bg-indigoink-50 hover:border-indigoink-200 active:scale-95 transition"
              >
                {d}
              </button>
            ))}
          </div>

          <p className="mt-4 text-xs text-slate-400 leading-relaxed">
            {t("ivr.simNote")}
          </p>
        </div>

        {/* Live transcript card */}
        <div className="bg-white rounded-2xl border border-slate-100 card-shadow p-6 min-h-[420px] flex flex-col">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900">{t("ivr.transcript")}</h3>
            <span className="text-xs text-slate-400">
              {ivr.keys.length > 0 && `🔑 ${ivr.keys.join(" → ")}`}
            </span>
          </div>

          {ivr.phase === "idle" && (
            <div className="flex-1 grid place-items-center text-slate-400 text-sm">
              {t("ivr.transcriptIdle")}
            </div>
          )}

          {ivr.phase !== "idle" && (
            <div className="mt-3 flex-1 overflow-y-auto space-y-2 max-h-80">
              {ivr.transcript.map((line, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                    line.who === "ivr"
                      ? "bg-indigoink-50 text-slate-800 rounded-tl-sm"
                      : "bg-leaf-500/10 text-slate-800 rounded-tr-sm ml-auto"
                  }`}
                >
                  <span className="block text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">
                    {line.who === "ivr" ? "IVR" : t("ivr.you")}
                  </span>
                  {line.text}
                </div>
              ))}
              {ivr.phase === "ringing" && (
                <div className="text-xs text-amber-600 animate-pulse">{t("ivr.ringing")}</div>
              )}
            </div>
          )}

          {ivr.phase === "ended" && (
            <p className="mt-3 text-xs text-slate-500">
              ✓ {t("ivr.logged")}
            </p>
          )}
        </div>
      </div>

      {/* Menu map for the selected language */}
      <div className="mt-6 bg-white rounded-2xl border border-slate-100 card-shadow p-5">
        <h3 className="font-bold text-slate-900">{t("ivr.menuMap")}</h3>
        <div className="mt-3 grid md:grid-cols-3 gap-3 text-sm">
          {Object.entries(IVR.menus).map(([id, m]) => (
            <div key={id} className={`rounded-xl border p-3 ${ivr.menu === id && ivr.phase === "connected" ? "border-indigoink-300 bg-indigoink-50" : "border-slate-100 bg-slate-50"}`}>
              <div className="font-mono text-xs text-slate-400">{id}</div>
              <p className="mt-1 text-slate-700 line-clamp-3">{promptFor(id, ivrLang)}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(m.options).map(([k, o]) => (
                  <span key={k} className="text-[11px] bg-white border border-slate-200 rounded-full px-2 py-0.5">
                    {k} → {o.target}
                  </span>
                ))}
              </div>
            </div>
            ))}
        </div>
      </div>
    </div>
  );
}
