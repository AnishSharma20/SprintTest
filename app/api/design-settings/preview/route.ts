// /api/design-settings/preview — render two sample slides with the GIVEN design settings so
// the user sees the effect before saving. Thin proxy to the deck service's rasteriser; no
// LLM involved, the sample content is fixed.
//
//   POST { settings } → { slides: [b64jpeg, b64jpeg] }   (a native text slide + a code-built one)

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
    const { settings } = (await req.json()) as { settings?: Record<string, unknown> };
    const res = await fetch(`${base}/design/preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.DECK_SERVICE_TOKEN ? { "X-Deck-Token": process.env.DECK_SERVICE_TOKEN } : {}),
      },
      body: JSON.stringify({ settings: settings ?? {} }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      return Response.json(
        { error: data.feil || data.error || `Service responded ${res.status}` },
        { status: res.status }
      );
    return Response.json(data);
  } catch (e) {
    return Response.json(
      { error: "Could not reach the deck service: " + (e as Error).message },
      { status: 502 }
    );
  }
}
