// Which brand a settings request is for.
//
// Every team setting (rules, design, layout switches, photo switches, uploaded slides and photos,
// layout redesigns) is stored per brand — see supabase/migrations/0016. These helpers are the one
// place that decides which brand a request means, so a route cannot accidentally read one brand's
// rows and write another's.
//
// An unrecognised or missing brand resolves to the DEFAULT rather than erroring: these are
// settings reads on a page the whole team uses, and an older client that does not send a brand
// yet should keep seeing Superba's settings exactly as before.

export const DEFAULT_BRAND = "superba";

// Kept in step with app/products.ts ProductId. Duplicated as plain strings on purpose: this runs
// in route handlers, and importing the UI's product list (with its logo paths and React-facing
// shape) into the data layer would tie the two together for no benefit.
const KNOWN = new Set([DEFAULT_BRAND, "revervia", "lysoveta", "pl_plus"]);

export function normalizeBrand(value: unknown): string {
  const b = typeof value === "string" ? value.trim().toLowerCase() : "";
  return KNOWN.has(b) ? b : DEFAULT_BRAND;
}

/** Brand from a GET/DELETE query string: `?brand=revervia`. */
export function brandFromRequest(req: Request): string {
  return normalizeBrand(new URL(req.url).searchParams.get("brand"));
}

/** Brand from a JSON body, falling back to the query string so either form works. */
export function brandFromBody(req: Request, body: unknown): string {
  const fromBody =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>).brand : undefined;
  if (typeof fromBody === "string" && fromBody.trim()) return normalizeBrand(fromBody);
  return brandFromRequest(req);
}
