// /api/rules/builtin — surface the writing rules that used to live inside the AI's instructions.
//
//   GET  /api/rules/builtin   { blocks: [{ key, label, text }], seeded }
//
// The deck service owns the DEFAULT text (planner.BUILTIN_BLOCKS is the single source of truth, so
// nothing can drift). This route fetches it and makes sure each one exists as an ordinary row in
// generation_rules, keyed by builtin_key — after which they are just rules: editable, switchable
// and deletable like any the team wrote themselves.
//
// Seeding once, on first view, is what turns "buried in the prompt" into "visible on the website".
// A row is only ever CREATED here: an edited or deleted rule is the team's, and this must never
// overwrite or resurrect it. Deleting a rule is meaningful — it removes that instruction from the
// AI entirely — so `seeded` tells the page whether the one-time import has happened.

import { supabase, dbNotConfigured } from "../../../lib/supabase";
import { brandFromRequest } from "../../../lib/brand";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  const base = process.env.DECK_SERVICE_URL?.replace(/\/$/, "");
  if (!base) return Response.json({ error: "Deck service is not configured." }, { status: 500 });

  try {
    const res = await fetch(`${base}/rules/builtin`, {
      headers: process.env.DECK_SERVICE_TOKEN ? { "X-Deck-Token": process.env.DECK_SERVICE_TOKEN } : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      return Response.json({ error: data.feil || `Service responded ${res.status}` }, { status: res.status });
    const blocks = (data.blocks ?? []) as { key: string; label: string; text: string }[];

    // Which are already rows? A failure here means the builtin_key column is missing (pre-0014),
    // and then there is nothing to seed — the service keeps using its own defaults.
    const brand = brandFromRequest(req);
    const existing = await sb
      .from("generation_rules")
      .select("builtin_key")
      .eq("brand", brand)
      .not("builtin_key", "is", null);
    if (existing.error) return Response.json({ blocks, seeded: false });

    const have = new Set(existing.data.map((r) => r.builtin_key as string));
    const missing = blocks.filter((b) => !have.has(b.key));
    if (missing.length) {
      const order = await sb.from("generation_rules").select("sort_order").eq("brand", brand);
      let next = Math.max(0, ...(order.data ?? []).map((r) => r.sort_order ?? 0)) + 1;
      const ins = await sb.from("generation_rules").insert(
        missing.map((b) => ({
          brand,
          text: b.text,
          builtin_key: b.key,
          sort_order: next++,
          created_by: "built in",
        }))
      );
      if (ins.error) return Response.json({ blocks, seeded: false, error: ins.error.message });
    }
    return Response.json({ blocks, seeded: true });
  } catch (e) {
    return Response.json({ error: "Could not reach the deck service: " + (e as Error).message }, { status: 502 });
  }
}
