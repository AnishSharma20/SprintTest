// /api/photo-settings — per BUILT-IN photo on/off overrides, "house favourite" stars, the
// stronger "removed" state (Deleted items) and editable display name/description.
// Same shape as /api/layout-settings, keyed by the built-in photo id (app/photo-library.json)
// instead of a layout key. The team's OWN uploaded photos have their own columns directly on
// custom_photos (see /api/custom-photos) — this route only covers the built-in library.
//
//   GET  /api/photo-settings   { configured, migrated, metaMigrated, disabled: [...],
//                                removed: [...], preferred: [...], names: {...} }
//   PUT  /api/photo-settings   { photo, enabled?, preferred?, removed?, display_name?,
//                                description?, author? }   upsert one row
//
// Absence of a row means "enabled, not preferred, not removed". A disabled photo is removed
// from the planner's asset_id vocabulary entirely; a REMOVED photo leaves the library grid AND
// the planner (folded into `disabled` below, so generation needs no extra wiring) but keeps
// its state for a restore from Deleted items. Disabling a photo clears its star.

import { supabase, dbNotConfigured } from "../../lib/supabase";
import { brandFromBody, brandFromRequest } from "../../lib/brand";

type Row = {
  photo_id: string;
  enabled: boolean;
  preferred: boolean;
  removed?: boolean;
  display_name?: string | null;
  description?: string | null;
};

function payload(rows: Row[], metaMigrated: boolean) {
  return {
    configured: true,
    migrated: true,
    metaMigrated,
    disabled: rows.filter((r) => !r.enabled || r.removed).map((r) => r.photo_id),
    removed: rows.filter((r) => r.removed).map((r) => r.photo_id),
    preferred: rows.filter((r) => r.enabled && r.preferred && !r.removed).map((r) => r.photo_id),
    names: Object.fromEntries(
      rows
        .filter((r) => r.display_name || r.description)
        .map((r) => [r.photo_id, { display_name: r.display_name ?? null, description: r.description ?? null }])
    ),
  };
}

export async function GET(req: Request) {
  const sb = supabase();
  if (!sb)
    return Response.json({ configured: false, migrated: false, disabled: [], removed: [], preferred: [], names: {} });

  const brand = brandFromRequest(req);
  const res = await sb
    .from("photo_settings")
    .select("photo_id, enabled, preferred, removed, display_name, description")
    .eq("brand", brand);
  if (!res.error) return Response.json(payload(res.data, true));

  // Pre-0009 databases have no removed/display_name/description columns.
  const pre9 = await sb.from("photo_settings").select("photo_id, enabled, preferred").eq("brand", brand);
  if (pre9.error)
    return Response.json({ configured: true, migrated: false, disabled: [], removed: [], preferred: [], names: {} });
  return Response.json(payload(pre9.data, false));
}

export async function PUT(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    // One read only: a Request body is a stream.
    const body = (await req.json()) as {
      brand?: string;
      photo?: string;
      enabled?: boolean;
      preferred?: boolean;
      removed?: boolean;
      display_name?: string;
      description?: string;
      author?: string;
    };
    const { photo, enabled, preferred, removed, display_name, description, author } = body;
    const brand = brandFromBody(req, body);
    const key = (photo ?? "").trim();
    const hasMeta = removed !== undefined || display_name !== undefined || description !== undefined;
    if (!key || (enabled === undefined && preferred === undefined && !hasMeta))
      return Response.json({ error: "photo and at least one field to change are required." }, { status: 400 });

    const existing = await sb.from("photo_settings").select("enabled, preferred").eq("brand", brand).eq("photo_id", key).maybeSingle();
    if (existing.error) return Response.json({ error: existing.error.message }, { status: 500 });

    const nextEnabled = enabled ?? existing.data?.enabled ?? true;
    let nextPreferred = preferred ?? existing.data?.preferred ?? false;
    if (!nextEnabled) nextPreferred = false; // a switched-off photo cannot be a favourite
    if (preferred && !nextEnabled)
      return Response.json({ error: "Turn the photo on before starring it." }, { status: 400 });

    const row: Record<string, unknown> = {
      brand,
      photo_id: key,
      enabled: nextEnabled,
      preferred: nextPreferred,
      updated_by: (author ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    };
    // Only carry the 0009 columns when the request uses them (pre-0009 compatibility).
    if (removed !== undefined) row.removed = removed;
    if (display_name !== undefined) row.display_name = display_name.trim().slice(0, 80) || null;
    if (description !== undefined) row.description = description.trim().slice(0, 400) || null;

    const up = await sb.from("photo_settings").upsert(row).select("*").single();
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
