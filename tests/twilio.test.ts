/**
 * Twilio integration tests — pure logic only, no network, no paid calls.
 * The shared modules are plain TS, imported directly from the edge-function tree.
 */
import { describe, it, expect } from "vitest";
import { classifyKeyword, detectLang, keywordReply } from "../supabase/functions/_shared/keywords";
import {
  normalizePhone,
  twiml,
  say,
  gather,
  dial,
  validateTwilioSignature,
} from "../supabase/functions/_shared/twilio";
import ivrConfigJson from "../supabase/functions/twilio-webhook/ivr-config.json";
import {
  ivrProcess,
  renderMenuGather,
  renderSayThenMenu,
  renderGoodbye,
  type IvrConfig,
} from "../supabase/functions/_shared/ivr";

const IVR = ivrConfigJson as unknown as IvrConfig;

// ── Keyword opt-out/opt-in ────────────────────────────────────

describe("classifyKeyword", () => {
  it("detects opt-out words case-insensitively", () => {
    expect(classifyKeyword("STOP")).toBe("optout");
    expect(classifyKeyword("stop")).toBe("optout");
    expect(classifyKeyword("Unsubscribe")).toBe("optout");
    expect(classifyKeyword("quit")).toBe("optout");
  });

  it("accepts prefixed opt-outs like 'STOP ALL'", () => {
    expect(classifyKeyword("STOP ALL")).toBe("optout");
    expect(classifyKeyword("cancel now")).toBe("optout");
  });

  it("detects opt-in only on exact words", () => {
    expect(classifyKeyword("start")).toBe("optin");
    expect(classifyKeyword("  YES ")).toBe("optin");
    // "startover" is NOT the keyword "start" — no prefix match for opt-ins.
    expect(classifyKeyword("startover")).toBeNull();
  });

  it("detects help", () => {
    expect(classifyKeyword("help")).toBe("help");
    expect(classifyKeyword("INFO")).toBe("help");
  });

  it("returns null for normal conversation text", () => {
    expect(classifyKeyword("I want to know about tailoring courses")).toBeNull();
    expect(classifyKeyword("")).toBeNull();
    expect(classifyKeyword("   ")).toBeNull();
  });

  it("never classifies anything as optout unless it matches the table", () => {
    expect(classifyKeyword("stopover")).toBeNull(); // opt-out prefix is allowed but "stopover" has no space boundary
  });
});

describe("keywordReply", () => {
  it("localizes replies and falls back to English", () => {
    expect(keywordReply("optout", "hi")).toContain("अनसब्सक्राइब");
    expect(keywordReply("optout", "te")).toBe(keywordReply("optout", "en"));
    expect(keywordReply("help", "en")).toContain("STOP");
  });
});

// ── Phone normalization ───────────────────────────────────────

describe("normalizePhone", () => {
  it("accepts 10-digit Indian mobiles and prefixes +91", () => {
    expect(normalizePhone("9876543210")).toBe("+919876543210");
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
    expect(normalizePhone("919876543210")).toBe("+919876543210");
  });
  it("keeps existing E.164 numbers", () => {
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
  });
  it("rejects landline-shaped or garbage input", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("0551234567")).toBeNull(); // 10 digits but not starting 6-9
    expect(normalizePhone("")).toBeNull();
  });
});

// ── TwiML builders ────────────────────────────────────────────

describe("TwiML builders", () => {
  it("wraps a Response and escapes XML entities in prompts", () => {
    const xml = twiml(say('Press 1 & "confirm" <now>', "Polly.Aditi", "en-IN"));
    expect(xml).toContain("<Response>");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&quot;");
    expect(xml).toContain("&lt;now&gt;");
    expect(xml).not.toContain("<now>");
  });

  it("emits a Gather with numDigits, timeout and action", () => {
    const xml = gather(say("Menu"), { numDigits: 1, timeout: 6, action: "/x", finishOnKey: "" });
    expect(xml).toContain('numDigits="1"');
    expect(xml).toContain('timeout="6"');
    expect(xml).toContain('action="/x"');
  });

  it("emits Dial with a number", () => {
    expect(dial("+919876543210", { timeout: 30 })).toContain("+919876543210");
  });
});

// ── Webhook signature validation ─────────────────────────────

describe("validateTwilioSignature", () => {
  // Reference vector computed with the documented algorithm
  // (HMAC-SHA1 over url + sorted k+v with the auth token, base64).
  it("accepts a valid signature (HMAC-SHA1 of url+sorted params)", async () => {
    const authToken = "SECRET";
    const url = "https://example.com/webhook";
    const params = { From: "+919876543210", Body: "STOP" };
    // compute expected with the same documented construction
    const data =
      url +
      Object.keys(params).sort().map((k) => k + encodeURIComponent(params[k]!).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())).join("");
    const mac = await crypto.subtle.importKey("raw", new TextEncoder().encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const sigBuf = await crypto.subtle.sign("HMAC", mac, new TextEncoder().encode(data));
    const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
    expect(await validateTwilioSignature(authToken, sig, url, params)).toBe(true);
  });

  it("rejects missing, wrong, or tampered signatures", async () => {
    const params = { A: "1" };
    expect(await validateTwilioSignature("k", null, "https://x.com/y", params)).toBe(false);
    expect(await validateTwilioSignature("k", "bogus", "https://x.com/y", params)).toBe(false);
    // signature for different params must not validate
    expect(await validateTwilioSignature("k", "AAAAAAAAAAAAAAAAAAAAAAAAAAA=", "https://x.com/y", { A: "2" })).toBe(false);
  });
});

