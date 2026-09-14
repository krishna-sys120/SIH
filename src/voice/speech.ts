import { useEffect, useState } from "react";

/** Minimal typings for the Web Speech API (not in lib.dom for all TS versions). */
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function isSpeechSupported(): boolean {
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
}

export function isTtsSupported(): boolean {
  return typeof speechSynthesis !== "undefined";
}

export interface ListenHandlers {
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (code: string) => void;
  onEnd?: () => void;
}

/** Start one-shot recognition in the given BCP-47 language. Returns a stop fn. */
export function listenOnce(lang: string, h: ListenHandlers): () => void {
  const rec = getRecognition();
  if (!rec) {
    h.onError?.("unsupported");
    return () => {};
  }
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = "";
  let stopped = false;

  rec.onresult = (ev) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (interim) h.onPartial?.(interim);
    if (finalText) {
      stopped = true;
      h.onFinal(finalText.trim());
    }
  };
  rec.onerror = (ev) => {
    if (!stopped) h.onError?.(ev.error ?? "error");
  };
  rec.onend = () => {
    if (!stopped) h.onEnd?.();
  };

  try {
    rec.start();
  } catch {
    h.onError?.("start-failed");
  }

  return () => {
    stopped = true;
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
  };
}

// ── Voice loading ─────────────────────────────────────────────────────────
// Chromium populates speechSynthesis.getVoices() ASYNCHRONOUSLY — a synchronous
// call right after page load returns []. Without a voice explicitly set for
// non-English languages (hi-IN, kn-IN, …), utterances are dropped silently.
let cachedVoices: SpeechSynthesisVoice[] = [];

function loadVoices(): SpeechSynthesisVoice[] {
  try {
    const v = speechSynthesis.getVoices();
    if (v.length > 0) cachedVoices = v;
    return cachedVoices;
  } catch {
    return cachedVoices;
  }
}

if (typeof speechSynthesis !== "undefined") {
  loadVoices();
  speechSynthesis.addEventListener?.("voiceschanged", () => loadVoices());
}

/** Resolve once voices are available (or after ~1s of retries). */
function ensureVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const v = loadVoices();
    if (v.length > 0) return resolve(v);
    let tries = 0;
    const iv = window.setInterval(() => {
      const voices = loadVoices();
      if (voices.length > 0 || ++tries >= 10) {
        window.clearInterval(iv);
        resolve(voices);
      }
    }, 100);
  });
}

/** React hook: live list of installed TTS voices (updates on voiceschanged). */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => loadVoices());
  useEffect(() => {
    const update = () => setVoices(loadVoices());
    update();
    speechSynthesis?.addEventListener?.("voiceschanged", update);
    return () => speechSynthesis?.removeEventListener?.("voiceschanged", update);
  }, []);
  return voices;
}

/** Pick the best installed voice for a BCP-47 tag (exact match > language match). */
export function findVoiceFor(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const target = lang.toLowerCase();
  const base = lang.slice(0, 2).toLowerCase();
  const norm = (l: string) => l.toLowerCase().replace("_", "-");
  return (
    voices.find((v) => norm(v.lang) === target) ??
    voices.find((v) => norm(v.lang).startsWith(base)) ??
    null
  );
}

/** Speak text aloud in the given language; resolves when done. */
export function speak(text: string, lang: string, rate = 0.95): Promise<void> {
  return ensureVoices().then(
    (voices) =>
      new Promise<void>((resolve) => {
        if (!isTtsSupported() || !text) return resolve();
        // Strip emoji/symbols — some synthesizers read them aloud or glitch out.
        const clean = text
          .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, "")
          .replace(/\s+/g, " ")
          .trim();
        if (!clean) return resolve();

        const u = new SpeechSynthesisUtterance(clean);
        u.lang = lang;
        u.rate = rate;
        u.pitch = 1;
        const voice = findVoiceFor(voices, lang);
        if (voice) u.voice = voice;

        let done = false;
        let guard = 0;
        const finish = () => {
          if (done) return;
          done = true;
          window.clearTimeout(guard);
          resolve();
        };
        u.onend = finish;
        u.onerror = finish;
        // Safety net: resolve even if onend/onerror never fire (seen on Chromium).
        guard = window.setTimeout(finish, 6000 + clean.length * 80);

        // Chromium drops utterances queued in the same tick as cancel() — defer.
        try {
          speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
        window.setTimeout(() => {
          try {
            speechSynthesis.speak(u);
          } catch {
            finish();
          }
        }, 60);
      }),
  );
}

export function stopSpeaking() {
  if (isTtsSupported()) speechSynthesis.cancel();
}
