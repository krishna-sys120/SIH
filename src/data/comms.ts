import { useCallback, useEffect, useState } from "react";
import { hasSupabase, supabase } from "./supabase";

/**
 * Unified communication record — from the PII-free comm_overview view in
 * Supabase mode (masked phones, no bodies/uuids), or a demo in-browser store.
 */
export interface CommRow {
  channel: "sms" | "whatsapp" | "voice";
  direction: "inbound" | "outbound";
  status: string;
  phone_masked: string;
  duration_secs: number | null;
  error_code: number | null;
  created_at: string;
  ivr_keys: string | null;
}

const DEMO_KEY = "skillsetu.demoComms";

export function readDemoComms(): CommRow[] {
  try {
    return JSON.parse(localStorage.getItem(DEMO_KEY) ?? "[]") as CommRow[];
  } catch {
    return [];
  }
}

/** Append one record to the demo comms store (used by the IVR call simulator). */
export function appendDemoComm(row: CommRow): void {
  const list = readDemoComms();
  list.unshift(row);
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(list.slice(0, 200)));
  } catch {
    /* ignore */
  }
}

/** Seed a few demo records so the dashboard section isn't empty in demo mode. */
export function seedDemoCommsIfEmpty(): void {
  if (readDemoComms().length > 0) return;
  const now = Date.now();
  const h = 3600_000;
  const demo: CommRow[] = [
    { channel: "sms", direction: "outbound", status: "delivered", phone_masked: "••••• 8241", duration_secs: null, error_code: null, created_at: new Date(now - 3 * h).toISOString(), ivr_keys: null },
    { channel: "sms", direction: "inbound", status: "received", phone_masked: "••••• 8241", duration_secs: null, error_code: null, created_at: new Date(now - 2.5 * h).toISOString(), ivr_keys: null },
    { channel: "whatsapp", direction: "outbound", status: "delivered", phone_masked: "••••• 5120", duration_secs: null, error_code: null, created_at: new Date(now - 5 * h).toISOString(), ivr_keys: null },
    { channel: "voice", direction: "inbound", status: "completed", phone_masked: "••••• 9047", duration_secs: 132, error_code: null, created_at: new Date(now - 26 * h).toISOString(), ivr_keys: "1,2" },
    { channel: "sms", direction: "outbound", status: "failed", phone_masked: "••••• 3388", duration_secs: null, error_code: 21211, created_at: new Date(now - 30 * h).toISOString(), ivr_keys: null },
  ];
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(demo));
  } catch {
    /* ignore */
  }
}

export function useComms(): { rows: CommRow[]; loading: boolean; error: boolean } {
  const [rows, setRows] = useState<CommRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    if (hasSupabase && supabase) {
      const { data, error: e } = await supabase
        .from("comm_overview")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (e) {
        setError(true);
        setRows([]);
      } else {
        setRows((data ?? []) as unknown as CommRow[]);
      }
    } else {
      seedDemoCommsIfEmpty();
      setRows(readDemoComms());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { rows, loading, error };
}
