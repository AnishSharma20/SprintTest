// /api/custom-studies/extract — turn an uploaded study PDF (already sitting in Supabase Storage)
// into full text + a drafted abstract, for the "Add study" flow's review step.
//
//   POST JSON { storage_path, filename? } → { full_text, abstract, pages, chars }
//
// Server-mediated, same shape as /api/custom-slides/inspect: the browser already put the PDF in
// Storage directly (see upload-url/route.ts); this route does two server-to-server hops (Storage
// download, then forward to the deck service), neither subject to Vercel's serverless body
// ceiling — that only gates what a browser sends this function directly.

import { supabase, dbNotConfigured } from "../../../lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "custom-studies";

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  const base = process.env.DECK_SERVICE_URL?.replace(/\/$/, "");
  if (!base) {
    return Response.json({ error: "Deck service is not configured (DECK_SERVICE_URL missing)." }, { status: 500 });
  }

  try {
    const { storage_path, filename } = (await req.json()) as { storage_path?: string; filename?: string };
    if (!storage_path) return Response.json({ error: "Missing storage_path." }, { status: 400 });

    const dl = await sb.storage.from(BUCKET).download(storage_path);
    if (dl.error) {
      return Response.json({ error: `Could not read the uploaded file: ${dl.error.message}` }, { status: 500 });
    }

    const forward = new FormData();
    forward.append("file", dl.data, filename || "study.pdf");
    const res = await fetch(`${base}/studies/extract-text`, {
      method: "POST",
      body: forward,
      headers: process.env.DECK_SERVICE_TOKEN ? { "X-Deck-Token": process.env.DECK_SERVICE_TOKEN } : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return Response.json({ error: data.feil || data.error || `Service responded ${res.status}` }, { status: res.status });
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: "Could not reach the deck service: " + (e as Error).message }, { status: 502 });
  }
}
