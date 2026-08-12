// Who is signed in — the source of truth for the "Reviewer" name shown/recorded across the app.
// See app/lib/use-current-user.ts for the client hook that calls this.

import { SESSION_COOKIE, verifySessionToken } from "../../../lib/session";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const cookie = req.headers
    .get("cookie")
    ?.split("; ")
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

  const user = await verifySessionToken(cookie);
  if (!user) return Response.json({ feil: "Not signed in." }, { status: 401 });
  return Response.json(user);
}
