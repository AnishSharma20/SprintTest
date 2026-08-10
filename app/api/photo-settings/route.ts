// /api/photo-settings — per BUILT-IN photo on/off overrides + "house favourite" stars.
// Same shape as /api/layout-settings, keyed by the built-in photo id (app/photo-library.json)
// instead of a layout key. The team's OWN uploaded photos have their own enabled/preferred
// columns directly on custom_photos (see /api/custom-photos) — this route only covers the
// built-in library.
//
//   GET  /api/photo-settings   { configured, migrated, disabled: [...], preferred: [...] }
//   PUT  /api/photo-settings   { photo, enabled?, preferred?, author? }   upsert one row
//
// Absence of a row means "enabled, not preferred". A disabled photo is removed from the
// planner's asset_id vocabulary entirely; a preferred one is named to the planner as a house
// favourite among photos that fit equally well. Disabling a photo clears its star.

import { supabase, dbNotConfigured } from "../../lib/supabase";

export async function GET() {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, migrated: false, disabled: [], preferred: [] });

  const res = await sb.from("photo_settings").select("photo_id, enabled, preferred");
  if (res.error) return Response.json({ configured: true, migrated: false, disabled: [], preferred: [] });

  return Response.json({
    configured: true,
    migrated: true,
    disabled: res.data.filter((r) => !r.enabled).map((r) => r.photo_id),
    preferred: res.data.filter((r) => r.enabled && r.preferred).map((r) => r.photo_id),
  });
}

export async function PUT(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const { photo, enabled, preferred, author } = (await req.json()) as {
      photo?: string;
      enabled?: boolean;
      preferred?: boolean;
      author?: string;
    };
    const key = (photo ?? "").trim();
    if (!key || (enabled === undefined && preferred === undefined))
      return Response.json({ error: "photo and enabled and/or preferred are required." }, { status: 400 });

    const existing = await sb.from("photo_settings").select("enabled, preferred").eq("photo_id", key).maybeSingle();
    if (existing.error) return Response.json({ error: existing.error.message }, { status: 500 });

    const nextEnabled = enabled ?? existing.data?.enabled ?? true;
    let nextPreferred = preferred ?? existing.data?.preferred ?? false;
    if (!nextEnabled) nextPreferred = false; // a switched-off photo cannot be a favourite
    if (preferred && !nextEnabled)
      return Response.json({ error: "Turn the photo on before starring it." }, { status: 400 });

    const up = await sb
      .from("photo_settings")
      .upsert({
        photo_id: key,
        enabled: nextEnabled,
        preferred: nextPreferred,
        updated_by: (author ?? "").trim() || null,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (up.error) return Response.json({ error: up.error.message }, { status: 500 });
    return Response.json({ setting: up.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
