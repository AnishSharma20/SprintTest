// /api/layout-settings — per layout on/off overrides, "house favourite" stars, the stronger
// "removed" state (Deleted items) and editable display name/description for BUILT-IN layouts.
//
//   GET  /api/layout-settings   { configured, migrated, starsMigrated, metaMigrated,
//                                 disabled: [...], removed: [...], preferred: [...],
//                                 names: { layout: { display_name, description } } }
//   PUT  /api/layout-settings   { layout, enabled?, preferred?, removed?, display_name?,
//                                 description?, author? }   upsert one row
//
// Absence of a row means "enabled, not preferred, not removed" (the built-in default). A
// disabled layout is removed from the planner's vocabulary entirely; a PREFERRED layout is
// named to the planner as a house favourite; a REMOVED layout leaves the library grid AND the
// planner (it is folded into `disabled` below, so generation needs no extra wiring) but keeps
// its enabled/preferred state for when it is restored from Deleted items. display_name/
// description (null = built-in default) let the team retitle a built-in card from the UI.
// A slide can only be refused here while an enabled STRUCTURE rule requires it (migration 0013,
// and see protectedSlides below) — the cover and agenda are no longer special cases in code, so
// deleting their rule on the Rules tab makes them removable like anything else.

import { supabase, dbNotConfigured } from "../../lib/supabase";
import { brandFromBody, brandFromRequest } from "../../lib/brand";

// Which slides a deck must have is the team's decision now, expressed as structure rules
// (migration 0013). Before 0013 the two that used to be hardcoded keep their protection, so an
// unmigrated database cannot lose a guarantee it still relies on.
const LEGACY_LOCKED = new Set(["title", "agenda"]);

/** Slides an enabled structure rule still requires — these cannot be switched off or removed
 * while that rule stands, because a rule pinning a slide that can never appear is incoherent. */
async function protectedSlides(sb: NonNullable<ReturnType<typeof supabase>>, brand: string): Promise<Set<string>> {
  const res = await sb.from("generation_rules").select("slide_key, action, enabled").eq("brand", brand);
  if (res.error) return LEGACY_LOCKED; // pre-0013: the old pair stays protected
  return new Set(
    res.data
      .filter((r) => r.enabled && r.slide_key && r.action)
      .map((r) => r.slide_key as string)
  );
}

type Row = {
  layout: string;
  enabled: boolean;
  preferred?: boolean;
  removed?: boolean;
  display_name?: string | null;
  description?: string | null;
};

function payload(rows: Row[], flags: { starsMigrated: boolean; metaMigrated: boolean }) {
  const removedSet = new Set(rows.filter((r) => r.removed).map((r) => r.layout));
  return {
    configured: true,
    migrated: true,
    ...flags,
    // Removed layouts fold into `disabled` so generation excludes them with no extra wiring
    // (generation-settings.ts reads only disabled/preferred); the UI un-folds via `removed`.
    disabled: rows.filter((r) => !r.enabled || r.removed).map((r) => r.layout),
    removed: [...removedSet],
    preferred: rows
      .filter((r) => r.enabled && r.preferred && !r.removed)
      .map((r) => r.layout),
    names: Object.fromEntries(
      rows
        .filter((r) => r.display_name || r.description)
        .map((r) => [r.layout, { display_name: r.display_name ?? null, description: r.description ?? null }])
    ),
  };
}

export async function GET(req: Request) {
  const sb = supabase();
  if (!sb)
    return Response.json({ configured: false, migrated: false, disabled: [], removed: [], preferred: [], names: {} });

  const brand = brandFromRequest(req);
  const res = await sb
    .from("layout_settings")
    .select("layout, enabled, preferred, removed, display_name, description")
    .eq("brand", brand);
  if (!res.error) return Response.json(payload(res.data, { starsMigrated: true, metaMigrated: true }));

  // Pre-0009 databases have no removed/display_name/description columns.
  const pre9 = await sb.from("layout_settings").select("layout, enabled, preferred").eq("brand", brand);
  if (!pre9.error) return Response.json(payload(pre9.data, { starsMigrated: true, metaMigrated: false }));

  // Pre-0006 databases have no `preferred` column either; keep the on/off switches working.
  const old = await sb.from("layout_settings").select("layout, enabled").eq("brand", brand).eq("enabled", false);
  if (old.error)
    return Response.json({ configured: true, migrated: false, disabled: [], removed: [], preferred: [], names: {} });
  return Response.json({
    configured: true,
    migrated: true,
    starsMigrated: false,
    metaMigrated: false,
    disabled: old.data.map((r) => r.layout),
    removed: [],
    preferred: [],
    names: {},
  });
}

export async function PUT(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    // Read the body ONCE: a Request body is a stream, so a second req.json() throws.
    const body = (await req.json()) as {
      layout?: string;
      enabled?: boolean;
      preferred?: boolean;
      removed?: boolean;
      display_name?: string;
      description?: string;
      author?: string;
      brand?: string;
    };
    const brand = brandFromBody(req, body);
    const { layout, enabled, preferred, removed, display_name, description, author } = body;
    const key = (layout ?? "").trim();
    const hasMeta = removed !== undefined || display_name !== undefined || description !== undefined;
    if (!key || (enabled === undefined && preferred === undefined && !hasMeta))
      return Response.json({ error: "layout and at least one field to change are required." }, { status: 400 });
    if (enabled === false || removed === true) {
      const protectedKeys = await protectedSlides(sb, brand);
      if (protectedKeys.has(key))
        return Response.json(
          {
            error:
              `A rule on the Rules tab requires the ${key} slide, so it cannot be ` +
              `${removed === true ? "removed" : "turned off"}. Delete that rule first.`,
          },
          { status: 400 }
        );
    }

    const existing = await sb.from("layout_settings").select("enabled, preferred").eq("brand", brand).eq("layout", key).maybeSingle();
    if (existing.error && !`${existing.error.message}`.includes("preferred"))
      return Response.json({ error: existing.error.message }, { status: 500 });

    const nextEnabled = enabled ?? existing.data?.enabled ?? true;
    let nextPreferred = preferred ?? existing.data?.preferred ?? false;
    if (!nextEnabled) nextPreferred = false; // a switched-off layout cannot be a favourite
    if (preferred && !nextEnabled)
      return Response.json({ error: "Turn the layout on before starring it." }, { status: 400 });

    const row: Record<string, unknown> = {
      brand,
      layout: key,
      enabled: nextEnabled,
      preferred: nextPreferred,
      updated_by: (author ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    };
    // Only carry the 0009 columns when the request actually uses them, so a pre-0009 database
    // still handles plain enable/star PUTs exactly as before.
    if (removed !== undefined) row.removed = removed;
    if (display_name !== undefined) row.display_name = display_name.trim().slice(0, 80) || null;
    if (description !== undefined) row.description = description.trim().slice(0, 400) || null;

    const up = await sb.from("layout_settings").upsert(row).select("*").single();
    if (up.error) {
      if (hasMeta)
        return Response.json(
          { error: "Run migration 0009_deleted_items_and_layout_overrides.sql in the Supabase SQL editor first." },
          { status: 400 }
        );
      return Response.json({ error: up.error.message }, { status: 500 });
    }
    return Response.json({ setting: up.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
