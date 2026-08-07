// /api/layout-settings — per layout on/off overrides for the deck's slide layouts.
//
//   GET  /api/layout-settings                { configured, migrated, disabled: ["harvey_ball", ...] }
//   PUT  /api/layout-settings                { layout, enabled, author? }   upsert one override
//
// Absence of a row means "enabled" (the built in default), so GET only returns the DISABLED
// set — that is also exactly what generation needs to send to the deck service. `title` and
// `agenda` can never be disabled: every deck opens with a cover and the pipeline's safety net
// inserts an agenda slide, so disabling them would just make the tool contradict itself.

import { supabase, dbNotConfigured } from "../../lib/supabase";

const LOCKED = new Set(["title", "agenda"]);

export async function GET() {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, migrated: false, disabled: [] });

  const res = await sb.from("layout_settings").select("layout, enabled").eq("enabled", false);
  if (res.error) return Response.json({ configured: true, migrated: false, disabled: [] });

  return Response.json({
    configured: true,
    migrated: true,
    disabled: res.data.map((r) => r.layout).filter((l) => !LOCKED.has(l)),
  });
}

export async function PUT(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const { layout, enabled, author } = (await req.json()) as {
      layout?: string;
      enabled?: boolean;
      author?: string;
    };
    const key = (layout ?? "").trim();
    if (!key || typeof enabled !== "boolean")
      return Response.json({ error: "layout and enabled are required." }, { status: 400 });
    if (LOCKED.has(key) && !enabled)
      return Response.json(
        { error: "The cover and agenda layouts are required by every deck and cannot be turned off." },
        { status: 400 }
      );

    const up = await sb
      .from("layout_settings")
      .upsert({
        layout: key,
        enabled,
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
