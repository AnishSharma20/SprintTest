// Shared bits of the client demo access gate, used by both proxy.ts and the login/logout routes.
//
// This lives in its own module ON PURPOSE. proxy.ts is a special Next.js file, and importing it
// from a route handler makes that route silently 404 rather than fail loudly, which is a confusing
// half hour to debug.

export const COOKIE = "akbm_access";

/**
 * The cookie holds a digest of the password, never the password itself, so a stolen cookie does not
 * hand over the shared password. Web Crypto is used because this also has to run in the proxy,
 * which is not a Node environment.
 */
export async function accessToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`akbm:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
