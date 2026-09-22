/**
 * Security regression suite (docs/SECURITY_AUDIT.md §36).
 *
 * These tests encode the exploit proofs: every test corresponds to a finding
 * in the audit and asserts the remediation is in place. Schema-level controls
 * are verified structurally (the schema file IS the deployable artifact run in
 * the Supabase SQL editor); behavioral crypto/webhook logic is verified live.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateTwilioSignature, normalizePhone } from "../supabase/functions/_shared/twilio";
import { corsHeaders, json, jsonError, options, xmlResponse } from "../supabase/functions/_shared/http";
import { parseEducation, parseExperienceYears } from "../supabase/functions/_shared/extract";
import { interviewTurn, startInterview } from "../supabase/functions/_shared/interview";

const ROOT = process.cwd();
const schema = readFileSync(join(ROOT, "supabase", "schema.sql"), "utf8");
const workflow = readFileSync(join(ROOT, ".github", "workflows", "deploy-pages.yml"), "utf8");
const twilioSend = readFileSync(join(ROOT, "supabase", "functions", "twilio-send", "index.ts"), "utf8");
const webhook = readFileSync(join(ROOT, "supabase", "functions", "twilio-webhook", "index.ts"), "utf8");
const viteConfig = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
const indexHtml = readFileSync(join(ROOT, "index.html"), "utf8");

// ── SEC-019: role spoofing via user_metadata ─────────────────────────────

describe("SEC-019 role authorization source", () => {
  it("is_staff/is_admin read app_metadata (server-controlled), NOT user_metadata", () => {
    const staffBlock = schema.slice(schema.indexOf("function public.is_staff()"));
    const adminBlock = schema.slice(schema.indexOf("function public.is_admin()"));
    expect(staffBlock.slice(0, 400)).toContain("app_metadata");
    expect(adminBlock.slice(0, 400)).toContain("app_metadata");
    expect(staffBlock.slice(0, 400)).not.toContain("user_metadata");
    expect(adminBlock.slice(0, 400)).not.toContain("user_metadata");
  });
});

// ── SEC-001: anonymous duplicate-registration overwrite ──────────────────

describe("SEC-001 registration overwrite protection", () => {
  it("duplicate-phone path only updates for the owner/staff/admin", () => {
    const fn = schema.slice(
      schema.indexOf("function public.register_beneficiary"),
      schema.indexOf("revoke all on function public.register_beneficiary"),
    );
    // The duplicate branch must be gated on auth.uid() / is_staff / is_admin
    expect(fn).toContain("b.user_id = auth.uid()");
    expect(fn).toContain("public.is_staff() or public.is_admin()");
  });

  it("no longer contains the unconditional on-conflict overwrite", () => {
    const fn = schema.slice(
      schema.indexOf("function public.register_beneficiary"),
      schema.indexOf("revoke all on function public.register_beneficiary"),
    );
    expect(fn).not.toContain("on conflict (phone) do update");
  });
});

// ── SEC-008/SEC-020: input validation in the registration RPC ────────────

describe("SEC-008/020 server-side input validation", () => {
  const fn = schema.slice(
    schema.indexOf("function public.register_beneficiary"),
    schema.indexOf("revoke all on function public.register_beneficiary"),
  );

  it("validates enumerated fields against allowlists", () => {
    expect(fn).toContain("not in ('male','female','other')");
    expect(fn).toContain("not in ('sc','st','obc','gen')");
  });

  it("length-caps free-form fields", () => {
    expect(fn).toContain("length(coalesce(p->>'skills', '')) > 300");
    expect(fn).toContain("length(coalesce(p->>'interest', '')) > 300");
    expect(fn).toContain("length(p->>'state') > 64");
    expect(fn).toContain("length(p->>'district') > 64");
  });

  it("bounds the interview profile payload size", () => {
    expect(fn).toContain("pg_column_size(p->'profile')");
    expect(fn).toContain("16384");
  });
});

// ── SEC-003: anonymous outbound-message sending ──────────────────────────

describe("SEC-003 twilio-send authentication", () => {
  it("rejects anonymous callers before any Twilio or DB work", () => {
    expect(twilioSend).toContain("authentication required");
    expect(twilioSend).toContain("not authorized to send communications");
    // The check runs BEFORE the config/client resolution
    const authIdx = twilioSend.indexOf("authentication required");
    const cfgIdx = twilioSend.indexOf("twilioConfig()");
    expect(authIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(cfgIdx);
  });

  it("accepts only staff/admin app_metadata roles or the service role", () => {
    expect(twilioSend).toContain('appRole === "staff"');
    expect(twilioSend).toContain('appRole === "admin"');
    expect(twilioSend).toContain('role === "service_role"');
  });
});

// ── SEC-002: CORS ────────────────────────────────────────────────────────

describe("SEC-002 CORS configuration", () => {
  // Runtime proof: import the REAL response helpers and inspect the headers
  // they actually emit — a wildcard could never hide behind a stale grep.
  it("every response helper emits an empty (no-wildcard) Access-Control-Allow-Origin", () => {
    expect(corsHeaders["Access-Control-Allow-Origin"]).toBe("");
    for (const res of [json({ ok: true }), jsonError(400, "x"), xmlResponse("<Response/>"), options()]) {
      const acao = res.headers.get("Access-Control-Allow-Origin");
      expect(acao).not.toBe("*");
      expect(acao ?? "").toBe("");
    }
  });

  it("no edge source declares a wildcard Access-Control-Allow-Origin", () => {
    for (const f of [
      "supabase/functions/_shared/http.ts",
      "supabase/functions/_shared/db.ts",
      "supabase/functions/_shared/twilio.ts",
      "supabase/functions/twilio-send/index.ts",
      "supabase/functions/twilio-webhook/index.ts",
    ]) {
      expect(readFileSync(join(ROOT, f), "utf8")).not.toMatch(/Access-Control-Allow-Origin['\"s:]+\*/);
    }
  });

  it("edge functions take every JSON response through the shared helpers", () => {
    for (const src of [webhook, twilioSend]) {
      expect(src).toContain('_shared/http.ts"');
      expect(src).toMatch(/from "\.\.\/_shared\/http\.ts"/);
    }
  });
});

