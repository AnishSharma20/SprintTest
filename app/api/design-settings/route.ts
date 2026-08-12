// /api/design-settings — the deterministic design overrides the renderer enforces.
//
//   GET  { configured, migrated, settings: { title_font?, body_font?, size_title?, size_body?,
//          size_small?, line_spacing?, margin_in?, gutter_in? }, updated_by?, updated_at? }
//   PUT  { settings, author? }   → replace the whole object (only known keys, validated ranges)
//
// One shared row: a design decision applies to everyone's decks, like a brand guide. Empty
// object = pure brand template defaults.

import { supabase, dbNotConfigured } from "../../lib/supabase";
import { brandFromBody, brandFromRequest } from "../../lib/brand";

type Settings = Record<string, string | number | boolean>;

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
const TEXTUAL: Record<string, number> = { title_font: 60, body_font: 60, footer_text: 80 };
const BOOLEAN = new Set(["page_numbers", "date_stamp"]);
// Content-density levels: how eagerly the AI reaches for photos / icons. Enforced in the
// planner prompt + coverage checks (photos) and deterministically in the renderer (icons off).
const LEVELS: Record<string, string[]> = {
  photo_level: ["less", "default", "more"],
  icon_level: ["none", "less", "default"],
};

function clean(input: unknown): { settings?: Settings; error?: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { error: "settings must be an object." };
  const out: Settings = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (k in TEXTUAL) {
      if (typeof v !== "string") return { error: `${k} must be text.` };
      const t = v.trim();
      if (t.length > TEXTUAL[k]) return { error: `${k}: keep it under ${TEXTUAL[k]} characters.` };
      if (t) out[k] = t;
    } else if (k in NUMERIC) {
      const n = Number(v);
      const [lo, hi] = NUMERIC[k];
      if (!Number.isFinite(n)) return { error: `${k} must be a number.` };
      if (n < lo || n > hi) return { error: `${k} must be between ${lo} and ${hi}.` };
      out[k] = n;
    } else if (BOOLEAN.has(k)) {
      if (typeof v !== "boolean") return { error: `${k} must be true or false.` };
      out[k] = v;
    } else if (k in LEVELS) {
      if (typeof v !== "string" || !LEVELS[k].includes(v))
        return { error: `${k} must be one of ${LEVELS[k].join(", ")}.` };
      if (v !== "default") out[k] = v;
    } else {
      return { error: `Unknown setting "${k}".` };
    }
  }
  return { settings: out };
}

export async function GET(req: Request) {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, migrated: false, settings: {} });

  // design_settings' primary key IS the brand: migration 0016 renames the lone 'default' row to
  // 'superba', so no extra column is involved. Both ids are accepted because this code has to work
  // BEFORE that migration is run as well as after — reading only 'superba' on an unmigrated
  // database would silently report the team's design settings as empty, and every deck would
  // quietly lose their overrides instead of showing a setup hint.
  const brand = brandFromRequest(req);
  const ids = brand === "superba" ? ["superba", "default"] : [brand];
  // descending + limit(1): 'superba' sorts after 'default', so the migrated row wins when both
  // exist. maybeSingle() alone would ERROR on two matching rows rather than picking one.
  const res = await sb
    .from("design_settings")
    .select("*")
    .in("id", ids)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
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
    const body = (await req.json()) as { settings?: unknown; author?: string; brand?: string };
    const { settings, author } = body;
    const cleaned = clean(settings ?? {});
    if (cleaned.error) return Response.json({ error: cleaned.error }, { status: 400 });

    const up = await sb
      .from("design_settings")
      .upsert({
        // Writes always use the brand id. On an unmigrated database this inserts a second row
        // ('superba' beside the legacy 'default'); the read above prefers 'superba', so the newer
        // row wins and the legacy one is simply ignored rather than silently resurrected.
        id: brandFromBody(req, body),
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
