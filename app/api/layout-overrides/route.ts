// /api/layout-overrides — a BUILT-IN layout whose design the team replaced from an uploaded
// .pptx ("edit the slide" on a standard library card). The design is spliced verbatim into
// generated decks while the AI keeps writing fresh text into its measured slots — see the deck
// service's /slides/inspect-slots (which produced `slots`) and TEAM REDESIGNED layouts there.
//
//   GET    /api/layout-overrides           { configured, migrated, overrides: [...] } (no slots/blobs)
//   GET    /api/layout-overrides?blobs=1   enabled overrides only, adds slots + files
//                                          { file_id: pptx_b64 } — generation time payload.
//   PUT    /api/layout-overrides           { layout, storage_path?, filename?, slide_index?,
//                                            slots?, preview_b64?, enabled?, author? }
//          with storage_path = save a NEW design (inserts a custom_slide_files row, upserts the
//          override, garbage-collects the previous design's file); without = toggle/metadata.
//   DELETE /api/layout-overrides?layout=key  revert to the standard design (file GC'd too).
//
// Override files live in the same custom_slide_files table + `custom-slides` Storage bucket as
// team-slide uploads, but each override always gets its OWN file row (never shared with a
// custom_slides row), so both GC paths stay correct.

import { supabase, dbNotConfigured } from "../../lib/supabase";
import { brandFromBody, brandFromRequest } from "../../lib/brand";
import gallery from "../../layout-gallery.json";

const BUCKET = "custom-slides";
// Fixed structural roles the deck pipeline's deterministic nets write normal fields for —
// mirrored server-side in the deck service (src/overrides.py OVERRIDE_EXCLUDED).
const EXCLUDED = new Set(["title", "agenda", "exec_summary", "ingredient"]);

// The gallery manifest is keyed by brand. This map is only used to answer "is this a real layout
// key, and what kind is it" — a question whose answer is the same for any brand that HAS the key —
// so every brand's entries are folded into one lookup rather than threading a brand through.
const KNOWN = new Map(
  Object.values(gallery as Record<string, { key: string; kind: string }[]>)
    .flat()
    .map((g) => [g.key, g.kind] as const)
);

async function gcFile(sb: NonNullable<ReturnType<typeof supabase>>, fileId: string | null | undefined) {
  if (!fileId) return;
  // An override's file is never shared, but check both referencing tables before deleting.
  const inOverrides = await sb.from("layout_overrides").select("layout").eq("file_id", fileId).limit(1);
  const inSlides = await sb.from("custom_slides").select("id").eq("file_id", fileId).limit(1);
  if (inOverrides.error || inSlides.error) return;
  if (inOverrides.data.length || inSlides.data.length) return;
  const f = await sb.from("custom_slide_files").select("storage_path").eq("id", fileId).maybeSingle();
  await sb.from("custom_slide_files").delete().eq("id", fileId);
  if (f.data?.storage_path) {
    const rm = await sb.storage.from(BUCKET).remove([f.data.storage_path]);
    if (rm.error) console.warn(`layout-overrides: could not remove ${f.data.storage_path}: ${rm.error.message}`);
  }
}

export async function GET(req: Request) {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, migrated: false, overrides: [], files: {} });

  const params = new URL(req.url).searchParams;
  const brand = brandFromRequest(req);

  // ?layout=key&file=1 — stream one override's stored .pptx (the "Download to edit" of an
  // overridden card, so the next edit iterates on the team's current design).
  if (params.get("file") === "1") {
    const key = (params.get("layout") ?? "").trim();
    if (!key) return Response.json({ error: "layout is required." }, { status: 400 });
    const row = await sb.from("layout_overrides").select("file_id").eq("brand", brand).eq("layout", key).maybeSingle();
    if (row.error) return Response.json({ error: row.error.message }, { status: 500 });
    if (!row.data) return Response.json({ error: "No design override exists for this layout." }, { status: 404 });
    const f = await sb.from("custom_slide_files").select("pptx_b64, storage_path").eq("id", row.data.file_id).maybeSingle();
    if (f.error || !f.data) return Response.json({ error: "The stored file is missing." }, { status: 500 });
    let bytes: ArrayBuffer | Buffer;
    if (f.data.pptx_b64) bytes = Buffer.from(f.data.pptx_b64, "base64");
    else {
      const dl = await sb.storage.from(BUCKET).download(f.data.storage_path!);
      if (dl.error) return Response.json({ error: `Could not read the stored file: ${dl.error.message}` }, { status: 500 });
      bytes = await dl.data.arrayBuffer();
    }
    return new Response(bytes as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${key}.pptx"`,
      },
    });
  }

  const withBlobs = params.get("blobs") === "1";
  const res = await sb
    .from("layout_overrides")
    .select(
      withBlobs
        ? "layout, file_id, slide_index, slots, preview_b64, enabled, updated_by, updated_at"
        : "layout, file_id, slide_index, preview_b64, enabled, updated_by, updated_at"
    )
    .eq("brand", brand);
  if (res.error) return Response.json({ configured: true, migrated: false, overrides: [], files: {} });

  const rows = res.data as unknown as { layout: string; file_id: string; enabled: boolean }[];
  const overrides = withBlobs ? rows.filter((o) => o.enabled) : rows;

  let files: Record<string, string> = {};
  if (withBlobs && overrides.length) {
    const ids = [...new Set(overrides.map((o) => o.file_id))];
    const f = await sb.from("custom_slide_files").select("id, pptx_b64, storage_path").in("id", ids);
    if (f.error) return Response.json({ error: f.error.message }, { status: 500 });
    const entries = await Promise.all(
      f.data.map(async (r) => {
        try {
          if (r.pptx_b64) return [r.id, r.pptx_b64] as const;
          if (!r.storage_path) return null;
          const dl = await sb.storage.from(BUCKET).download(r.storage_path);
          if (dl.error) {
            console.warn(`layout-overrides: could not download ${r.storage_path}: ${dl.error.message}`);
            return null;
          }
          const b64 = Buffer.from(await dl.data.arrayBuffer()).toString("base64");
          return [r.id, b64] as const;
        } catch (e) {
          // One blob failing to resolve must never take down generation — the deck service
          // silently drops an override whose file never arrives and renders the standard design.
          console.warn(`layout-overrides: could not resolve blob for file ${r.id}: ${(e as Error).message}`);
          return null;
        }
      })
    );
    files = Object.fromEntries(entries.filter((e): e is readonly [string, string] => e !== null));
  }

  return Response.json({ configured: true, migrated: true, overrides, files });
}

