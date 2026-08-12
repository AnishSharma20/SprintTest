// /api/custom-slides/inspect-slots — measure the AI-refillable text slots of one slide in an
// uploaded .pptx (already sitting in Supabase Storage) — the analysis half of a built-in layout
// DESIGN OVERRIDE ("edit the slide" on a standard library card). The sibling of inspect/route.ts
// (same Storage-download + server-to-server forward, see the rationale there), targeting the
// deck service's /slides/inspect-slots instead of /slides/inspect.
//
//   POST JSON { storage_path, filename?, slide_index?, layout? }
//        → { slide_index, slots: [...], preview_b64 }
//
// The deck service rejects (400, human message) designs its recipe path cannot honour: an
// excluded fixed-role layout, embedded charts/video/objects, no editable text, too many slots.

import { supabase, dbNotConfigured } from "../../../lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "custom-slides";

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  const base = process.env.DECK_SERVICE_URL?.replace(/\/$/, "");
  if (!base) {
    return Response.json(
      { error: "Deck service is not configured (DECK_SERVICE_URL missing)." },
      { status: 500 }
    );
  }

  try {
    const { storage_path, filename, slide_index, layout } = (await req.json()) as {
      storage_path?: string;
      filename?: string;
      slide_index?: number;
      layout?: string;
    };
    if (!storage_path) return Response.json({ error: "Missing storage_path." }, { status: 400 });

    const dl = await sb.storage.from(BUCKET).download(storage_path);
    if (dl.error) {
      return Response.json({ error: `Could not read the uploaded file: ${dl.error.message}` }, { status: 500 });
    }

    const forward = new FormData();
    forward.append("file", dl.data, filename || "slide.pptx");
    forward.append("slide_index", String(Number.isInteger(slide_index) ? slide_index : 0));
    if (layout) forward.append("layout", layout);
    const res = await fetch(`${base}/slides/inspect-slots`, {
      method: "POST",
      body: forward,
      headers: process.env.DECK_SERVICE_TOKEN ? { "X-Deck-Token": process.env.DECK_SERVICE_TOKEN } : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return Response.json({ error: data.feil || data.error || `Service responded ${res.status}` }, { status: res.status });
    return Response.json(data);
  } catch (e) {
    return Response.json(
      { error: "Could not reach the deck service: " + (e as Error).message },
      { status: 502 }
    );
  }
}
