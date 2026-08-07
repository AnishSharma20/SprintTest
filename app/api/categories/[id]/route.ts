// /api/categories/[id] — rename or delete one category.
//
//   PATCH  { name }                  rename (the id never changes, so every study and finding
//                                    already pointing at it follows the new name automatically)
//   DELETE ?reassign_to=<id>         delete, moving its findings AND its studies to another
//                                    category of the same parent. Without reassign_to a category
//                                    that is still in use is refused (409) with the counts, so
//                                    nothing is ever silently orphaned.

import { supabase, dbNotConfigured } from "../../../lib/supabase";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;

  try {
    const { name } = (await req.json()) as { name?: string };
    const navn = (name ?? "").trim();
    if (!navn) return Response.json({ error: "A category name is required." }, { status: 400 });

    const all = await sb.from("categories").select("id, name");
    if (all.error) return Response.json({ error: all.error.message }, { status: 500 });
    if (!all.data.some((c) => c.id === id))
      return Response.json({ error: "Category not found." }, { status: 404 });
    if (all.data.some((c) => c.id !== id && c.name.toLowerCase() === navn.toLowerCase()))
      return Response.json({ error: `There is already a category called "${navn}".` }, { status: 409 });

    const upd = await sb.from("categories").update({ name: navn }).eq("id", id).select("*").single();
    if (upd.error) return Response.json({ error: upd.error.message }, { status: 500 });
    return Response.json({ category: upd.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;
  const reassignTo = new URL(req.url).searchParams.get("reassign_to");

  try {
    const all = await sb.from("categories").select("id, parent, name");
    if (all.error) return Response.json({ error: all.error.message }, { status: 500 });
    const category = all.data.find((c) => c.id === id);
    if (!category) return Response.json({ error: "Category not found." }, { status: 404 });

    const claims = await sb.from("claims").select("id").eq("category_id", id);
    if (claims.error) return Response.json({ error: claims.error.message }, { status: 500 });
    const links = await sb.from("study_categories").select("pmid").eq("category_id", id);
    const claimCount = claims.data.length;
    const studyCount = (links.data ?? []).length;

    if (!reassignTo) {
      if (claimCount > 0 || studyCount > 0)
        return Response.json(
          {
            error: `"${category.name}" is still in use. Pick a category to move its content into.`,
            claim_count: claimCount,
            study_count: studyCount,
          },
          { status: 409 }
        );
    } else {
      const target = all.data.find((c) => c.id === reassignTo);
      if (!target) return Response.json({ error: "The category to move into does not exist." }, { status: 400 });
      if (target.id === id) return Response.json({ error: "Pick a different category to move into." }, { status: 400 });
      if (target.parent !== category.parent)
        return Response.json(
          { error: "A category can only be merged into another category of the same kind." },
          { status: 400 }
        );

      // Findings first: the FK on claims.category_id would block the delete otherwise.
      if (claimCount > 0) {
        const moved = await sb.from("claims").update({ category_id: reassignTo }).eq("category_id", id);
        if (moved.error) return Response.json({ error: moved.error.message }, { status: 500 });
      }
      // Then the studies that were explicitly moved here. Upsert (not insert) because a study
      // can already sit in the target category as well, and it must not end up with a duplicate.
      if (studyCount > 0) {
        const rows = (links.data ?? []).map((l) => ({
          pmid: l.pmid,
          category_id: reassignTo,
          updated_at: new Date().toISOString(),
        }));
        const up = await sb.from("study_categories").upsert(rows, { onConflict: "pmid,category_id" });
        if (up.error) return Response.json({ error: up.error.message }, { status: 500 });
      }
    }

    // study_categories rows for this category go with it (ON DELETE CASCADE).
    const del = await sb.from("categories").delete().eq("id", id);
    if (del.error) return Response.json({ error: del.error.message }, { status: 500 });

    return Response.json({ ok: true, moved_claims: reassignTo ? claimCount : 0, moved_studies: reassignTo ? studyCount : 0 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
