// /api/rules/[id] — edit, toggle or delete one generation rule.
//
//   PATCH  { text?, enabled?, author? }   change the wording and/or flip enabled
//   DELETE                                remove the rule outright

import { supabase, dbNotConfigured } from "../../../lib/supabase";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;

  try {
    const { text, enabled, author } = (await req.json()) as {
      text?: string;
      enabled?: boolean;
      author?: string;
    };
    const patch: Record<string, unknown> = {
      updated_by: (author ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    };
    if (text !== undefined) {
      const t = text.trim();
      if (!t) return Response.json({ error: "The rule text is empty." }, { status: 400 });
      if (t.length > 500)
        return Response.json({ error: "Keep a rule under 500 characters." }, { status: 400 });
      patch.text = t;
    }
    if (enabled !== undefined) patch.enabled = enabled;

    const upd = await sb.from("generation_rules").update(patch).eq("id", id).select("*").single();
    if (upd.error) return Response.json({ error: upd.error.message }, { status: 500 });
    return Response.json({ rule: upd.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;

  const del = await sb.from("generation_rules").delete().eq("id", id);
  if (del.error) return Response.json({ error: del.error.message }, { status: 500 });
  return Response.json({ ok: true });
}
