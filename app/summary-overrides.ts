// Client-side, per-browser store for user-edited study summaries (localStorage).
// KNOWN LIMITATION (flagged by the user, to be upgraded to a shared DB e.g. Supabase later):
// edits live only in the editor's browser — they are NOT shared with other users or the backend.
import type { Summary } from "./studies-data";

const KEY = "studySummaryOverrides:v1";
export type Override = { summary: Summary; edited: true; ts: number };

export function loadOverrides(): Record<string, Override> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || "{}") as Record<string, Override>;
  } catch {
    return {};
  }
}

export function saveOverride(pmid: string, summary: Summary): Override {
  const all = loadOverrides();
  const o: Override = { summary, edited: true, ts: Date.now() };
  all[pmid] = o;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage full / unavailable — ignore */
  }
  return o;
}
