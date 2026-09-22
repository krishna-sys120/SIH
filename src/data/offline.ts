/**
 * Offline support (Phase 18): draft autosave + submission outbox.
 *
 * The interview autosaves a DRAFT after every answer (so a dropped 2G
 * connection never loses progress), and profile submissions are queued in an
 * OUTBOX when offline, then synced when the connection returns. This covers
 * offline DATA CAPTURE — AI processing (extraction/scoring) is local & works
 * offline by design; only Supabase writes and real SMS/IVR need connectivity,
 * and the UI labels that honestly.
 */
import { useEffect, useState } from "react";
import type { Beneficiary } from "./model";

const DRAFT_KEY = "skillsetu.draft";
const OUTBOX_KEY = "skillsetu.outbox";

/** SEC-014: queued submissions expire — stale consent/profiles must not sync weeks later. */
const OUTBOX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface OutboxItem {
  id: string;
  kind: "beneficiary";
  payload: Beneficiary;
  queuedAt: string;
}

export function saveDraft(p: unknown): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(p));
  } catch (e) {
    console.warn("[offline] draft save failed", e);
  }
}

export function loadDraft<T>(): T | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

function readOutbox(): OutboxItem[] {
  try {
    const all = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]") as OutboxItem[];
    const fresh = all.filter((i) => Date.now() - Date.parse(i.queuedAt) < OUTBOX_TTL_MS);
    if (fresh.length !== all.length) writeOutbox(fresh); // prune expired
    return fresh;
  } catch {
    return [];
  }
}

function writeOutbox(list: OutboxItem[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(list.slice(0, 50)));
  } catch (e) {
    console.warn("[offline] outbox save failed", e);
  }
}

export function queueSubmission(kind: "beneficiary", payload: Beneficiary): string {
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    kind,
    // SEC-014 data minimization: the server stamps consent time on receipt
    // (schema sets consent_timestamp = now()); the client copy is stripped so
    // a back-dated claim can never travel with the offline payload.
    payload: { ...payload, consent_timestamp: undefined },
    queuedAt: new Date().toISOString(),
  };
  const list = readOutbox();
  list.push(item);
  writeOutbox(list);
  return item.id;
}

export function outboxCount(): number {
  return readOutbox().length;
}

export async function flushOutbox(
  sender: (payload: Beneficiary) => Promise<string>,
): Promise<{ sent: number; failed: number }> {
  const list = readOutbox();
  let sent = 0;
  let failed = 0;
  const remaining: OutboxItem[] = [];
  for (const item of list) {
    try {
      await sender(item.payload);
      sent++;
    } catch (e) {
      console.warn("[offline] outbox item failed, keeping queued", e);
      failed++;
      remaining.push(item);
    }
  }
  writeOutbox(remaining);
  return { sent, failed };
}

/** React hook: is the app online right now? Re-renders on change. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
