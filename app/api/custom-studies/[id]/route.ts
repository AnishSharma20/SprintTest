// /api/custom-studies/[id] — remove a study a reviewer added manually. Unlike /api/study-removed
// (a reversible hide-from-page flag over a BUILT IN study), a custom study is wholly owned by
// the team, so a mistaken add is deleted outright, PDF included.

import { supabase, dbNotConfigured } from "../../../lib/supabase";

const BUCKET = "custom-studies";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  const { id } = await params;
  const row = await sb.from("custom_studies").select("storage_path").eq("id", id).maybeSingle();
  if (row.error) return Response.json({ error: row.error.message }, { status: 500 });
  if (!row.data) return Response.json({ error: "Study not found." }, { status: 404 });

  const del = await sb.from("custom_studies").delete().eq("id", id);
  if (del.error) return Response.json({ error: del.error.message }, { status: 500 });

  if (row.data.storage_path) await sb.storage.from(BUCKET).remove([row.data.storage_path]);

  return Response.json({ ok: true });
}
