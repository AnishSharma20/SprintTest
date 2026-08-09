// /api/custom-slides/inspect — turn an uploaded .pptx into per-slide preview images, so the
// user can pick which slides to add. Thin proxy to the deck service's rasteriser (LibreOffice
// on Render, PowerPoint locally); the file itself is only stored when the user confirms.
//
//   POST multipart { file } → { slides: [{ index, png_b64 }] }
//
// Kept under Vercel's serverless request-body ceiling (~4.5 MB), hence the 4 MB file cap —
// the same cap the save route enforces.

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  const base = process.env.DECK_SERVICE_URL?.replace(/\/$/, "");
  if (!base) {
    return Response.json(
      { error: "Deck service is not configured (DECK_SERVICE_URL missing)." },
      { status: 500 }
    );
  }

  try {
    const incoming = await req.formData();
    const file = incoming.get("file");
    if (!(file instanceof File)) return Response.json({ error: "No file uploaded." }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".pptx"))
      return Response.json({ error: "Upload a PowerPoint .pptx file." }, { status: 400 });
    if (file.size > MAX_BYTES)
      return Response.json(
        { error: "Keep the file under 4 MB — save just the slides you want as a smaller .pptx and try again." },
        { status: 400 }
      );

    const forward = new FormData();
    forward.append("file", file, file.name);
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
