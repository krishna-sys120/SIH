/**
 * Pure IVR decision engine — no Deno/globals beyond the pure TwiML builders,
 * so it runs unchanged in edge functions AND in vitest.
 *
 * The menu tree comes from ivr-config.json (editable without code changes):
 * prompts and responses are keyed by language code with "en" fallback,
 * options map a digit to either another menu or a terminal action.
 */
import { twiml, say, gather, dial, hangup, redirect } from "./twilio.ts";

export interface IvrVoice {
  voice: string;
  language: string;
}

export interface IvrMenu {
  prompt: Record<string, string>;
  options: Record<string, { type: "menu" | "action"; target: string }>;
}

export interface IvrConfig {
  maxRetries: number;
  inputTimeoutSecs: number;
  voices: Record<string, IvrVoice>;
  menus: Record<string, IvrMenu>;
  responses: Record<string, Record<string, string>>;
  /** <Dial> target for the "agent" action. Missing → agent action hangs up after the status prompt. */
  agentNumber?: string;
}

export type LangCode = string; // "en" | "hi" | "bn" | "ta" | "te" | "mr" | "kn"

export function voiceFor(config: IvrConfig, lang: LangCode): IvrVoice {
  return config.voices[lang] ?? config.voices.en ?? { voice: "Polly.Aditi", language: "en-IN" };
}

/** Prompt text for a language with graceful "en" fallback. */
export function promptFor(map: Record<string, string> | undefined, lang: LangCode): string {
  return map?.[lang] ?? map?.en ?? "";
}

/**
 * What the caller's digit means at this menu. Pure — the edge function turns
 * the outcome into TwiML/REST calls and database writes.
 *
 * digits: undefined = fresh call (serve the menu prompt); "" = Gather timed
 * out with no input; otherwise the pressed keys.
 */
export type IvrOutcome =
  /** Render the gather prompt for this menu (retries reset after a valid jump). */
  | { kind: "menu"; menuId: string; retries: number }
  /** Say a configured response, then continue at a menu. `action` names a side effect. */
  | { kind: "say"; text: string; thenMenu: string; retries: number; action?: string }
  /** Warm transfer to a human agent. */
  | { kind: "transfer"; number: string }
  /** Speak the goodbye and end the call. */
  | { kind: "hangup" };

export function ivrProcess(
  config: IvrConfig,
  menuId: string,
  digits: string | null | undefined,
  retries: number,
  lang: LangCode,
): IvrOutcome {
  const menu = config.menus[menuId];
  if (!menu) return { kind: "hangup" };

  // Fresh call → greet with the menu prompt (no retry consumed).
  if (digits === undefined) return { kind: "menu", menuId, retries: 0 };

  // Timeout or empty input → retry until exhausted.
  if (digits === null || digits === "") {
    if (retries + 1 >= config.maxRetries) return { kind: "hangup" };
    return {
      kind: "say",
      text: promptFor(config.responses.timeout, lang),
      thenMenu: menuId,
      retries: retries + 1,
    };
  }

  const option = menu.options[digits];
  if (!option) {
    if (retries + 1 >= config.maxRetries) return { kind: "hangup" };
    return {
      kind: "say",
      text: promptFor(config.responses.invalid, lang),
      thenMenu: menuId,
      retries: retries + 1,
    };
  }

  if (option.type === "menu") {
    return { kind: "menu", menuId: option.target, retries: 0 };
  }

  // Terminal actions.
  if (option.target === "agent") {
    if (config.agentNumber) return { kind: "transfer", number: config.agentNumber };
    return {
      kind: "say",
      text: promptFor(config.responses.status, lang),
      thenMenu: "main",
      retries: 0,
    };
  }
  return {
    kind: "say",
    text: promptFor(config.responses[option.target], lang),
    thenMenu: "main",
    retries: 0,
    action: option.target,
  };
}

// ── TwiML renderers ───────────────────────────────────────────

function sayIn(config: IvrConfig, lang: LangCode, text: string): string {
  const v = voiceFor(config, lang);
  return say(text, v.voice, v.language);
}

/** Welcome + menu prompt wrapped in a single-digit <Gather>. */
export function renderMenuGather(
  config: IvrConfig,
  menuId: string,
  lang: LangCode,
  actionUrl: string,
): string {
  const menu = config.menus[menuId];
  if (!menu) return renderGoodbye(config, lang);
  return twiml(
    gather(sayIn(config, lang, promptFor(menu.prompt, lang)), {
      numDigits: 1,
      timeout: config.inputTimeoutSecs,
      action: actionUrl,
      finishOnKey: "",
    }),
  );
}

/** Feedback (invalid/timeout/informational) then the next gather — one retry cycle. */
export function renderSayThenMenu(
  config: IvrConfig,
  text: string,
  menuId: string,
  lang: LangCode,
  actionUrl: string,
): string {
  const menu = config.menus[menuId];
  const feedback = sayIn(config, lang, text);
  if (!menu) return twiml(feedback + hangup());
  return twiml(
    feedback +
      gather(sayIn(config, lang, promptFor(menu.prompt, lang)), {
        numDigits: 1,
        timeout: config.inputTimeoutSecs,
        action: actionUrl,
        finishOnKey: "",
      }),
  );
}

/** Human transfer: brief hold prompt then <Dial> (no wrapper, per plan). */
export function renderTransfer(config: IvrConfig, number: string, lang: LangCode): string {
  const hold = promptFor(config.responses.agentConnecting, lang);
  return twiml((hold ? sayIn(config, lang, hold) : "") + dial(number, { timeout: 30 }));
}

export function renderGoodbye(config: IvrConfig, lang: LangCode): string {
  return twiml(sayIn(config, lang, promptFor(config.responses.goodbye, lang)) + hangup());
}

export function renderRedirect(menuId: string, actionUrlBase: string): string {
  return twiml(redirect(`${actionUrlBase}${actionUrlBase.includes("?") ? "&" : "?"}menu=${menuId}`));
}
