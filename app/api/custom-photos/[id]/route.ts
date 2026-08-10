// /api/custom-photos/[id] — edit, toggle, star or remove one of the team's photos.
//
//   PATCH  { name?, description?, enabled?, preferred?, author? }
//   DELETE

import { supabase, dbNotConfigured } from "../../../lib/supabase";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;

  try {
    const { name, description, enabled, preferred, author } = (await req.json()) as {
      name?: string;
      description?: string;
      enabled?: boolean;
      preferred?: boolean;
      author?: string;
    };
    const patch: Record<string, unknown> = {
      updated_by: (author ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    };
    if (name !== undefined) {
      const t = name.trim();
      if (!t) return Response.json({ error: "The photo needs a name." }, { status: 400 });
      patch.name = t.slice(0, 80);
    }
    if (description !== undefined) {
      const t = description.trim();
      if (!t)
        return Response.json(
          { error: "Keep a description — it is how the AI decides when to use the photo." },
          { status: 400 }
        );
      patch.description = t.slice(0, 400);
    }
    if (enabled !== undefined) {
      patch.enabled = enabled;
      if (!enabled) patch.preferred = false; // a switched-off photo cannot be a favourite
    }
    if (preferred !== undefined && patch.preferred === undefined) {
      if (preferred) {
        const willBeEnabled = enabled !== undefined ? enabled : (
          await sb.from("custom_photos").select("enabled").eq("id", id).maybeSingle()
        ).data?.enabled;
        if (willBeEnabled === false)
          return Response.json({ error: "Turn the photo on before starring it." }, { status: 400 });
      }
      patch.preferred = preferred;
    }

    const upd = await sb
      .from("custom_photos")
      .update(patch)
      .eq("id", id)
      .select("id, name, description, enabled, preferred, thumb_b64, updated_by, updated_at")
      .single();
    if (upd.error) return Response.json({ error: upd.error.message }, { status: 500 });
    return Response.json({ photo: upd.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;

  const del = await sb.from("custom_photos").delete().eq("id", id);
  if (del.error) return Response.json({ error: del.error.message }, { status: 500 });
  return Response.json({ ok: true });
}
