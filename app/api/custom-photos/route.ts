// /api/custom-photos — the team's own photo library for generated decks.
//
//   GET  /api/custom-photos            { configured, migrated, photos: [...] }  (thumbs only)
//   GET  /api/custom-photos?blobs=1    adds image_b64 for ENABLED photos — used by the
//                                      generator pages to ship them to the deck service.
//   POST /api/custom-photos            { name, description, image_b64, thumb_b64?, author? }
//
// Images arrive already downscaled by the About page (long edge ~1800 px JPEG), so one photo
// is a few hundred KB — well inside request limits and the generation payload budget.

import { supabase, dbNotConfigured } from "../../lib/supabase";

const MAX_IMAGE_B64 = 1_500_000; // ~1.1 MB image after downscaling — plenty for a slide photo
const MAX_THUMB_B64 = 200_000;

export async function GET(req: Request) {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, migrated: false, photos: [] });

  const withBlobs = new URL(req.url).searchParams.get("blobs") === "1";
  const res = await sb
    .from("custom_photos")
    .select(
      withBlobs
        ? "id, name, description, enabled, thumb_b64, image_b64, created_by, created_at, updated_by, updated_at"
        : "id, name, description, enabled, thumb_b64, created_by, created_at, updated_by, updated_at"
    )
    .order("sort_order")
    .order("created_at");
  if (res.error) return Response.json({ configured: true, migrated: false, photos: [] });

  // supabase-js's type-level column parser can't resolve a UNION of two select strings; the
  // runtime rows are plain objects, so route them through unknown.
  const rows = res.data as unknown as { enabled: boolean }[];
  const photos = withBlobs ? rows.filter((p) => p.enabled) : rows;
  return Response.json({ configured: true, migrated: true, photos });
}

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const { name, description, image_b64, thumb_b64, author } = (await req.json()) as {
      name?: string;
      description?: string;
      image_b64?: string;
      thumb_b64?: string;
      author?: string;
    };
    const n = (name ?? "").trim();
    if (!n) return Response.json({ error: "Give the photo a short name." }, { status: 400 });
    if (!(description ?? "").trim())
      return Response.json(
        { error: "Describe the photo — that description is how the AI decides when to use it." },
        { status: 400 }
      );
    if (!image_b64) return Response.json({ error: "The image is missing." }, { status: 400 });
    if (image_b64.length > MAX_IMAGE_B64)
      return Response.json({ error: "The image is too large even after downscaling — try a smaller one." }, { status: 400 });
    if (thumb_b64 && thumb_b64.length > MAX_THUMB_B64)
      return Response.json({ error: "The thumbnail is unexpectedly large." }, { status: 400 });

    const existing = await sb.from("custom_photos").select("sort_order");
    if (existing.error) return Response.json({ error: existing.error.message }, { status: 500 });
    const sortOrder = Math.max(0, ...existing.data.map((p) => p.sort_order ?? 0)) + 1;

    const ins = await sb
      .from("custom_photos")
      .insert({
        id: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
        name: n.slice(0, 80),
        description: (description ?? "").trim().slice(0, 400),
        image_b64,
        thumb_b64: thumb_b64 ?? null,
        sort_order: sortOrder,
        created_by: (author ?? "").trim() || null,
      })
      .select("id, name, description, enabled, thumb_b64, created_by, created_at")
      .single();
    if (ins.error) return Response.json({ error: ins.error.message }, { status: 500 });
    return Response.json({ photo: ins.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
