// /api/layout-settings — per layout on/off overrides + "house favourite" stars.
//
//   GET  /api/layout-settings   { configured, migrated, disabled: [...], preferred: [...] }
//   PUT  /api/layout-settings   { layout, enabled?, preferred?, author? }   upsert one row
//
// Absence of a row means "enabled, not preferred" (the built in default). A disabled layout
// is removed from the planner's vocabulary entirely; a PREFERRED layout is named to the
// planner as a house favourite to pick when several layouts fit equally well. Disabling a
// layout clears its star. `title` and `agenda` can never be disabled: every deck opens with
// a cover and the pipeline's safety net inserts an agenda slide.

import { supabase, dbNotConfigured } from "../../lib/supabase";

const LOCKED = new Set(["title", "agenda"]);

export async function GET() {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, migrated: false, disabled: [], preferred: [] });

  const res = await sb.from("layout_settings").select("layout, enabled, preferred");
  if (res.error) {
    // Pre-0006 databases have no `preferred` column; keep the on/off switches working there.
    const old = await sb.from("layout_settings").select("layout, enabled").eq("enabled", false);
    if (old.error) return Response.json({ configured: true, migrated: false, disabled: [], preferred: [] });
    return Response.json({
      configured: true,
      migrated: true,
      starsMigrated: false,
      disabled: old.data.map((r) => r.layout).filter((l) => !LOCKED.has(l)),
      preferred: [],
    });
  }

  return Response.json({
    configured: true,
    migrated: true,
    starsMigrated: true,
    disabled: res.data.filter((r) => !r.enabled).map((r) => r.layout).filter((l) => !LOCKED.has(l)),
    preferred: res.data.filter((r) => r.enabled && r.preferred).map((r) => r.layout),
  });
}

export async function PUT(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const { layout, enabled, preferred, author } = (await req.json()) as {
      layout?: string;
      enabled?: boolean;
      preferred?: boolean;
      author?: string;
    };
    const key = (layout ?? "").trim();
    if (!key || (enabled === undefined && preferred === undefined))
      return Response.json({ error: "layout and enabled and/or preferred are required." }, { status: 400 });
    if (LOCKED.has(key) && enabled === false)
      return Response.json(
        { error: "The cover and agenda layouts are required by every deck and cannot be turned off." },
        { status: 400 }
      );

    const existing = await sb.from("layout_settings").select("enabled, preferred").eq("layout", key).maybeSingle();
    if (existing.error && !`${existing.error.message}`.includes("preferred"))
      return Response.json({ error: existing.error.message }, { status: 500 });

    const nextEnabled = enabled ?? existing.data?.enabled ?? true;
    let nextPreferred = preferred ?? existing.data?.preferred ?? false;
    if (!nextEnabled) nextPreferred = false; // a switched-off layout cannot be a favourite
    if (preferred && !nextEnabled)
      return Response.json({ error: "Turn the layout on before starring it." }, { status: 400 });

    const up = await sb
      .from("layout_settings")
      .upsert({
        layout: key,
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
