// /api/custom-slides/[id]/export — download the ONE slide a team-slide entry points at as its
// own standalone, editable .pptx. The other half of the edit round trip for a slide already in
// the library (see /api/layout-gallery/export for the standard-layout half): download this
// slide, edit it in PowerPoint, then use "↻ Replace" (/api/custom-slides/[id]/replace) to save
// the edited version back over this same library entry.
//
//   GET → the .pptx file (just that one slide)

import { supabase, dbNotConfigured } from "../../../../lib/supabase";

const BUCKET = "custom-slides";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const base = process.env.DECK_SERVICE_URL?.replace(/\/$/, "");
  if (!base) {
    return Response.json(
      { error: "Deck service is not configured (DECK_SERVICE_URL missing)." },
      { status: 500 }
    );
  }
  const { id } = await params;

  const row = await sb
    .from("custom_slides")
    .select("id, name, file_id, slide_index")
    .eq("id", id)
    .maybeSingle();
  if (row.error) return Response.json({ error: row.error.message }, { status: 500 });
  if (!row.data) return Response.json({ error: "Slide not found." }, { status: 404 });

  const file = await sb
    .from("custom_slide_files")
    .select("pptx_b64, storage_path")
    .eq("id", row.data.file_id)
    .maybeSingle();
  if (file.error) return Response.json({ error: file.error.message }, { status: 500 });
  if (!file.data) return Response.json({ error: "The stored file for this slide is missing." }, { status: 404 });

  let bytes: Buffer;
  if (file.data.pptx_b64) {
    bytes = Buffer.from(file.data.pptx_b64, "base64");
  } else if (file.data.storage_path) {
    const dl = await sb.storage.from(BUCKET).download(file.data.storage_path);
    if (dl.error) return Response.json({ error: `Could not read the stored file: ${dl.error.message}` }, { status: 500 });
    bytes = Buffer.from(await dl.data.arrayBuffer());
  } else {
    return Response.json({ error: "This slide has no stored file." }, { status: 404 });
  }

  try {
    const forward = new FormData();
    forward.append("file", new Blob([Uint8Array.from(bytes)]), "source.pptx");
    forward.append("slide_index", String(row.data.slide_index));
    const res = await fetch(`${base}/slides/extract`, {
      method: "POST",
      body: forward,
      headers: process.env.DECK_SERVICE_TOKEN ? { "X-Deck-Token": process.env.DECK_SERVICE_TOKEN } : undefined,
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return Response.json({ error: d.feil || d.error || `Service responded ${res.status}` }, { status: res.status });
    }
    const out = await res.arrayBuffer();
    const filename = `${(row.data.name || "slide").replace(/[^\w\- ]+/g, "").trim() || "slide"}.pptx`;
    return new Response(out, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return Response.json({ error: "Could not reach the deck service: " + (e as Error).message }, { status: 502 });
  }
}
