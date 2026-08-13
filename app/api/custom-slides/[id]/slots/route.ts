// /api/custom-slides/[id]/slots — switch one of the team's own slides between the two things an
// uploaded slide can be, AFTER it was uploaded:
//
//   POST     measure the slide's text boxes and store them → the AI rewrites its text every deck
//   DELETE   clear them → the slide is spliced in exactly as drawn, the AI writes nothing
//
// Until now this choice existed only DURING upload (page.tsx's measurePick), and it silently fell
// back to "exactly as drawn" whenever measuring failed — with no way to retry afterwards short of
// deleting the slide and uploading it again. Reported by a team member whose thank-you slide came
// out verbatim and could not be converted.
//
// The original .pptx is still available (custom_slide_files keeps storage_path, or pptx_b64 for
// pre-0008 rows), so measuring again needs no re-upload. The deck service does the measuring and
// owns the refusals (embedded chart/video/object, no editable text, too many slots); this route
// downloads the file and forwards it, exactly as inspect-slots/route.ts does for a fresh upload.

import { supabase, dbNotConfigured } from "../../../../lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "custom-slides";

/** The stored .pptx for a slide, plus the slide's own index in it. */
async function loadSource(sb: NonNullable<ReturnType<typeof supabase>>, id: string) {
  const slide = await sb
    .from("custom_slides")
    .select("id, file_id, slide_index, name, mode")
    .eq("id", id)
    .maybeSingle();
  if (slide.error || !slide.data) return { error: "That slide no longer exists.", status: 404 };

  const row = slide.data as { file_id: string; slide_index: number; name: string; mode: string };
  const file = await sb
    .from("custom_slide_files")
    .select("id, pptx_b64, storage_path")
    .eq("id", row.file_id)
    .maybeSingle();
  if (file.error || !file.data) {
    return { error: "The original PowerPoint for this slide is no longer stored, so its text cannot be measured. Upload it again.", status: 409 };
  }

  const f = file.data as { pptx_b64: string | null; storage_path: string | null };
  let bytes: Buffer | null = null;
  if (f.storage_path) {
    const dl = await sb.storage.from(BUCKET).download(f.storage_path);
    if (dl.error || !dl.data) {
      return { error: `Could not read the stored PowerPoint (${dl.error?.message ?? "download failed"}).`, status: 502 };
    }
    bytes = Buffer.from(await dl.data.arrayBuffer());
  } else if (f.pptx_b64) {
    bytes = Buffer.from(f.pptx_b64, "base64");
  }
  if (!bytes?.length) {
    return { error: "The original PowerPoint for this slide is empty or missing.", status: 409 };
  }
  return { bytes, slide: row };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;

  const base = process.env.DECK_SERVICE_URL?.replace(/\/$/, "");
  if (!base) {
    return Response.json(
      { error: "Deck service is not configured (DECK_SERVICE_URL missing)." },
      { status: 500 }
    );
  }

  try {
    const { author } = ((await req.json().catch(() => ({}))) ?? {}) as { author?: string };
    const src = await loadSource(sb, id);
    if ("error" in src) return Response.json({ error: src.error }, { status: src.status });

    // "In every deck" is only offered for a verbatim slide (the upload form disables the pair), so
    // refuse the combination here too rather than storing a state the UI cannot represent.
    if (src.slide.mode === "always") {
      return Response.json(
        {
          error:
            'This slide is set to "In every deck", which only applies to a slide inserted exactly as drawn. Switch it to "The AI decides where it fits" first, then let the AI write its text.',
        },
        { status: 409 }
      );
    }

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(src.bytes)]), "slide.pptx");
    form.append("slide_index", String(src.slide.slide_index ?? 0));
    const res = await fetch(`${base}/slides/inspect-slots`, {
      method: "POST",
      headers: process.env.DECK_SERVICE_TOKEN ? { "X-Deck-Token": process.env.DECK_SERVICE_TOKEN } : {},
      body: form,
    });
    const d = (await res.json().catch(() => ({}))) as { slots?: unknown[]; error?: string; feil?: string };
    if (!res.ok) {
      // The deck service's refusals are written for a person — pass them through unchanged.
      // `feil` is checked alongside `error` for the same reason inspect-slots/route.ts does it.
      return Response.json({ error: d.feil || d.error || "Could not read this slide's text." }, { status: 400 });
    }
    const slots = d.slots ?? [];
    if (!slots.length) {
      return Response.json(
        {
          error:
            "No editable text found on this slide, so the AI has nothing to write into. Its text is probably part of an image rather than real text boxes.",
        },
        { status: 400 }
      );
    }

    const up = await sb
      .from("custom_slides")
      .update({
        slots,
        updated_by: (author ?? "").trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, file_id, slide_index, name, description, mode, preview_b64, slots")
      .maybeSingle();
    if (up.error) {
      // 0012 adds the slots column; without it this feature simply is not available yet.
      return Response.json(
        { error: `Could not save the measured text slots (${up.error.message}). Has migration 0012 been run?` },
        { status: 500 }
      );
    }
    return Response.json({ slide: up.data, slots });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;
  const author = new URL(req.url).searchParams.get("author") ?? "";
  const up = await sb
    .from("custom_slides")
    .update({ slots: null, updated_by: author.trim() || null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, file_id, slide_index, name, description, mode, preview_b64, slots")
    .maybeSingle();
  if (up.error) return Response.json({ error: up.error.message }, { status: 500 });
  return Response.json({ slide: up.data });
}
