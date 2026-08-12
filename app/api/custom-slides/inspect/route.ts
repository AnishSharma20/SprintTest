// /api/custom-slides/inspect — turn an uploaded .pptx (already sitting in Supabase Storage) into
// per-slide preview images, so the user can pick which slides to add.
//
//   POST JSON { storage_path, filename? } → { job_id }
//   GET  ?job=<id>                        → { status, progress, step } while running,
//                                           { status: "done", slides: [{ index, preview_b64 }] }
//                                           when finished, { status: "error", error } on failure.
//
// JOB-BASED, not synchronous: rendering previews for a many-slide upload (the full 42-slide
// template export, re-uploaded after editing) takes minutes on the deployed deck service — far
// past the 60s Vercel holds a serverless route open. The old synchronous version died there
// with Vercel's plain-text timeout page, which reached the browser as an "is not valid JSON"
// parse error while LibreOffice was still happily rendering (seen in production 2026-08-12).
// Now the POST just starts a deck-service job and each GET is a sub-second poll.
//
// The browser uploads the file straight to Storage first (see upload-url/route.ts) and only
// sends this route a storage path — the file itself never transits Vercel's body ceiling; this
// route's hops (Storage download, deck-service forward) are server-to-server. Chosen over having
// the browser call the deck service directly, which would need CORS + a new auth mechanism there
// and still depends on the browser reaching Render's origin directly — this keeps the deck
// service's only caller as Vercel, same as every other endpoint it exposes.

import { supabase, dbNotConfigured } from "../../../lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "custom-slides";

function serviceBase(): string | null {
  const b = process.env.DECK_SERVICE_URL;
  return b ? b.replace(/\/$/, "") : null;
}

function authHeaders(): Record<string, string> | undefined {
  return process.env.DECK_SERVICE_TOKEN ? { "X-Deck-Token": process.env.DECK_SERVICE_TOKEN } : undefined;
}

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  const base = serviceBase();
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
    const res = await fetch(`${base}/slides/inspect-job`, {
      method: "POST",
      body: forward,
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return Response.json({ error: data.feil || data.error || `Service responded ${res.status}` }, { status: res.status });
    return Response.json({ job_id: data.job_id });
  } catch (e) {
    return Response.json(
      { error: "Could not reach the deck service: " + (e as Error).message },
      { status: 502 }
    );
  }
}

export async function GET(req: Request) {
  const base = serviceBase();
  if (!base) {
    return Response.json(
      { error: "Deck service is not configured (DECK_SERVICE_URL missing)." },
      { status: 500 }
    );
  }
  const id = new URL(req.url).searchParams.get("job");
  if (!id) return Response.json({ error: "Missing job id." }, { status: 400 });

  try {
    const st = await fetch(`${base}/jobs/${id}`, { headers: authHeaders() });
    const status = await st.json().catch(() => ({}));
    if (!st.ok) return Response.json({ error: status.feil || `Service responded ${st.status}` }, { status: st.status });
    if (status.status === "error")
      return Response.json({ status: "error", error: status.error || "Preview rendering failed." });
    if (status.status !== "done")
      return Response.json({ status: status.status, progress: status.progress, step: status.step });

    const res = await fetch(`${base}/jobs/${id}/result`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return Response.json({ error: data.feil || `Service responded ${res.status}` }, { status: res.status });
    return Response.json({ status: "done", slides: data.slides ?? [] });
  } catch (e) {
    return Response.json(
      { error: "Could not reach the deck service: " + (e as Error).message },
      { status: 502 }
    );
  }
}
