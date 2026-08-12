// /api/layout-gallery/export — download ONE standard layout as a real, editable .pptx. Thin
// proxy to the deck service's renderer; no LLM involved, the sample content is the same fixed
// content the static preview gallery (public/layout-gallery*/*.png) is built from.
//
// This is one half of the "view it, then make it yours" round trip: the user downloads a
// standard slide, edits it freely in PowerPoint, then hands the edited file back through the
// existing "＋ Upload PowerPoint" flow (app/api/custom-slides) to save it as their own version.
//
//   POST { layout, background? ("dark" | "light" | "pastel") } → the .pptx file

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
    const body = (await req.json()) as { layout?: string; background?: string; brand?: string };
    const { layout, background } = body;
    if (!layout) return Response.json({ error: "Missing layout key." }, { status: 400 });

    const res = await fetch(`${base}/slides/export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.DECK_SERVICE_TOKEN ? { "X-Deck-Token": process.env.DECK_SERVICE_TOKEN } : {}),
      },
      body: JSON.stringify({ layout, background: background ?? "dark", brand: brandFromBody(req, body) }),
    });

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      return Response.json({ error: d.feil || d.error || `Service responded ${res.status}` }, { status: res.status });
    }

    const bytes = await res.arrayBuffer();
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": res.headers.get("content-disposition") || `attachment; filename="${layout}.pptx"`,
      },
    });
  } catch (e) {
    return Response.json({ error: "Could not reach the deck service: " + (e as Error).message }, { status: 502 });
  }
}
