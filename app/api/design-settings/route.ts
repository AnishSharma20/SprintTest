// /api/design-settings — the deterministic design overrides the renderer enforces.
//
//   GET  { configured, migrated, settings: { title_font?, body_font?, size_title?, size_body?,
//          size_small?, line_spacing?, margin_in?, gutter_in? }, updated_by?, updated_at? }
//   PUT  { settings, author? }   → replace the whole object (only known keys, validated ranges)
//
// One shared row: a design decision applies to everyone's decks, like a brand guide. Empty
// object = pure brand template defaults.

import { supabase, dbNotConfigured } from "../../lib/supabase";

type Settings = Record<string, string | number>;

// Known keys with validation. Ranges are deliberately tight — this is a brand tool, not a
// free-for-all: sizes stay readable, spacing stays sane, and anything outside is rejected
// with a message rather than silently clamped.
const NUMERIC: Record<string, [number, number]> = {
  size_title: [14, 40],
  size_body: [9, 24],
  size_small: [8, 18],
  line_spacing: [0.8, 2.0],
  margin_in: [0.2, 1.5],
  gutter_in: [0.1, 1.0],
};
const TEXTUAL = new Set(["title_font", "body_font"]);

function clean(input: unknown): { settings?: Settings; error?: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { error: "settings must be an object." };
  const out: Settings = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (TEXTUAL.has(k)) {
      if (typeof v !== "string") return { error: `${k} must be text.` };
      const t = v.trim();
      if (t.length > 60) return { error: `${k}: keep the font name under 60 characters.` };
      if (t) out[k] = t;
    } else if (k in NUMERIC) {
      const n = Number(v);
      const [lo, hi] = NUMERIC[k];
      if (!Number.isFinite(n)) return { error: `${k} must be a number.` };
      if (n < lo || n > hi) return { error: `${k} must be between ${lo} and ${hi}.` };
      out[k] = n;
    } else {
      return { error: `Unknown setting "${k}".` };
    }
  }
  return { settings: out };
}

export async function GET() {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, migrated: false, settings: {} });

  const res = await sb.from("design_settings").select("*").eq("id", "default").maybeSingle();
  if (res.error) return Response.json({ configured: true, migrated: false, settings: {} });

  return Response.json({
    configured: true,
    migrated: true,
    settings: res.data?.settings ?? {},
    updated_by: res.data?.updated_by ?? null,
    updated_at: res.data?.updated_at ?? null,
  });
}

export async function PUT(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const { settings, author } = (await req.json()) as { settings?: unknown; author?: string };
    const cleaned = clean(settings ?? {});
    if (cleaned.error) return Response.json({ error: cleaned.error }, { status: 400 });

    const up = await sb
      .from("design_settings")
      .upsert({
        id: "default",
        settings: cleaned.settings,
        updated_by: (author ?? "").trim() || null,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (up.error) return Response.json({ error: up.error.message }, { status: 500 });
    return Response.json({ settings: up.data.settings });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
