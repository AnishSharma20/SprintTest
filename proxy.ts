// Access gate for the client demo.
//
// Next.js 16 renamed Middleware to Proxy, so this file is `proxy.ts` rather than `middleware.ts`.
//
// Why this runs here and not in the pages: a gate implemented in React only hides the UI. The
// /api/* routes would still be open, and those SPEND MONEY (every generation is an Anthropic call)
// and read the Supabase claims data. Running in the proxy is what actually protects them.
//
// Gate is "sign in with any Microsoft account" (see app/api/auth/*), not per-organization AD or a
// shared password. That is a deliberate choice: it captures a verified name for reviewer
// attribution, but it is NOT an access restriction — anyone with a Microsoft account (work, school,
// or personal) can sign in.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./app/lib/session";

/** Paths that must stay reachable, or nobody could ever sign in. */
const OPEN_PATHS = ["/login", "/api/auth/login", "/api/auth/callback"];

export async function proxy(request: NextRequest) {
  const clientId = process.env.AZURE_CLIENT_ID;

  // Unconfigured means unchanged: this site is already live, and failing closed on a deploy would
  // lock out the team the moment this shipped. The gate turns itself on when AZURE_CLIENT_ID is set.
  if (!clientId) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const user = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();

  // API callers get a status they can act on; browsers get sent to the login page.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ feil: "Not signed in." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own assets and static files. Without a matcher the proxy would also
  // run on CSS, JS and images, and the redirect would stop the page from rendering at all.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$).*)"],
};
