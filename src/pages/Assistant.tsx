import { useEffect, useRef, useState } from "react";
import type { Nav } from "../App";
import { useI18n } from "../i18n/context";
import { LANGUAGES } from "../i18n/languages";
import { fetchCourses } from "../data/store";
import { generateReply } from "../ai/reply";
import {
  findVoiceFor,
  isSpeechSupported,
  isTtsSupported,
  listenOnce,
  speak,
  stopSpeaking,
  useVoices,
} from "../voice/speech";
import type { Course, MatchResult } from "../data/model";

interface ChatMsg {
  role: "user" | "bot";
  text: string;
  matches?: MatchResult[];
}

export default function Assistant({ nav }: { nav: Nav }) {
  const { t, tl, lang } = useI18n();
  const bcp47 = LANGUAGES.find((l) => l.code === lang)!.bcp47;
  const supported = isSpeechSupported();
  const voices = useVoices();
  const ttsLang = isTtsSupported() && findVoiceFor(voices, bcp47) === null;
  const langName = LANGUAGES.find((l) => l.code === lang)!.label;

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [voiceReplies, setVoiceReplies] = useState(true);
  const stopRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchCourses().then(setCourses).catch(() => {});
  }, []);

  useEffect(() => {
    if (messages.length === 0 && courses.length > 0) {
      setMessages([{ role: "bot", text: tl("ai.greet") }]);
    }
  }, [courses.length, messages.length, tl]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  useEffect(() => () => stopSpeaking(), []);

  function handleUtterance(text: string) {
    setPartial("");
    setMessages((m) => [...m, { role: "user", text }]);
    setTyping(true);
    // Simulate brief thinking for natural pacing
    setTimeout(() => {
      const reply = generateReply(text, lang, courses);
      setTyping(false);
      setMessages((m) => [...m, { role: "bot", text: reply.text, matches: reply.matches }]);
      if (voiceReplies) speak(reply.text.split("\n")[0], bcp47);
    }, 550);
  }

  function toggleMic() {
    if (listening) {
      stopRef.current?.();
      setListening(false);
      return;
    }
    stopSpeaking();
    setListening(true);
    stopRef.current = listenOnce(bcp47, {
      onPartial: setPartial,
      onFinal: (text) => {
        setListening(false);
        handleUtterance(text);
      },
      onError: () => {
        setListening(false);
        setPartial("");
      },
      onEnd: () => setListening(false),
    });
  }

  function submitTyped(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput("");
    handleUtterance(text);
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-2xl md:text-3xl font-extrabold text-slate-900">{t("assistant.title")}</h1>
      <p className="mt-1 text-slate-600">{t("assistant.subtitle")}</p>

      {!supported && (
        <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3">
          ⚠️ {t("assistant.mic.unsupported")}
        </div>
      )}

      {ttsLang && (
        <div className="mt-4 rounded-xl bg-sky-50 border border-sky-200 text-sky-900 text-sm px-4 py-3">
          ℹ️ {t("assistant.tts.missingVoice").replaceAll("{lang}", langName)}
        </div>
      )}

      {/* Mic orb */}
      <div className="mt-6 flex flex-col items-center">
        <button
          onClick={toggleMic}
          disabled={!supported}
          aria-label={listening ? t("assistant.mic.stop") : t("assistant.mic.start")}
          className={`w-28 h-28 rounded-full grid place-items-center text-white text-4xl transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
            listening
              ? "mic-listening bg-gradient-to-br from-rose-500 to-red-600"
              : "bg-gradient-to-br from-saffron-400 to-saffron-600 hover:brightness-105 card-shadow"
          }`}
        >
          {listening ? "⏹" : "🎙️"}
        </button>
        <p className="mt-3 text-sm font-medium text-slate-600">
          {listening ? (
            <span className="text-rose-600">{t("assistant.mic.listening")}</span>
          ) : (
            t("assistant.mic.start")
          )}
        </p>
        {partial && (
          <p className="mt-1 text-sm italic text-slate-500 max-w-md text-center">“{partial}”</p>
        )}
      </div>

      {/* Chat */}
      <div className="mt-8 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`fade-up flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[85%]">
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-line card-shadow ${
                  m.role === "user"
                    ? "bg-indigoink-600 text-white rounded-br-sm"
                    : "bg-white text-slate-800 rounded-bl-sm border border-slate-100"
                }`}
              >
                <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-60 mb-1">
                  {m.role === "user" ? t("assistant.you") : t("assistant.bot")}
                </span>
                {m.text}
              </div>
              {m.matches && m.matches.length > 0 && (
                <div className="mt-2 grid gap-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {t("assistant.matches.title")}
                  </p>
                  {m.matches.map((match) => (
                    <MiniCourseCard key={match.course.id} match={match} onOpen={() => nav.go("courses")} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {typing && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-100 rounded-2xl rounded-bl-sm px-4 py-3 card-shadow">
              <span className="inline-flex gap-1">
                <Dot delay="0ms" />
                <Dot delay="150ms" />
                <Dot delay="300ms" />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Voice replies toggle */}
      <label className="mt-4 inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={voiceReplies}
          onChange={(e) => {
            setVoiceReplies(e.target.checked);
            if (!e.target.checked) stopSpeaking();
          }}
          className="w-4 h-4 accent-indigoink-600"
        />
        🔊 {t("assistant.voiceToggle")}
      </label>

      {/* Typed input */}
      <form onSubmit={submitTyped} className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("assistant.placeholder")}
          className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigoink-500"
        />
        <button
          type="submit"
          className="px-5 py-3 rounded-xl bg-indigoink-600 hover:bg-indigoink-700 text-white font-medium text-sm transition-colors active:scale-95"
        >
          {t("assistant.send")}
        </button>
      </form>

      {/* Try asking */}
      <div className="mt-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          {t("assistant.try.title")}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["assistant.try.q1", "assistant.try.q2", "assistant.try.q3"] as const).map((q) => (
            <button
              key={q}
              onClick={() => handleUtterance(t(q))}
              className="text-sm bg-white border border-slate-200 hover:border-indigoink-500 hover:text-indigoink-700 rounded-full px-4 py-2 transition-colors"
            >
              {t(q)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="w-2 h-2 rounded-full bg-slate-300 animate-bounce"
      style={{ animationDelay: delay }}
    />
  );
}

function MiniCourseCard({ match, onOpen }: { match: MatchResult; onOpen: () => void }) {
  const { t, tl } = useI18n();
  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-white border border-slate-200 rounded-xl p-3.5 hover:border-indigoink-500 transition-colors card-shadow"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-900 text-sm">{match.course.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {tl(`sec.${match.course.sector}`)} · {t("courses.level")} {match.course.nsqf_level} ·{" "}
            {match.course.duration_months} {t("courses.months")}
          </p>
        </div>
        <span className="shrink-0 text-xs font-bold text-leaf-600 bg-leaf-500/10 rounded-full px-2.5 py-1">
          {match.score}% {t("courses.matchScore")}
        </span>
      </div>
      {match.reasons.length > 0 && (
        <p className="mt-1.5 text-xs text-slate-500">
          ✨ {tl(match.reasons[0], {
            liv: tl(`liv.${match.livelihood ?? "farmer"}`),
          })}
        </p>
      )}
    </button>
  );
}
