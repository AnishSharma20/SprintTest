// /api/custom-studies/[id]
//
//   PATCH   { verified?, akbmRole?, reviewer }   set the review state / Aker BioMarine role
//   DELETE                                        remove the study outright, PDF included
//
// A custom study carries every field on its own row (no PubMed record, no override layer), so
// "verified by science" and the AKBM role are patched here rather than through
// /api/study-assessment, which is keyed by PMID and only covers the built in studies.
//
// Unlike /api/study-removed (a reversible hide-from-page flag over a BUILT IN study), a custom
// study is wholly owned by the team, so a mistaken add is deleted outright.

import { revalidatePath } from "next/cache";
import { supabase, dbNotConfigured } from "../../../lib/supabase";
import { isAkbmRole } from "../../../akbm-role";

const BUCKET = "custom-studies";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  const { id } = await params;
  try {
    const body = (await req.json()) as {
      verified?: boolean;
      akbmRole?: string | null;
      reviewer?: string;
    };
    if (!(body.reviewer ?? "").trim())
      return Response.json(
        { error: "Add your name in the Reviewer field before saving." },
        { status: 400 }
      );

    // Only what the caller sent, so ticking "verified" cannot blank the role and vice versa.
    const patch: Record<string, unknown> = {};
    if (body.verified !== undefined) patch.verified = !!body.verified;
    if (body.akbmRole !== undefined) {
      const role = (body.akbmRole ?? "").trim();
      if (role && !isAkbmRole(role))
        return Response.json({ error: `Unknown Aker BioMarine role "${role}".` }, { status: 400 });
      patch.akbm_role = role || null;
    }
    if (!Object.keys(patch).length)
      return Response.json({ error: "Nothing to save." }, { status: 400 });

    const up = await sb.from("custom_studies").update(patch).eq("id", id).select("*").single();
    if (up.error)
      return Response.json(
        { error: `Could not save. ${up.error.message} (has migration 0016 been run?)` },
        { status: 500 }
      );

    revalidatePath("/");   // the study list is ISR cached, same as the add and delete paths
    return Response.json({ study: up.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

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

  revalidatePath("/");   // same ISR cache as the add path
  return Response.json({ ok: true });
}