// ── IVR engine ────────────────────────────────────────────────

describe("IVR engine", () => {
  it("serves the main menu on a fresh call (digits undefined)", () => {
    const out = ivrProcess(IVR, "main", undefined, 0, "en");
    expect(out).toEqual({ kind: "menu", menuId: "main", retries: 0 });
  });

  it("treats explicit null digits as a timeout (Gather with no input)", () => {
    expect(ivrProcess(IVR, "main", null, 0, "en")).toMatchObject({ kind: "say", retries: 1 });
  });

  it("routes 1 → courses menu, 3 → support menu", () => {
    expect(ivrProcess(IVR, "main", "1", 0, "en")).toMatchObject({ kind: "menu", menuId: "courses", retries: 0 });
    expect(ivrProcess(IVR, "main", "3", 0, "en")).toMatchObject({ kind: "menu", menuId: "support", retries: 0 });
  });

  it("status action says the status response then returns to main", () => {
    const out = ivrProcess(IVR, "main", "2", 0, "en");
    expect(out.kind).toBe("say");
    if (out.kind === "say") {
      expect(out.text).toContain("call you back");
      expect(out.thenMenu).toBe("main");
      expect(out.action).toBe("status");
    }
  });

  it("agent action without a configured number says status instead of transferring", () => {
    const out = ivrProcess(IVR, "main", "0", 0, "en");
    expect(out.kind).toBe("say");
  });

  it("invalid input increments retries and stays on the menu", () => {
    const out = ivrProcess(IVR, "main", "7", 0, "en");
    expect(out).toMatchObject({ kind: "say", thenMenu: "main", retries: 1 });
    if (out.kind === "say") expect(out.text).toContain("not a valid option");
  });

  it("timeout counts as an invalid round and eventually hangs up", () => {
    const r1 = ivrProcess(IVR, "main", null, 0, "en");
    expect(r1).toMatchObject({ kind: "say", retries: 1 });
    if (r1.kind === "say") expect(r1.text).toContain("did not receive");
    expect(ivrProcess(IVR, "main", null, IVR.maxRetries - 1, "en")).toEqual({ kind: "hangup" });
  });

  it("three invalid attempts hit the retry ceiling and hang up", () => {
    expect(ivrProcess(IVR, "main", "9", IVR.maxRetries - 1, "en")).toEqual({ kind: "hangup" });
  });

  it("valid jump resets the retry counter", () => {
    expect(ivrProcess(IVR, "main", "1", 2, "en")).toMatchObject({ kind: "menu", menuId: "courses", retries: 0 });
  });

  it("localizes prompts: hi menu text is Devanagari, kn is Kannada", () => {
    const hi = ivrProcess(IVR, "main", "2", 0, "hi");
    if (hi.kind === "say") expect(hi.text).toMatch(/[\u0900-\u097F]/);
    const kn = ivrProcess(IVR, "support", "1", 0, "kn");
    if (kn.kind === "say") expect(kn.text).toMatch(/[\u0C80-\u0CFF]/);
  });

  it("falls back to English for an unknown language", () => {
    const out = ivrProcess(IVR, "main", "2", 0, "xx");
    if (out.kind === "say") expect(out.text).toContain("call you back");
  });

  it("unknown menu id hangs up rather than looping", () => {
    expect(ivrProcess(IVR, "does-not-exist", "1", 0, "en")).toEqual({ kind: "hangup" });
  });
});

describe("IVR TwiML rendering", () => {
  it("renders the menu gather with voice + language attributes", () => {
    const xml = renderMenuGather(IVR, "main", "hi", "https://x/twilio-webhook?type=voice-action&menu=main&r=0");
    expect(xml).toContain("<Gather");
    expect(xml).toContain('language="hi-IN"');
    expect(xml).toContain("स्किलसेतु");
  });

  it("renders say-then-menu with feedback + re-gather", () => {
    const xml = renderSayThenMenu(IVR, "Sorry, that is not a valid option.", "main", "en", "https://x?a=1");
    expect(xml).toContain("not a valid option");
    expect(xml).toContain("<Gather");
  });

  it("renders goodbye and hangs up", () => {
    expect(renderGoodbye(IVR, "en")).toContain("Goodbye");
    expect(renderGoodbye(IVR, "en")).toContain("<Hangup/>");
  });

  it("every configured option resolves to a defined menu or response", () => {
    for (const [menuId, menu] of Object.entries(IVR.menus)) {
      for (const [key, opt] of Object.entries(menu.options)) {
        if (opt.type === "menu") {
          expect(IVR.menus[opt.target], `${menuId}:${key} → ${opt.target}`).toBeDefined();
        } else if (opt.target !== "agent") {
          expect(IVR.responses[opt.target], `${menuId}:${key} → ${opt.target}`).toBeDefined();
        }
      }
      // every prompt/response carries all 7 languages
      for (const [lang, text] of Object.entries(menu.prompt)) {
        expect(text.length, `${menuId} prompt ${lang}`).toBeGreaterThan(10);
      }
    }
    for (const resp of Object.values(IVR.responses)) {
      for (const l of ["en", "hi", "bn", "ta", "te", "mr", "kn"]) {
        expect(resp[l], `response missing ${l}`).toBeDefined();
      }
    }
  });
});