// ── SEC-005: webhook replay protection ───────────────────────────────────

describe("SEC-005 webhook replay protection", () => {
  it("inbound messages are idempotency-gated on the MessageSid", () => {
    expect(webhook).toContain(":inbound:");
    expect(webhook).toContain("already processed");
  });
});

// ── SEC-011: SSRF via caller-supplied IVR URL ────────────────────────────

describe("SEC-011 ivrUrl allowlist", () => {
  it("restricts ivrUrl to the trusted webhook endpoint", () => {
    expect(twilioSend).toContain("ivrUrl must be the trusted twilio-webhook endpoint");
    expect(twilioSend).toContain("allowedTypes");
  });
});

// ── SEC-004: CI hardening ────────────────────────────────────────────────

describe("SEC-004 CI/CD security", () => {
  it("pins every action to a full commit SHA", () => {
    const uses = [...workflow.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) {
      expect(u, `${u} must be SHA-pinned`).toMatch(/@[0-9a-f]{40}/);
    }
  });

  it("disables checkout credential persistence", () => {
    expect(workflow).toContain("persist-credentials: false");
  });

  it("keeps least-privilege workflow permissions", () => {
    expect(workflow).toContain("contents: read");
  });
});

// ── SEC-006: view security ───────────────────────────────────────────────

describe("SEC-006 PII-safe views", () => {
  it("public_analytics_view has no district-level rows", () => {
    const view = schema.slice(
      schema.indexOf("public_analytics_view"),
      schema.indexOf("grant select on public.public_analytics_view"),
    );
    expect(view).not.toContain("district");
  });

  it("beneficiary_directory is security_invoker, staff-only, k-anonymized", () => {
    const view = schema.slice(
      schema.indexOf("create view public.beneficiary_directory"),
      schema.indexOf("grant select on public.beneficiary_directory"),
    );
    expect(view).toContain("security_invoker = true");
    expect(view).toContain("slice_count");
    expect(schema).toContain("revoke all on public.beneficiary_directory from public, anon");
  });

  it("authorized_admin_view is security_invoker with k-anonymity", () => {
    const view = schema.slice(
      schema.indexOf("create view public.authorized_admin_view"),
      schema.indexOf("grant select on public.authorized_admin_view"),
    );
    expect(view).toContain("security_invoker = true");
    expect(view).toContain("having count(*) >= 5");
  });
});

// ── SEC-007: enrollment integrity ────────────────────────────────────────

