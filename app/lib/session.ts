// Session + OAuth state signing for "Sign in with Microsoft". See proxy.ts for why the gate lives
// in the proxy, and app/api/auth/* for the OAuth flow that issues these tokens.
//
// This lives in its own module ON PURPOSE, same reason as the old access.ts: proxy.ts is a special
// Next.js file, and importing it from a route handler makes that route silently 404.

import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "akbm_session";

/** Short-lived, holds only the OAuth `next` redirect + a replay nonce; never a secret. */
const STATE_COOKIE_TTL = "10m";
const SESSION_TTL = "30d";

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return new TextEncoder().encode(secret);
}

export type SessionUser = { name: string; email: string };

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT(user)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(secretKey());
}

/** Returns the signed-in user, or null if the cookie is absent, expired, or tampered with. */
export async function verifySessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.name !== "string" || typeof payload.email !== "string") return null;
    return { name: payload.name, email: payload.email };
  } catch {
    return null;
  }
}

/**
 * The OAuth `state` param round-trips through Microsoft's own redirect untouched, so signing it
 * ourselves is enough CSRF protection without a separate cookie: an attacker can't forge a state
 * value we would accept, since they don't have AUTH_SECRET.
 */
export async function signState(payload: { next: string; nonce: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(STATE_COOKIE_TTL)
    .sign(secretKey());
}

export async function verifyState(
  token: string | null
): Promise<{ next: string; nonce: string } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.next !== "string" || typeof payload.nonce !== "string") return null;
    return { next: payload.next, nonce: payload.nonce };
  } catch {
    return null;
  }
}
