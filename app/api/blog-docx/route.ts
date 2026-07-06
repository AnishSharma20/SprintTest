// /api/blog-docx — convert a (reviewed/edited) Markdown blog draft to a Word .docx.
// Thin proxy to the Python deck service's /blog/docx endpoint. The frontend posts the
// current draft text; the service returns a .docx byte stream we stream straight back.

export const runtime = "nodejs";

function serviceBase(): string | null {
  const b = process.env.DECK_SERVICE_URL;
  return b ? b.replace(/\/$/, "") : null;
}

function authHeaders(): Record<string, string> | undefined {
  return process.env.DECK_SERVICE_TOKEN
    ? { "X-Deck-Token": process.env.DECK_SERVICE_TOKEN }
    : undefined;
}

export async function POST(req: Request) {
  const base = serviceBase();
  if (!base) {
    return Response.json(
      { feil: "Deck service is not configured (DECK_SERVICE_URL missing)." },
      { status: 500 }
    );
  }

  try {
    const { markdown, filename } = await req.json();
    if (typeof markdown !== "string" || !markdown.trim()) {
      return Response.json({ feil: "No draft text to convert." }, { status: 400 });
    }

    const form = new FormData();
    form.append("markdown", markdown);
    form.append("filename", typeof filename === "string" && filename ? filename : "superba-blog-draft");

    const res = await fetch(`${base}/blog/docx`, {
      method: "POST",
      body: form,
      headers: authHeaders(),
    });
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
