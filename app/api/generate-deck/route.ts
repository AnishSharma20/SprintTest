// /api/generate-deck — thin proxy to the Python deck service, job-based.
//
// A full deck takes 1-3 minutes, longer than a serverless function / gateway will
// hold a request open (this was returning 504). So generation is a background job:
//   POST  /api/generate-deck            -> start a job, returns { job_id }
//   GET   /api/generate-deck?id=ID      -> poll status { status, progress, step }
//   GET   /api/generate-deck?id=ID&download=1 -> download the finished .pptx / .zip
// Every hop is sub-second, so no long-lived connection.
//
// Set DECK_SERVICE_URL to the service base URL:
//   local dev  -> http://127.0.0.1:8000
//   production -> the deployed service URL (e.g. https://superba-deck.onrender.com)

export const runtime = "nodejs";
export const maxDuration = 60;

function serviceBase(): string | null {
  const b = process.env.DECK_SERVICE_URL;
  return b ? b.replace(/\/$/, "") : null;
}

function authHeaders(): Record<string, string> | undefined {
  return process.env.DECK_SERVICE_TOKEN
    ? { "X-Deck-Token": process.env.DECK_SERVICE_TOKEN }
    : undefined;
}

// Start a job: forward the uploaded summaries, hand back the job id.
export async function POST(req: Request) {
  const base = serviceBase();
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
    for (const key of ["lengde", "tone", "kvalitet", "instruksjoner", "innholdstype", "sprak"] as const) {
      const v = incoming.get(key);
      if (typeof v === "string" && v) forward.append(key, v);
    }

    const res = await fetch(`${base}/jobs`, {
      method: "POST",
      body: forward,
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    return Response.json(data, { status: res.status });
  } catch (e) {
    return Response.json(
      { feil: "Could not reach the deck service: " + (e as Error).message },
      { status: 502 }
    );
  }
}

// Poll status (?id=) or download the result (?id=&download=1).
export async function GET(req: Request) {
  const base = serviceBase();
  if (!base) {
    return Response.json(
      { feil: "Deck service is not configured (DECK_SERVICE_URL missing)." },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ feil: "Missing job id." }, { status: 400 });
  const download = searchParams.get("download") === "1";

  try {
    if (download) {
      const res = await fetch(`${base}/jobs/${id}/result`, { headers: authHeaders() });
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
    }

    const res = await fetch(`${base}/jobs/${id}`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    return Response.json(data, { status: res.status });
  } catch (e) {
    return Response.json(
      { feil: "Could not reach the deck service: " + (e as Error).message },
      { status: 502 }
    );
  }
}
