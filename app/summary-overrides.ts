// Store for user-edited study summaries.
//
// Now write-through to a SHARED backend (/api/summaries → Supabase) so edits are visible
// to every user and device, not just the editor's browser. localStorage is kept as an
// offline cache and as the fallback when the shared store is not configured yet, and any
// local-only edits are migrated up on first load.
import type { Summary } from "./studies-data";

const KEY = "studySummaryOverrides:v1";
export type Override = { summary: Summary; edited: true; ts: number };

// ── localStorage cache (fallback + offline) ─────────────────────────────────

export function loadLocalOverrides(): Record<string, Override> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "{}") as Record<string, Override>;
  } catch {
    return {};
  }
}

function writeLocal(all: Record<string, Override>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage full / unavailable — ignore */
  }
}

// ── Shared store ────────────────────────────────────────────────────────────

/**
 * Load overrides for the UI. Prefers the shared store; if it is configured, also pushes
 * up any local-only edits the shared store does not have yet (one-time migration).
 * Falls back to localStorage when the shared store is unreachable/unconfigured.
 */
export async function loadOverrides(): Promise<Record<string, Override>> {
  const local = loadLocalOverrides();
  try {
    const res = await fetch("/api/summaries");
    const data = (await res.json()) as {
      configured: boolean;
      overrides: Record<string, Summary>;
    };
    if (!data.configured) return local;

    const shared: Record<string, Override> = {};
    for (const [pmid, summary] of Object.entries(data.overrides)) {
      shared[pmid] = { summary, edited: true, ts: Date.now() };
    }
    // Migrate local-only edits into the shared store.
    for (const [pmid, o] of Object.entries(local)) {
      if (!shared[pmid]) {
        shared[pmid] = o;
        void pushShared(pmid, o.summary);
      }
    }
    writeLocal(shared);
    return shared;
  } catch {
    return local;
  }
}

async function pushShared(pmid: string, summary: Summary): Promise<void> {
  try {
    await fetch("/api/summaries", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pmid, summary }),
    });
  } catch {
    /* offline — the localStorage copy still holds the edit for next sync */
  }
}

/** Save an edit: update the local cache immediately and write through to the shared store. */
export function saveOverride(pmid: string, summary: Summary): Override {
  const all = loadLocalOverrides();
  const o: Override = { summary, edited: true, ts: Date.now() };
  all[pmid] = o;
  writeLocal(all);
  void pushShared(pmid, summary);
  return o;
}