export async function PUT(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const body = (await req.json()) as {
        brand?: string;
        layout?: string;
        storage_path?: string;
        filename?: string;
        slide_index?: number;
        slots?: unknown[];
        preview_b64?: string;
        enabled?: boolean;
        author?: string;
      };
    const { layout, storage_path, filename, slide_index, slots, preview_b64, enabled, author } = body;
    const brand = brandFromBody(req, body);
    const key = (layout ?? "").trim();
    if (!key) return Response.json({ error: "layout is required." }, { status: 400 });
    if (!KNOWN.has(key)) return Response.json({ error: `Unknown layout "${key}".` }, { status: 400 });
    if (EXCLUDED.has(key) || KNOWN.get(key) === "verbatim")
      return Response.json(
        { error: "This slide has a fixed role in every deck and its design can't be replaced." },
        { status: 400 }
      );

    const by = (author ?? "").trim() || null;
    const existing = await sb.from("layout_overrides").select("layout, file_id, enabled").eq("brand", brand).eq("layout", key).maybeSingle();
    if (existing.error) {
      const msg = `${existing.error.message}`;
      if (msg.includes("layout_overrides"))
        return Response.json(
          { error: "Run migration 0009_deleted_items_and_layout_overrides.sql in the Supabase SQL editor first." },
          { status: 400 }
        );
      return Response.json({ error: msg }, { status: 500 });
    }

    if (!storage_path) {
      // Toggle/metadata update on an existing override.
      if (!existing.data) return Response.json({ error: "No design override exists for this layout." }, { status: 404 });
      const upd = await sb
        .from("layout_overrides")
        .update({
          ...(enabled !== undefined ? { enabled } : {}),
          updated_by: by,
          updated_at: new Date().toISOString(),
        })
        .eq("layout", key)
        .select("layout, file_id, slide_index, preview_b64, enabled, updated_by, updated_at")
        .single();
      if (upd.error) return Response.json({ error: upd.error.message }, { status: 500 });
      return Response.json({ override: upd.data });
    }

    if (!Array.isArray(slots) || slots.length === 0)
      return Response.json(
        { error: "The design analysis (slots) is missing — upload the file through the Edit flow." },
        { status: 400 }
      );

    const fileId = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    const file = await sb.from("custom_slide_files").insert({
      id: fileId,
      filename: (filename ?? `${key}.pptx`).slice(0, 120),
      storage_path,
      created_by: by,
    });
    if (file.error) return Response.json({ error: file.error.message }, { status: 500 });

    const up = await sb
      .from("layout_overrides")
      .upsert({
        brand,
        layout: key,
        file_id: fileId,
        slide_index: Number.isInteger(slide_index) ? slide_index : 0,
        slots,
        preview_b64: preview_b64 ?? null,
        enabled: enabled ?? true,
        ...(existing.data ? {} : { created_by: by }),
        updated_by: by,
        updated_at: new Date().toISOString(),
      })
      .select("layout, file_id, slide_index, preview_b64, enabled, updated_by, updated_at")
      .single();
    if (up.error) {
      await sb.from("custom_slide_files").delete().eq("id", fileId); // don't orphan the new blob
      return Response.json({ error: up.error.message }, { status: 500 });
    }

    // Garbage-collect the previous design's file now that nothing points at it.
    if (existing.data?.file_id && existing.data.file_id !== fileId) await gcFile(sb, existing.data.file_id);

    return Response.json({ override: up.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  const key = (new URL(req.url).searchParams.get("layout") ?? "").trim();
  const brand = brandFromRequest(req);
  if (!key) return Response.json({ error: "layout is required." }, { status: 400 });

  const existing = await sb.from("layout_overrides").select("layout, file_id").eq("brand", brand).eq("layout", key).maybeSingle();
  if (existing.error) return Response.json({ error: existing.error.message }, { status: 500 });
  if (!existing.data) return Response.json({ error: "No design override exists for this layout." }, { status: 404 });

  const del = await sb.from("layout_overrides").delete().eq("brand", brand).eq("layout", key);
  if (del.error) return Response.json({ error: del.error.message }, { status: 500 });
  await gcFile(sb, existing.data.file_id);
  return Response.json({ ok: true });
}
