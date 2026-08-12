// Kicks off "Sign in with Microsoft". Any Microsoft account (work, school, or personal) can sign
// in: this app registration uses the `common` tenant, not one organization's directory. See the
// deck-service-architecture memory / plan notes for why this replaces the old shared password.

import { signState } from "../../../lib/session";

export const runtime = "nodejs";

const AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";

export async function GET(req: Request) {
  const clientId = process.env.AZURE_CLIENT_ID;
  if (!clientId) {
    return Response.json({ feil: "Sign in is not configured (AZURE_CLIENT_ID is not set)." }, { status: 503 });
  }

  const url = new URL(req.url);
  const next = url.searchParams.get("next");
  const redirectUri = new URL("/api/auth/callback", url).toString();
  const nonce = crypto.randomUUID();

  const state = await signState({
    next: next && next.startsWith("/") ? next : "/",
    nonce,
  });

  const authorize = new URL(AUTHORIZE_URL);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_mode", "query");
  authorize.searchParams.set("scope", "openid profile email");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);

  return Response.redirect(authorize.toString(), 302);
}
