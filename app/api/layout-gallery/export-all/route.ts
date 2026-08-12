// /api/layout-gallery/export-all — download EVERY standard layout as ONE editable .pptx. The
// bulk sibling of /api/layout-gallery/export: same idea (thin proxy to the deck service's
// renderer, no LLM), but for editing several slides in one PowerPoint session instead of
// downloading them one at a time. Re-upload the edited file through the existing "＋ Upload
// PowerPoint" flow, which already lets you tick just the slides you changed and name each one.
//
//   POST { background? ("dark" | "light" | "pastel") } → the .pptx file

import { brandFromBody } from "../../../lib/brand";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const base = process.env.DECK_SERVICE_URL?.replace(/\/$/, "");
  if (!base) {
    return Response.json(
      { error: "Deck service is not configured (DECK_SERVICE_URL missing)." },
      { status: 500 }
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { background?: string; brand?: string };
    const { background } = body;

    const res = await fetch(`${base}/slides/export-all`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.DECK_SERVICE_TOKEN ? { "X-Deck-Token": process.env.DECK_SERVICE_TOKEN } : {}),
      },
      body: JSON.stringify({ background: background ?? "dark", brand: brandFromBody(req, body) }),
    });

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return Response.json({ error: d.feil || d.error || `Service responded ${res.status}` }, { status: res.status });
    }

    const bytes = await res.arrayBuffer();
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": res.headers.get("content-disposition") || 'attachment; filename="superba-slide-templates.pptx"',
      },
    });
  } catch (e) {
    return Response.json({ error: "Could not reach the deck service: " + (e as Error).message }, { status: 502 });
  }
}
