// /api/custom-slides/inspect-ticket — mint a short-lived ticket so the browser can call the
// deck service's /slides/inspect DIRECTLY, bypassing Vercel's ~4.5 MB serverless body ceiling
// for the (potentially large) .pptx upload. This route's own request/response is tiny — no
// file involved — so it isn't itself size-limited.
//
// The ticket, not CORS, is the real security boundary: it's signed with the same secret as
// X-Deck-Token (DECK_SERVICE_TOKEN), so only someone who reached this already-gated route (see
// proxy.ts, which covers every /api/* path) can mint one, and it expires in 2 minutes — plenty
// for one inspect call, useless to anyone who intercepts it afterward.

import crypto from "crypto";

export async function POST() {
  const base = process.env.DECK_SERVICE_URL?.replace(/\/$/, "");
  if (!base) {
    return Response.json(
      { error: "Deck service is not configured (DECK_SERVICE_URL missing)." },
      { status: 500 }
    );
  }
  const secret = process.env.DECK_SERVICE_TOKEN;
  const exp = Date.now() + 2 * 60 * 1000;
  const sig = secret ? crypto.createHmac("sha256", secret).update(String(exp)).digest("hex") : "";
  return Response.json({ url: `${base}/slides/inspect`, ticket: `${exp}.${sig}` });
}