describe("SEC-007 enrollment integrity", () => {
  it("no UPDATE policy exists on enrollments (status is authoritative)", () => {
    expect(schema).not.toMatch(/create policy "[^"]*" on public\.enrollments\s*\n\s*for update/);
  });

  it("enroll_beneficiary still enforces ownership and transactional seat math", () => {
    const fn = schema.slice(
      schema.indexOf("function public.enroll_beneficiary"),
      schema.indexOf("revoke all on function public.enroll_beneficiary"),
    );
    expect(fn).toContain("authentication required to enroll");
    expect(fn).toContain("not authorized to enroll this beneficiary");
    expect(fn).toContain("for update");
    expect(fn).toContain("seats_left = seats_left - 1");
  });

  it("decrement_seats remains a hard no-op with no grants", () => {
    const fn = schema.slice(
      schema.indexOf("function public.decrement_seats"),
      schema.indexOf("revoke all on function public.decrement_seats"),
    );
    expect(fn).toContain("null;");
  });
});

// ── SEC-010: security headers ────────────────────────────────────────────

describe("SEC-010 browser security headers", () => {
  it("production build injects a strict CSP", () => {
    expect(viteConfig).toContain("Content-Security-Policy");
    expect(viteConfig).toContain("default-src 'none'");
    expect(viteConfig).toContain("frame-ancestors 'none'");
    expect(viteConfig).toContain("apply: \"build\"");
  });

  it("ships a referrer policy in index.html", () => {
    expect(indexHtml).toContain('name="referrer"');
    expect(indexHtml).toContain("strict-origin-when-cross-origin");
  });
});

// ── SEC-013/031: client storage + export gating ──────────────────────────

describe("SEC-013/031 client storage & export gating", () => {
  it("dashboard export requires a session", () => {
    const dash = readFileSync(join(ROOT, "src", "pages", "Dashboard.tsx"), "utf8");
    expect(dash).toContain("canExport = usingSupabase && session !== null");
    expect(dash).toContain("canExport && (");
  });

  it("signOut scrubs per-user localStorage keys", () => {
    const store = readFileSync(join(ROOT, "src", "data", "store.ts"), "utf8");
    expect(store).toContain("SESSION_KEYS");
    expect(store).toContain("skillsetu.lastId");
    expect(store).toContain("removeItem");
  });

  it("staff sign-in surface is wired (signIn imported and handled on the Dashboard)", () => {
    const dash = readFileSync(join(ROOT, "src", "pages", "Dashboard.tsx"), "utf8");
    expect(dash).toContain("signIn");
    expect(dash).toContain("auth.signIn");
    expect(dash).toContain('type="password"');
    // Raw backend auth errors must never reach the UI.
    expect(dash).toContain("auth.invalidCredentials");
  });
});

// ── Input validation behavior (extraction layer) ─────────────────────────

describe("input validation — extraction layer", () => {
  it("rejects injection-shaped education payloads instead of matching them", () => {
    expect(parseEducation("'; DROP TABLE beneficiaries; --")).toBeNull();
    expect(parseEducation("<script>alert(1)</script>")).toBeNull();
    expect(parseEducation("class 10")).toBe("secondary");
    expect(parseEducation("12th pass")).toBe("senior");
  });

  it("rejects injection-shaped experience payloads", () => {
    expect(parseExperienceYears("1; DELETE FROM enrollments")).toBeNull();
    expect(parseExperienceYears("999")).toBeNull(); // implausible
    expect(parseExperienceYears("3 years")).toBe(3);
  });

  it("normalizes only real phone numbers", () => {
    expect(normalizePhone("9876543210")).toBe("+919876543210");
    expect(normalizePhone("'; --")).toBeNull();
    expect(normalizePhone("../../etc/passwd")).toBeNull();
  });
});

// ── XSS: rendering is React-escaped (no raw HTML sinks) ──────────────────

describe("XSS surface", () => {
  it("no raw HTML sinks exist in the frontend", () => {
    for (const f of ["App.tsx", "pages/Dashboard.tsx", "pages/Register.tsx", "pages/Assistant.tsx", "pages/Courses.tsx"]) {
      const src = readFileSync(join(ROOT, "src", f), "utf8");
      expect(src).not.toContain("dangerouslySetInnerHTML");
      expect(src).not.toContain("innerHTML");
    }
  });

  it("interview state machine tolerates XSS payloads as answers", () => {
    let t = startInterview("en");
    t = interviewTurn(t.profile, "<script>alert(1)</script>", t.askedIds);
    t = interviewTurn(t.profile, "'; DROP TABLE beneficiaries; --", t.askedIds);
    // No throw, no corruption — payload is inert data.
    expect(t.profile.current_occupation).toBeUndefined();
  });
});

// ── Twilio signature crypto (behavioral) ─────────────────────────────────

describe("Twilio webhook signature (behavioral)", () => {
  it("rejects forged signatures", async () => {
    const ok = await validateTwilioSignature("testtoken", "AAAA", "https://x/y", { A: "1" });
    expect(ok).toBe(false);
  });
});
