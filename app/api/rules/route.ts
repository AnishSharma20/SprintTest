// /api/rules — the team's own deck generation rules (managed on the About page).
//
//   GET  /api/rules   { configured, rules: [{ id, text, enabled, ... }] }
//   POST /api/rules   { text, author? }  → create (enabled by default)
//
// Every ENABLED rule is fetched by the generator pages at generation time and threaded to
// the deck service, which injects them into the planner's system prompt. The table only
// exists once migration 0004 has been run; until then GET reports `migrated: false` so the
// About page can render read-only with a setup hint instead of erroring.

import { supabase, dbNotConfigured } from "../../lib/supabase";

export async function GET() {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, migrated: false, rules: [] });

  const res = await sb
    .from("generation_rules")
    .select("*")
    .order("sort_order")
    .order("id");
  if (res.error) return Response.json({ configured: true, migrated: false, rules: [] });

  return Response.json({ configured: true, migrated: true, rules: res.data });
}

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const { text, author } = (await req.json()) as { text?: string; author?: string };
    const t = (text ?? "").trim();
    if (!t) return Response.json({ error: "The rule text is empty." }, { status: 400 });
    if (t.length > 500)
      return Response.json({ error: "Keep a rule under 500 characters." }, { status: 400 });

    const existing = await sb.from("generation_rules").select("sort_order");
    if (existing.error) return Response.json({ error: existing.error.message }, { status: 500 });
    const sortOrder = Math.max(0, ...existing.data.map((r) => r.sort_order ?? 0)) + 1;

    const ins = await sb
      .from("generation_rules")
      .insert({ text: t, created_by: (author ?? "").trim() || null, sort_order: sortOrder })
      .select("*")
      .single();
    if (ins.error) return Response.json({ error: ins.error.message }, { status: 500 });
    return Response.json({ rule: ins.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
