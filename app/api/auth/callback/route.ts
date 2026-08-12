// Completes "Sign in with Microsoft": exchanges the auth code for tokens, reads name/email off the
// id_token (issued directly to us by Microsoft over a server-to-server call, so it's trusted
// without a JWKS round trip), and issues our own session cookie. See app/api/auth/login/route.ts
// for the request half of this flow.

import { decodeJwt } from "jose";
import { SESSION_COOKIE, createSessionToken, verifyState } from "../../../lib/session";

export const runtime = "nodejs";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

function toLogin(origin: string, feil: string): Response {
  const url = new URL("/login", origin);
  url.searchParams.set("feil", feil);
  return Response.redirect(url.toString(), 302);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return toLogin(url.origin, "Sign in is not configured.");
  }

  const errorParam = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (errorParam) return toLogin(url.origin, errorParam);

  const code = url.searchParams.get("code");
  const state = await verifyState(url.searchParams.get("state"));
  if (!code || !state) {
    return toLogin(url.origin, "Sign in request expired or was tampered with. Try again.");
  }

  const redirectUri = new URL("/api/auth/callback", url).toString();

  let tokenRes: Response;
  try {
    tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        scope: "openid profile email",
      }),
    });
  } catch {
    return toLogin(url.origin, "Could not reach Microsoft to finish signing in.");
  }

  if (!tokenRes.ok) {
    return toLogin(url.origin, "Microsoft sign in failed. Try again.");
  }

  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) {
    return toLogin(url.origin, "Microsoft did not return an identity token.");
  }

  const claims = decodeJwt(tokens.id_token);
  if (claims.aud !== clientId || claims.nonce !== state.nonce) {
    return toLogin(url.origin, "Sign in response did not match the original request.");
  }

  const name = typeof claims.name === "string" ? claims.name : "";
  const email =
    typeof claims.email === "string"
      ? claims.email
      : typeof claims.preferred_username === "string"
      ? claims.preferred_username
      : "";
  if (!name || !email) {
    return toLogin(url.origin, "Your Microsoft account did not share a name and email.");
  }

  const session = await createSessionToken({ name, email });
  const res = Response.redirect(new URL(state.next, url.origin).toString(), 302);
  res.headers.append(
    "Set-Cookie",
    [
      `${SESSION_COOKIE}=${session}`,
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
