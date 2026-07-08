// Small server-side helpers shared by the claims API routes.

import type { SupabaseClient } from "@supabase/supabase-js";

export type StudyMeta = {
  pmid: string;
  doi?: string | null;
  title: string;
  authors?: string | null;
  year?: string | number | null;
  journal?: string | null;
  verification?: "curated" | "ai";
};

/** Find a study by pmid, creating it from the provided metadata if missing. Returns the row id. */
export async function getOrCreateStudy(sb: SupabaseClient, meta: StudyMeta): Promise<string> {
  const existing = await sb.from("studies").select("id").eq("pmid", meta.pmid).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data.id;

  const year = meta.year ? parseInt(String(meta.year), 10) || null : null;
  const inserted = await sb
    .from("studies")
    .insert({
      pmid: meta.pmid,
      doi: meta.doi ?? null,
      title: meta.title,
      authors: meta.authors ?? null,
      year,
      journal: meta.journal ?? null,
      verification: meta.verification ?? "ai",
    })
    .select("id")
    .single();
  if (inserted.error) throw new Error(inserted.error.message);
  return inserted.data.id;
}

export async function logEvent(
  sb: SupabaseClient,
  claimId: string,
  actor: string,
  fromStatus: string | null,
  toStatus: string,
  note?: string
): Promise<void> {
  await sb.from("claim_events").insert({
    claim_id: claimId,
    actor,
    from_status: fromStatus,
    to_status: toStatus,
    note: note ?? null,
  });
}
