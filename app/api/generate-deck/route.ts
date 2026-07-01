// POST /api/generate-deck
// Thin proxy: forwards the uploaded summary file(s) to the Python deck service
// (which runs Claude + the PPT Master template-fill pipeline) and streams the
// resulting .pptx / .zip back. The heavy work + the API key live on the service.
//
// Set DECK_SERVICE_URL to the service base URL:
//   local dev   -> http://127.0.0.1:8000
//   production  -> the deployed service URL (e.g. https://superba-deck.onrender.com)

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const base = process.env.DECK_SERVICE_URL;
  if (!base) {
    return Response.json(
      { feil: "Deck service is not configured (DECK_SERVICE_URL missing)." },
      { status: 500 }
    );
  }

  try {
    const incoming = await req.formData();
    const filer = incoming.getAll("filer").filter((f): f is File => f instanceof File);
    if (filer.length === 0) {
      return Response.json({ feil: "No files uploaded." }, { status: 400 });
    }

    const forward = new FormData();
    for (const f of filer) forward.append("filer", f, f.name);
    // Forward the generation options (length / tone) when present.
    for (const key of ["lengde", "tone"] as const) {
      const v = incoming.get(key);
      if (typeof v === "string" && v) forward.append(key, v);
    }

    const res = await fetch(`${base.replace(/\/$/, "")}/generate`, {
      method: "POST",
      body: forward,
      headers: process.env.DECK_SERVICE_TOKEN
        ? { "X-Deck-Token": process.env.DECK_SERVICE_TOKEN }
        : undefined,
    });

    // Pass the service response straight through (pptx, zip, or JSON error).
    const buf = await res.arrayBuffer();
    return new Response(buf, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream",
        ...(res.headers.get("Content-Disposition")
          ? { "Content-Disposition": res.headers.get("Content-Disposition")! }
          : {}),
      },
    });
  } catch (e) {
    return Response.json(
      { feil: "Could not reach the deck service: " + (e as Error).message },
      { status: 502 }
    );
  }
}
