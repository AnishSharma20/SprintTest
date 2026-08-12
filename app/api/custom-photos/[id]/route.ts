// /api/custom-photos/[id] — edit, toggle, star, remove (soft) or purge one of the team's photos.
//
//   PATCH  { name?, description?, enabled?, preferred?, removed?, author? }   removed:false = restore
//   DELETE            soft: marks the photo removed (Deleted items, restorable)
//   DELETE ?purge=1   permanent (pre-0009 databases fall through to this, matching old behaviour)

import { supabase, dbNotConfigured } from "../../../lib/supabase";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;

  try {
    const { name, description, enabled, preferred, removed, author } = (await req.json()) as {
      name?: string;
      description?: string;
      enabled?: boolean;
      preferred?: boolean;
      removed?: boolean;
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
    if (removed !== undefined) patch.removed = removed;

    const upd = await sb
      .from("custom_photos")
      .update(patch)
      .eq("id", id)
      .select("id, name, description, enabled, preferred, thumb_b64, updated_by, updated_at")
      .single();
    if (upd.error) {
      if (removed !== undefined)
        return Response.json(
          { error: "Run migration 0009_deleted_items_and_layout_overrides.sql in the Supabase SQL editor first." },
          { status: 400 }
        );
      return Response.json({ error: upd.error.message }, { status: 500 });
    }
    return Response.json({ photo: upd.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;
  const purge = new URL(req.url).searchParams.get("purge") === "1";

  if (!purge) {
    const soft = await sb
      .from("custom_photos")
      .update({ removed: true, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (!soft.error) return Response.json({ ok: true, removed: true });
    // Pre-0009 (no removed column): fall through to the old hard delete below.
  }

  const del = await sb.from("custom_photos").delete().eq("id", id);
  if (del.error) return Response.json({ error: del.error.message }, { status: 500 });
  return Response.json({ ok: true });
}
