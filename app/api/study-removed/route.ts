// /api/study-removed — reviewer removes a study from the Scientific Studies page (and the
// content generator's study picker) without deleting it or any findings grounded in it.
//
//   GET    /api/study-removed                 { configured, migrated, byPmid: { [pmid]: Removed } }
//   PUT    /api/study-removed                  { pmid, reason?, reviewer }   removes it
//   DELETE /api/study-removed?pmid=12345&reviewer=...   restores it
//
// Reversible and attributed, the same override pattern study_quality/study_categories use — the
// base study list (PubMed + curated data) never changes; this is laid over it client side by
// app/study-meta.ts so the removal is visible immediately, same as an edited quality score.

import { revalidatePath } from "next/cache";
import { supabase, dbNotConfigured } from "../../lib/supabase";

export async function GET() {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, migrated: false, byPmid: {} });

  const res = await sb.from("study_removed").select("*");
  // Before migration 0010 the table does not exist — nothing is removed.
  if (res.error) return Response.json({ configured: true, migrated: false, byPmid: {} });

  const byPmid: Record<string, unknown> = {};
  for (const r of res.data)
    byPmid[r.pmid] = { reason: r.reason, removed_by: r.removed_by, removed_at: r.removed_at };
  return Response.json({ configured: true, migrated: true, byPmid });
}

export async function PUT(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const body = (await req.json()) as { pmid?: string; reason?: string; reviewer?: string };
    const pmid = (body.pmid ?? "").trim();
    const reviewer = (body.reviewer ?? "").trim();
    const reason = (body.reason ?? "").trim() || null;

    if (!pmid) return Response.json({ error: "pmid is required." }, { status: 400 });
    if (!reviewer)
      return Response.json({ error: "Add your name in the Reviewer field before removing a study." }, { status: 400 });

    const up = await sb
      .from("study_removed")
      .upsert({ pmid, reason, removed_by: reviewer, removed_at: new Date().toISOString() })
      .select("*")
      .single();
    if (up.error)
      return Response.json(
        { error: `Could not remove the study. ${up.error.message} (has migration 0010 been run?)` },
        { status: 500 }
      );
    return Response.json({ removed: up.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  const { searchParams } = new URL(req.url);
  const pmid = (searchParams.get("pmid") ?? "").trim();
  if (!pmid) return Response.json({ error: "pmid is required." }, { status: 400 });

  const del = await sb.from("study_removed").delete().eq("pmid", pmid);
  if (del.error) return Response.json({ error: del.error.message }, { status: 500 });
  revalidatePath("/");   // same ISR cache as the add path
  return Response.json({ ok: true });
}
