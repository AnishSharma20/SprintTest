// /api/idml-pages — the composable brochure page library, proxied from the deck service.
//
// Feeds Tab 2's optional "choose the pages yourself" override for the mixed-page InDesign
// whitepaper. Degrades to an empty list (never an error) so the generator simply falls back to
// picking pages automatically when the service is unreachable or not yet deployed.

export const runtime = "nodejs";

function serviceBase(): string | null {
  const b = process.env.DECK_SERVICE_URL;
  return b ? b.replace(/\/$/, "") : null;
}

export async function GET() {
  const base = serviceBase();
  if (!base) return Response.json({ pages: [] });

  try {
    const res = await fetch(`${base}/idml/pages`, {
      headers: process.env.DECK_SERVICE_TOKEN
        ? { "X-Deck-Token": process.env.DECK_SERVICE_TOKEN }
        : undefined,
      cache: "no-store",
    });
    if (!res.ok) return Response.json({ pages: [] });
    const data = await res.json().catch(() => ({}));
    return Response.json({ pages: Array.isArray(data.pages) ? data.pages : [] });
  } catch {
    return Response.json({ pages: [] });
  }
}
