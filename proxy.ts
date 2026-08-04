// Access gate for the client demo.
//
// Next.js 16 renamed Middleware to Proxy, so this file is `proxy.ts` rather than `middleware.ts`.
//
// Why this runs here and not in the pages: a gate implemented in React only hides the UI. The
// /api/* routes would still be open, and those SPEND MONEY (every generation is an Anthropic call)
// and read the Supabase claims data. Running in the proxy is what actually protects them.
//
// This is a single shared password, not real user accounts. It is the right weight for "send a link
// to the client so they can try it", and it keeps the API routes from being hit by anyone who finds
// the URL. It is NOT a substitute for per-user auth if this ever becomes a production tool.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE, accessToken } from "./app/lib/access";

/** Paths that must stay reachable, or nobody could ever log in. */
const OPEN_PATHS = ["/login", "/api/login", "/api/logout"];

export async function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;

  // Unconfigured means unchanged: this site is already live, and failing closed on a deploy would
  // lock out the team the moment this shipped. The gate turns itself on when APP_PASSWORD is set.
  if (!password) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const expected = await accessToken(password);
  if (request.cookies.get(COOKIE)?.value === expected) return NextResponse.next();

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
