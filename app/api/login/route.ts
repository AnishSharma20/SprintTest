// Sign in / out for the client demo gate. See proxy.ts for why the gate lives in the proxy.
//
// The password is compared server side and never sent back to the browser. The cookie holds a
// digest of it, is httpOnly so page scripts cannot read it, and is Secure in production.

import { COOKIE, accessToken } from "../../lib/access";

export const runtime = "nodejs";

/** Constant time compare, so a wrong password cannot be found one character at a time. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  const expectedPassword = process.env.APP_PASSWORD;
  if (!expectedPassword) {
    return Response.json(
      { feil: "The site is not password protected yet (APP_PASSWORD is not set)." },
      { status: 503 }
    );
  }
  const expectedUser = process.env.APP_USER ?? "superba";

  let user = "";
  let password = "";
  try {
    const body = await req.json();
    user = String(body.user ?? "");
    password = String(body.password ?? "");
  } catch {
    return Response.json({ feil: "Bad request." }, { status: 400 });
  }

  // Deliberately one message for both fields: naming which half was wrong just helps guessing.
  if (!sameSecret(user.trim().toLowerCase(), expectedUser.toLowerCase()) ||
      !sameSecret(password, expectedPassword)) {
    return Response.json({ feil: "Wrong username or password." }, { status: 401 });
  }

  const res = Response.json({ ok: true });
  res.headers.append(
    "Set-Cookie",
    [
      `${COOKIE}=${await accessToken(expectedPassword)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${60 * 60 * 24 * 30}`,
      process.env.NODE_ENV === "production" ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ")
  );
  return res;
}
