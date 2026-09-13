import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ivrConfigJson from "../../supabase/functions/twilio-webhook/ivr-config.json";
import {
  ivrProcess,
  voiceFor,
  type IvrConfig,
} from "../../supabase/functions/_shared/ivr";
import type { LangCode } from "../i18n/languages";
import { LANGUAGES } from "../i18n/languages";
import { appendDemoComm } from "../data/comms";

/**
 * IVR Call Simulator — dials a number (simulated) and runs the caller through
 * the SAME ivrProcess engine + ivr-config.json the production Twilio webhook
 * executes. Prompts are spoken with browser TTS in the IVR voice language;
 * keypad input comes from on-screen DTMF keys (real <Gather numDigits=1>
 * semantics: one digit resolves immediately, retries/timeout/hangup included).
 *
 * This is the demo stand-in for a real Twilio REST call — connecting the real
 * path needs TWILIO_* secrets + deployed edge functions (docs/twilio-setup.md).
 */

const IVR = ivrConfigJson as unknown as IvrConfig;

export interface TranscriptLine {
  who: "ivr" | "caller";
  text: string;
}

type Phase = "idle" | "ringing" | "connected" | "ended";

const DEMO_NUMBER = "+916363818634";

export function useIvrCall() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [menu, setMenu] = useState<string>("main");
  const [retries, setRetries] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [keys, setKeys] = useState<string[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [language, setLanguage] = useState<LangCode>("en");
  const [muted, setMuted] = useState(false);

  const startedAt = useRef<number>(0);
  const timers = useRef<number[]>([]);
  /**
   * Epoch guard: bumped on every call, keypress, and hang-up. Callbacks armed
   * by an earlier interaction (post-speech Gather timeouts, TTS end handlers)
   * capture their epoch and no-op if it changed — this is what prevents stale
   * timeouts from double-advancing menus or writing duplicate call records.
   */
  const epoch = useRef(0);
  const endedRef = useRef(false);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }, []);

  const later = useCallback((ms: number, fn: () => void) => {
    const at = epoch.current;
    timers.current.push(
      window.setTimeout(() => {
        if (epoch.current === at) fn();
      }, ms),
    );
  }, []);

  const say = useCallback((text: string) => {
    setTranscript((prev) => [...prev, { who: "ivr", text }]);
  }, []);

  const caller = useCallback((text: string) => {
    setTranscript((prev) => [...prev, { who: "caller", text }]);
  }, []);

  // Duration ticker while connected.
  useEffect(() => {
    if (phase !== "connected") return;
    const iv = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(iv);
  }, [phase]);

  // Cleanup all timers on unmount.
  useEffect(() => clearTimers, [clearTimers]);

  const endCall = useCallback(
    (reason: "completed" | "no-answer") => {
      if (endedRef.current) return; // a call writes exactly one record
      endedRef.current = true;
      epoch.current += 1;
      clearTimers();
      const dur = startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0;
      appendDemoComm({
        channel: "voice",
        direction: "inbound",
        status: reason === "completed" ? "completed" : "failed",
        phone_masked: "••••• 8634",
        duration_secs: reason === "completed" ? dur : null,
        error_code: reason === "no-answer" ? null : null,
        created_at: new Date().toISOString(),
        ivr_keys: keys.length ? keys.join(",") : null,
      });
      setPhase("ended");
    },
    [clearTimers, keys],
  );

  /**
   * Drive the pure engine. `digits` mirrors the webhook exactly:
   * undefined = serve menu, "" = Gather timeout, else pressed keys.
   */
  const step = useCallback(
    (menuId: string, digits: string | null | undefined, r: number) => {
      setMenu(menuId);
      const outcome = ivrProcess(IVR, menuId, digits, r, language);
      const voice = voiceFor(IVR, language);
      const bcp47 = voice.language;
      const at = epoch.current; // interaction this speech belongs to

      const speakOrShow = (text: string, afterMs: number, next: () => void) => {
        say(text);
        if (muted || typeof speechSynthesis === "undefined") {
          later(afterMs, next);
          return;
        }
        const runNext = () => {
          if (epoch.current === at) later(250, next);
        };
        const u = new SpeechSynthesisUtterance(text);
        u.lang = bcp47;
        u.rate = 0.95;
        // Pick the best installed voice; engine falls back to default silently.
        const vs = speechSynthesis.getVoices();
        const v =
          vs.find((x) => x.lang.replace("_", "-").toLowerCase() === bcp47.toLowerCase()) ??
          vs.find((x) => x.lang.toLowerCase().startsWith(bcp47.slice(0, 2).toLowerCase()));
        if (v) u.voice = v;
        u.onend = runNext;
        // Guard if onend never fires.
        const guard = window.setTimeout(runNext, 6000 + text.length * 80);
        u.onerror = () => {
          window.clearTimeout(guard);
          runNext();
        };
        try {
          speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
        window.setTimeout(() => speechSynthesis.speak(u), 60);
      };

      switch (outcome.kind) {
        case "menu": {
          const menuDef = IVR.menus[outcome.menuId];
          const text = (menuDef?.prompt[language] ?? menuDef?.prompt.en) || "";
          speakOrShow(text, 0, () => {
            setRetries(outcome.retries);
            // Simulated Gather timeout: if the caller stays silent for 6s
            // (config inputTimeoutSecs), feed "" exactly like Twilio would.
            const timeoutMs = (IVR.inputTimeoutSecs ?? 6) * 1000;
            const t = window.setTimeout(() => step(outcome.menuId, "", outcome.retries), timeoutMs);
            timers.current.push(t);
          });
          break;
        }
        case "say": {
          speakOrShow(outcome.text, 0, () => {
            setRetries(outcome.retries);
            if (outcome.action) {
              // Side-effect hooks (status etc.) — nothing to do client-side.
            }
            const nextMenu = outcome.thenMenu;
            setMenu(nextMenu);
            const timeoutMs = (IVR.inputTimeoutSecs ?? 6) * 1000;
            const t = window.setTimeout(() => step(nextMenu, "", outcome.retries), timeoutMs);
            timers.current.push(t);
          });
          break;
        }
        case "transfer": {
          const connecting = IVR.responses.agentConnecting?.[language] ?? IVR.responses.agentConnecting?.en ?? "";
          say(`${connecting} (→ ${outcome.number})`);
          endedRef.current = true; // transfer row is written here, not via endCall
          epoch.current += 1;
          clearTimers();
          setPhase("ended");
          // Record as completed with transfer note.
          appendDemoComm({
            channel: "voice",
            direction: "inbound",
            status: "completed",
            phone_masked: "••••• 8634",
            duration_secs: startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0,
            error_code: null,
            created_at: new Date().toISOString(),
            ivr_keys: [...keys, "0"].join(","),
          });
          break;
        }
        case "hangup":
        default: {
          speakOrShow(
            IVR.responses.goodbye?.[language] ?? IVR.responses.goodbye?.en ?? "Goodbye.",
            0,
            () => endCall("completed"),
          );
          break;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, muted, keys, endCall, say, later],
  );

  const press = useCallback(
    (digit: string) => {
      if (phase !== "connected" || endedRef.current) return;
      epoch.current += 1; // invalidates stale speech/timeout callbacks
      clearTimers(); // cancels the pending Gather timeout — input arrived
      setKeys((k) => [...k, digit]);
      caller(`🔑 ${digit}`);
      step(menu, digit, retries);
    },
    [phase, clearTimers, caller, step, menu, retries],
  );

  const call = useCallback(
    (lang: LangCode) => {
      epoch.current += 1;
      endedRef.current = false;
      clearTimers();
      setLanguage(lang);
      setKeys([]);
      setRetries(0);
      setSeconds(0);
      setTranscript([]);
      startedAt.current = Date.now();
      setPhase("ringing");
      // Ring… then connect and serve the main menu (digits=undefined, like a
      // fresh Twilio inbound call hitting the webhook).
      later(1800, () => {
        setPhase("connected");
        step("main", undefined, 0);
      });
    },
    [clearTimers, later, step],
  );

  const hangUp = useCallback(() => {
    if (phase === "idle" || phase === "ended" || endedRef.current) return;
    clearTimers();
    endCall("completed");
  }, [phase, clearTimers, endCall]);

  return {
    phase,
    menu,
    transcript,
    keys,
    seconds,
    language,
    muted,
    setMuted,
    press,
    call,
    hangUp,
    demoNumber: DEMO_NUMBER,
    availableLanguages: LANGUAGES.map((l) => ({ code: l.code, native: l.native })),
  };
}
