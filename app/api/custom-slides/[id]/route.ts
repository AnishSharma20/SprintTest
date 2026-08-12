// /api/custom-slides/[id] — edit, remove (soft) or purge one of the team's own slides.
//
//   PATCH  { name?, description?, mode?, removed?, author? }   removed:false = restore
//   DELETE            soft: marks the slide removed (it lands in Deleted items, restorable)
//   DELETE ?purge=1   permanent: deletes the row, and the stored .pptx when this was the
//                     last slide still pointing at it. Pre-0009 databases (no removed
//                     column) fall through to the permanent path, matching old behaviour.

import { supabase, dbNotConfigured } from "../../../lib/supabase";

const MODES = new Set(["auto", "always", "off"]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;

  try {
    const { name, description, mode, removed, author } = (await req.json()) as {
      name?: string;
      description?: string;
      mode?: string;
      removed?: boolean;
      author?: string;
    };
    const patch: Record<string, unknown> = {
      updated_by: (author ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    };
    if (name !== undefined) {
      const t = name.trim();
      if (!t) return Response.json({ error: "The slide needs a name." }, { status: 400 });
      patch.name = t.slice(0, 80);
    }
    if (description !== undefined) patch.description = description.trim().slice(0, 400);
    if (mode !== undefined) {
      if (!MODES.has(mode)) return Response.json({ error: `Unknown mode "${mode}".` }, { status: 400 });
      patch.mode = mode;
    }
    if (removed !== undefined) patch.removed = removed;

    const upd = await sb
      .from("custom_slides")
      .update(patch)
      .eq("id", id)
      .select("id, file_id, slide_index, name, description, mode, preview_b64, updated_by, updated_at")
      .single();
    if (upd.error) {
      if (removed !== undefined)
        return Response.json(
          { error: "Run migration 0009_deleted_items_and_layout_overrides.sql in the Supabase SQL editor first." },
          { status: 400 }
        );
      return Response.json({ error: upd.error.message }, { status: 500 });
    }
    return Response.json({ slide: upd.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;
  const purge = new URL(req.url).searchParams.get("purge") === "1";

  const row = await sb.from("custom_slides").select("file_id").eq("id", id).maybeSingle();
  if (row.error) return Response.json({ error: row.error.message }, { status: 500 });
  if (!row.data) return Response.json({ error: "Slide not found." }, { status: 404 });

  if (!purge) {
    const soft = await sb
      .from("custom_slides")
      .update({ removed: true, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (!soft.error) return Response.json({ ok: true, removed: true });
    // Pre-0009 (no removed column): fall through to the old hard delete below.
  }

  const del = await sb.from("custom_slides").delete().eq("id", id);
  if (del.error) return Response.json({ error: del.error.message }, { status: 500 });

  // Garbage-collect the uploaded file once nothing references it — the blobs are the heavy part.
  const rest = await sb.from("custom_slides").select("id").eq("file_id", row.data.file_id).limit(1);
  if (!rest.error && rest.data.length === 0) {
    const f = await sb.from("custom_slide_files").select("storage_path").eq("id", row.data.file_id).maybeSingle();
    await sb.from("custom_slide_files").delete().eq("id", row.data.file_id);
    if (f.data?.storage_path) {
      const rm = await sb.storage.from("custom-slides").remove([f.data.storage_path]);
      if (rm.error) console.warn(`custom-slides: could not remove ${f.data.storage_path}: ${rm.error.message}`);
    }
  }
  return Response.json({ ok: true });
}
