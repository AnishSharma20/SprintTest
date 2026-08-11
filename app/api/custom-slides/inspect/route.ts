// /api/custom-slides/inspect — turn an uploaded .pptx (already sitting in Supabase Storage) into
// per-slide preview images, so the user can pick which slides to add.
//
//   POST JSON { storage_path, filename? } → { slides: [{ index, preview_b64 }] }
//
// Unlike the old version of this route (which received the raw .pptx as a multipart body,
// capped at Vercel's ~4.5 MB serverless request ceiling), the browser now uploads the file
// straight to Storage first (see upload-url/route.ts) and only sends this route a storage path —
// a few bytes. This route then does two SERVER-TO-SERVER hops, neither subject to that ceiling
// (which only gates what a browser sends a Vercel function directly, not what the function goes
// on to fetch/send itself): download the file from Storage, then forward it to the deck
// service's rasteriser exactly as before. Chosen over having the browser call the deck service
// directly, which would need CORS + a new auth mechanism there and still depends on the browser
// reaching Render's origin directly (a real, separate failure mode from Vercel's body ceiling) —
// this keeps the deck service's only caller as Vercel, server-to-server, same as every other
// endpoint it exposes.

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
    const { storage_path, filename } = (await req.json()) as { storage_path?: string; filename?: string };
    if (!storage_path) return Response.json({ error: "Missing storage_path." }, { status: 400 });

    const dl = await sb.storage.from(BUCKET).download(storage_path);
    if (dl.error) {
      return Response.json({ error: `Could not read the uploaded file: ${dl.error.message}` }, { status: 500 });
    }

    const forward = new FormData();
    forward.append("file", dl.data, filename || "slides.pptx");
    const res = await fetch(`${base}/slides/inspect`, {
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
