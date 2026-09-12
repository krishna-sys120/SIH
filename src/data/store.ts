import type { Beneficiary, Course } from "./model";
import { COURSE_SEED } from "./courses";
import { hasSupabase, supabase } from "./supabase";
import { addDemoBeneficiary, loadDemoBeneficiaries } from "./demo";

export const usingSupabase = hasSupabase;

/** One enrollment record — same shape in demo (localStorage) and Supabase. */
export interface EnrollmentRow {
  beneficiary_id: string;
  course_id: string;
  at: string;
}

const ENROLL_KEY = "skillsetu.enrollments";

function readDemoEnrollments(): EnrollmentRow[] {
  try {
    return JSON.parse(localStorage.getItem(ENROLL_KEY) ?? "[]") as EnrollmentRow[];
  } catch {
    return [];
  }
}

/** The beneficiary currently acting in this browser (from the last registration), or null. */
export function getCurrentBeneficiaryId(): string | null {
  try {
    const raw = localStorage.getItem("skillsetu.lastId");
    if (!raw) return null;
    const id = JSON.parse(raw) as unknown;
    return typeof id === "string" && id.trim() ? id : null;
  } catch {
    return null;
  }
}

/**
 * Identity used for enrollment writes AND reads — one resolver so the enrolled
 * state always round-trips. Demo mode falls back to a per-browser "local"
 * actor; Supabase mode demands a real registered uuid (null → callers block).
 */
export function resolveActorId(): string | null {
  const id = getCurrentBeneficiaryId();
  if (id) return id;
  return usingSupabase ? null : "local";
}

/**
 * All enrollments — demo: local store; Supabase: the table (pseudonymous ids +
 * timestamps only, safe for the admin dashboard under the schema's RLS).
 */
export async function listEnrollments(): Promise<EnrollmentRow[]> {
  if (hasSupabase && supabase) {
    const { data, error } = await supabase
      .from("enrollments")
      .select("beneficiary_id, course_id, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (!error && data) {
      return data.map((d) => ({
        beneficiary_id: String(d.beneficiary_id),
        course_id: String(d.course_id),
        at: String(d.created_at ?? new Date().toISOString()),
      }));
    }
    if (error) console.warn("[supabase] enrollments fetch failed:", error.message);
  }
  return readDemoEnrollments();
}

/** Course ids the given beneficiary is already enrolled in — the persisted truth. */
export async function listMyEnrollments(beneficiaryId: string): Promise<Set<string>> {
  if (hasSupabase && supabase && beneficiaryId && beneficiaryId !== "local") {
    const { data, error } = await supabase
      .from("enrollments")
      .select("course_id")
      .eq("beneficiary_id", beneficiaryId);
    if (!error && data) return new Set(data.map((d) => String(d.course_id)));
    if (error) console.warn("[supabase] my-enrollments fetch failed:", error.message);
  }
  const mine = readDemoEnrollments().filter((e) => e.beneficiary_id === beneficiaryId);
  return new Set(mine.map((e) => e.course_id));
}

export async function fetchCourses(): Promise<Course[]> {
  if (hasSupabase && supabase) {
    const { data, error } = await supabase
      .from("courses")
      .select("*")
      .order("nsqf_level", { ascending: true });
    if (!error && data && data.length > 0) return data as Course[];
    if (error) console.warn("[supabase] courses fetch failed, using seed:", error.message);
  }
  return COURSE_SEED;
}

export async function fetchBeneficiaries(): Promise<Beneficiary[]> {
  if (hasSupabase && supabase) {
    // Read the PII-free directory view (see supabase/schema.sql) — raw
    // beneficiaries rows are NOT anonymous-readable under the schema's RLS.
    const { data, error } = await supabase
      .from("beneficiary_directory")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (!error && data) return data as unknown as Beneficiary[];
    if (error) console.warn("[supabase] directory fetch failed:", error.message);
  }
  return loadDemoBeneficiaries();
}

export async function saveBeneficiary(b: Beneficiary): Promise<Beneficiary> {
  const rec = { ...b, created_at: new Date().toISOString() };
  if (hasSupabase && supabase) {
    // Table-level SELECT is auth-only under the schema's RLS, so registration
    // goes through this security-definer RPC, which returns just the new uuid.
    const { data, error } = await supabase.rpc("register_beneficiary", {
      p: {
        name: b.name,
        age: b.age,
        gender: b.gender,
        phone: b.phone,
        state: b.state,
        district: b.district,
        category: b.category,
        income: b.income,
        work_type: b.work_type,
        education: b.education,
        skills: b.skills,
        interest: b.interest,
      },
    });
    if (error) throw new Error(error.message);
    return { ...rec, id: data as string };
  }
  addDemoBeneficiary(rec);
  return rec;
}

export async function enrollBeneficiary(beneficiaryId: string, courseId: string): Promise<void> {
  if (hasSupabase && supabase) {
    // enrollments.beneficiary_id is a uuid FK — "local" would hard-fail.
    // Callers resolve via resolveActorId() and surface the no-profile guard.
    if (!beneficiaryId || beneficiaryId === "local") {
      throw new Error("enrollment requires a registered beneficiary (save your profile first)");
    }
    const { error } = await supabase
      .from("enrollments")
      .insert({ beneficiary_id: beneficiaryId, course_id: courseId, status: "enrolled" });
    if (error) throw new Error(error.message);
    await supabase.rpc("decrement_seats", { course: courseId });
    return;
  }
  // Demo mode: persisted local store — single source of truth for enrolled state.
  const list = readDemoEnrollments();
  if (list.some((e) => e.beneficiary_id === beneficiaryId && e.course_id === courseId)) return;
  list.push({ beneficiary_id: beneficiaryId, course_id: courseId, at: new Date().toISOString() });
  try {
    localStorage.setItem(ENROLL_KEY, JSON.stringify(list));
  } catch {
    /* storage full/unavailable — nothing durable to do */
  }
}
