// /api/custom-slides — the team's own verbatim slides for generated decks.
//
//   GET  /api/custom-slides            { configured, migrated, slides: [...] }  (no pptx blobs)
//   GET  /api/custom-slides?blobs=1    adds pptx_b64 per unique file — used by the generator
//                                      pages at generation time to ship the slides to the
//                                      deck service as job files.
//   POST /api/custom-slides            { filename, pptx_b64, slides: [{ slide_index, name,
//                                        description, mode, preview_b64 }], author? }
//                                      → stores the file once + one row per picked slide.
//
// Slides are spliced verbatim (shapes + images) into generated decks: mode 'auto' lets the
// AI place the slide where it fits the storyline, 'always' includes it in every deck.

import { supabase, dbNotConfigured } from "../../lib/supabase";

const MAX_PPTX_B64 = 6_000_000; // ~4 MB file as base64 — the same cap the inspect route enforces,
                                // and comfortably under Vercel's ~4.5 MB serverless body ceiling
const MODES = new Set(["auto", "always", "off"]);

export async function GET(req: Request) {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, migrated: false, slides: [] });

  const withBlobs = new URL(req.url).searchParams.get("blobs") === "1";

  const res = await sb
    .from("custom_slides")
    .select("id, file_id, slide_index, name, description, mode, preview_b64, created_by, created_at, updated_by, updated_at")
    .order("sort_order")
    .order("created_at");
  if (res.error) return Response.json({ configured: true, migrated: false, slides: [] });

  let files: Record<string, string> = {};
  if (withBlobs && res.data.length) {
    const active = res.data.filter((s) => s.mode !== "off");
    const ids = [...new Set(active.map((s) => s.file_id))];
    if (ids.length) {
      const f = await sb.from("custom_slide_files").select("id, pptx_b64").in("id", ids);
      if (f.error) return Response.json({ error: f.error.message }, { status: 500 });
      files = Object.fromEntries(f.data.map((r) => [r.id, r.pptx_b64]));
    }
  }

  return Response.json({ configured: true, migrated: true, slides: res.data, files });
}

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const { filename, pptx_b64, slides, author } = (await req.json()) as {
      filename?: string;
      pptx_b64?: string;
      slides?: { slide_index?: number; name?: string; description?: string; mode?: string; preview_b64?: string }[];
      author?: string;
    };
    if (!pptx_b64 || typeof pptx_b64 !== "string")
      return Response.json({ error: "The PowerPoint file is missing." }, { status: 400 });
    if (pptx_b64.length > MAX_PPTX_B64)
      return Response.json({ error: "Keep the PowerPoint file under 4 MB." }, { status: 400 });
    if (!slides?.length)
      return Response.json({ error: "Pick at least one slide to add." }, { status: 400 });
    for (const s of slides) {
      if (!Number.isInteger(s.slide_index) || (s.slide_index as number) < 0)
        return Response.json({ error: "A slide is missing its slide number." }, { status: 400 });
      if (!(s.name ?? "").trim())
        return Response.json({ error: "Give every added slide a short name." }, { status: 400 });
      if (s.mode && !MODES.has(s.mode))
        return Response.json({ error: `Unknown mode "${s.mode}".` }, { status: 400 });
    }

    const by = (author ?? "").trim() || null;
    const fileId = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    const file = await sb.from("custom_slide_files").insert({
      id: fileId,
      filename: (filename ?? "slides.pptx").slice(0, 120),
      pptx_b64,
      created_by: by,
    });
    if (file.error) return Response.json({ error: file.error.message }, { status: 500 });

    const rows = slides.map((s, i) => ({
      id: crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      file_id: fileId,
      slide_index: s.slide_index as number,
      name: (s.name as string).trim().slice(0, 80),
      description: (s.description ?? "").trim().slice(0, 400),
      mode: s.mode ?? "auto",
      preview_b64: s.preview_b64 ?? null,
      sort_order: i,
      created_by: by,
    }));
    const ins = await sb.from("custom_slides").insert(rows).select("id, name");
    if (ins.error) {
      await sb.from("custom_slide_files").delete().eq("id", fileId); // don't orphan the blob
      return Response.json({ error: ins.error.message }, { status: 500 });
    }
    return Response.json({ added: ins.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
