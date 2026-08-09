// /api/custom-slides/[id] — edit or remove one of the team's own slides.
//
//   PATCH  { name?, description?, mode?, author? }
//   DELETE                                     also removes the stored .pptx when this was
//                                              the last slide still pointing at it.

import { supabase, dbNotConfigured } from "../../../lib/supabase";

const MODES = new Set(["auto", "always", "off"]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;

  try {
    const { name, description, mode, author } = (await req.json()) as {
      name?: string;
      description?: string;
      mode?: string;
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

    const upd = await sb
      .from("custom_slides")
      .update(patch)
      .eq("id", id)
      .select("id, file_id, slide_index, name, description, mode, preview_b64, updated_by, updated_at")
      .single();
    if (upd.error) return Response.json({ error: upd.error.message }, { status: 500 });
    return Response.json({ slide: upd.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;

  const row = await sb.from("custom_slides").select("file_id").eq("id", id).maybeSingle();
  if (row.error) return Response.json({ error: row.error.message }, { status: 500 });
  if (!row.data) return Response.json({ error: "Slide not found." }, { status: 404 });

  const del = await sb.from("custom_slides").delete().eq("id", id);
  if (del.error) return Response.json({ error: del.error.message }, { status: 500 });

  // Garbage-collect the uploaded file once nothing references it — the blobs are the heavy part.
  const rest = await sb.from("custom_slides").select("id").eq("file_id", row.data.file_id).limit(1);
  if (!rest.error && rest.data.length === 0) {
    await sb.from("custom_slide_files").delete().eq("id", row.data.file_id);
  }
  return Response.json({ ok: true });
}
