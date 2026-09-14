/**
 * Adaptive interview orchestrator (browser side) — drives the pure interview
 * state machine with voice I/O, autosaves drafts offline, and produces the
 * final structured profile. UI language and voice conversation language are
 * independent (Phase 5).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  startInterview,
  interviewTurn,
  profileCompleteness,
  type InterviewTurn,
} from "../../supabase/functions/_shared/interview";
import type { LivelihoodProfile } from "../../supabase/functions/_shared/extract";
import { listenOnce, speak, stopSpeaking } from "./speech";
import { saveDraft, clearDraft } from "../data/offline";

export type InterviewState = "idle" | "asking" | "listening" | "thinking" | "ready";

export interface ChatTurn {
  who: "bot" | "user";
  /** Pre-translated text (UI layer renders i18n before pushing here). */
  text: string;
}

export interface UseInterview {
  state: InterviewState;
  chat: ChatTurn[];
  partial: string;
  profile: LivelihoodProfile | null;
  completeness: number;
  /** i18n key of the currently active question (or null when ready). */
  activeQuestion: string | null;
  start: () => void;
  answer: (text: string) => void;
  reset: () => void;
  stop: () => void;
  listening: boolean;
  toggleMic: () => void;
}

export function useInterview(
  lang: string,
  opts: {
    speakEnabled: boolean;
    bcp47: string;
    /** Speech rate (1 = normal, 0.7 = slow — Phase 19 accessibility). */
    rate?: number;
    q: (key: string, vars?: Record<string, string | number>) => string;
  },
): UseInterview {
  const [state, setState] = useState<InterviewState>("idle");
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [partial, setPartial] = useState("");
  const [turn, setTurn] = useState<InterviewTurn | null>(null);
  const [listening, setListening] = useState(false);
  const stopListenRef = useRef<(() => void) | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const say = useCallback((text: string) => {
    setChat((c) => [...c, { who: "bot", text }]);
    if (optsRef.current.speakEnabled) {
      void speak(text, optsRef.current.bcp47, optsRef.current.rate ?? 0.95);
    }
  }, []);

  const start = useCallback(() => {
    stopSpeaking();
    const t = startInterview(lang);
    setTurn(t);
    setChat([]);
    setState("asking");
    saveDraft({ startedAt: new Date().toISOString() });
    say(optsRef.current.q("q.work"));
  }, [lang, say]);

  const answer = useCallback(
    (text: string) => {
      if (!turn || state === "ready") return;
      setChat((c) => [...c, { who: "user", text }]);
      setState("thinking");
      // Deterministic extraction is fast; small delay keeps UX natural.
      window.setTimeout(() => {
        // The engine owns the asked-set; hand its state back each turn.
        const next = interviewTurn(turn.profile, text, turn.askedIds ?? []);
        setTurn(next);
        setPartial("");
        if (next.complete) {
          setState("ready");
          clearDraft();
          say(optsRef.current.q("interview.done"));
        } else if (next.asked.length > 0) {
          setState("asking");
          say(optsRef.current.q(next.asked[0]));
        } else {
          setState("ready");
          clearDraft();
          say(optsRef.current.q("interview.done"));
        }
        for (const f of next.followUps) say(optsRef.current.q(f));
      }, 420);
    },
    [turn, state, say],
  );

  const stop = useCallback(() => {
    stopListenRef.current?.();
    setListening(false);
    stopSpeaking();
  }, []);

  const reset = useCallback(() => {
    stop();
    setTurn(null);
    setChat([]);
    setState("idle");
  }, [stop]);

  // Mic handling lives here so the page stays declarative.
  const toggleMic = useCallback(() => {
    if (listening) {
      stopListenRef.current?.();
      setListening(false);
      return;
    }
    stopSpeaking();
    setListening(true);
    setState("listening");
    stopListenRef.current = listenOnce(optsRef.current.bcp47, {
      onPartial: setPartial,
      onFinal: (text) => {
        setListening(false);
        answer(text);
      },
      onError: () => {
        setListening(false);
        setState("asking");
      },
      onEnd: () => setListening(false),
    });
  }, [listening, answer]);

  useEffect(() => () => stop(), [stop]);

  return {
    state,
    chat,
    partial,
    profile: turn?.profile ?? null,
    completeness: turn ? profileCompleteness(turn.profile) : 0,
    activeQuestion: turn?.asked[0] ?? null,
    start,
    answer,
    reset,
    stop,
    listening,
    toggleMic,
  };
}
