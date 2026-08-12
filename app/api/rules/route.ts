// /api/rules — the team's own deck generation rules (managed on the About page).
//
//   GET  /api/rules   { configured, rules: [{ id, text, enabled, slide_key, action, position }] }
//   POST /api/rules   { text, slide_key?, action?, position?, author? }  → create (enabled)
//
// Three kinds of rule live in this one list, and the difference is whether the pipeline can ACT on
// it (see migration 0013):
//   - a WRITING rule (slide_key null) is prose injected into the planner's prompt, then verified
//     against the finished deck by the deck service's rules_gate and repaired if broken;
//   - a STRUCTURE rule (slide_key + action) is applied deterministically — 'position' moves that
//     slide to an exact spot, 'always_include' guarantees it appears. These replace guarantees
//     that used to be hardcoded, which is what makes the cover and agenda removable: delete the
//     rule and the guarantee goes with it. NOTE the guarantee is only total for the slides the code
//     can compose or splice (cover, executive summary, agenda, the verbatim benefits slide); for a
//     content slide the pipeline turns the rest into an ask plus a check, because a slide's text has
//     to be written (deck-service `pipeline._structure_asks`);
//   - a WRITING rule ABOUT ONE SLIDE (slide_key, action null) is the team saying something in their
//     own words that no mechanism could apply. It travels as prose exactly like the first kind; the
//     slide is recorded only so the rule can show which slide it concerns.
//
// Every ENABLED rule is fetched by the generator pages at generation time and threaded to the
// deck service. The table only exists once migration 0004 has been run, and the structural
// columns once 0013 has; until then GET reports migrated/structureMigrated false so the About
// page can degrade instead of erroring.

import { supabase, dbNotConfigured } from "../../lib/supabase";
import { brandFromBody, brandFromRequest } from "../../lib/brand";

const ACTIONS = new Set(["position", "always_include"]);
const POSITIONS = new Set(["first", "second", "third", "last", "second_to_last"]);

export async function GET(req: Request) {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, migrated: false, rules: [] });

  const brand = brandFromRequest(req);
  const res = await sb
    .from("generation_rules")
    .select("*")
    .eq("brand", brand)
    .order("sort_order")
    .order("id");
  if (res.error) return Response.json({ configured: true, migrated: false, rules: [] });

  // Probe the column itself rather than inferring from a row: with an empty rules table there is
  // no row to inspect, and guessing "migrated" there let the page offer a slide-rule builder that
  // could only fail on save.
  const probe = await sb.from("generation_rules").select("slide_key").limit(1);
  const builtinProbe = await sb.from("generation_rules").select("builtin_key").limit(1);
  return Response.json({
    configured: true,
    migrated: true,
    structureMigrated: !probe.error,
    // Whether the team OWNS the built in writing rules yet (migration 0014 + the one time import
    // in /api/rules/builtin). Until then the deck service keeps using its own defaults.
    builtinManaged: !builtinProbe.error,
    rules: res.data,
  });
}

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const body = (await req.json()) as {
      text?: string;
      slide_key?: string;
      action?: string;
      position?: string;
      author?: string;
      brand?: string;
    };
    const { text, slide_key, action, position, author } = body;
    const t = (text ?? "").trim();
    if (!t) return Response.json({ error: "The rule text is empty." }, { status: 400 });
    if (t.length > 500)
      return Response.json({ error: "Keep a rule under 500 characters." }, { status: 400 });

    const key = (slide_key ?? "").trim();
    // A slide_key with NO action is a third, deliberate shape: a writing rule the team wrote about
    // one particular slide. It travels as prose and is checked like any other writing rule — the
    // slide is recorded only so the rule can say which slide it concerns. It must stay action-less,
    // because everything that applies rules mechanically (pipeline._apply_structure, and the
    // protectedSlides guard in /api/layout-settings) keys off `action` being present.
    if (key && action !== undefined && action !== null && `${action}`.trim() !== "") {
      if (!ACTIONS.has(action))
        return Response.json({ error: "A slide rule needs a known action." }, { status: 400 });
      if (action === "position" && !POSITIONS.has(position ?? ""))
        return Response.json({ error: "A position rule needs a known position." }, { status: 400 });
    }

    const brand = brandFromBody(req, body);
    const existing = await sb.from("generation_rules").select("sort_order").eq("brand", brand);
    if (existing.error) return Response.json({ error: existing.error.message }, { status: 500 });
    const sortOrder = Math.max(0, ...existing.data.map((r) => r.sort_order ?? 0)) + 1;

    const row: Record<string, unknown> = {
      brand,
      text: t,
      created_by: (author ?? "").trim() || null,
      sort_order: sortOrder,
    };
    if (key) {
      row.slide_key = key;
      row.action = action || null;   // null = a writing rule about this slide, applied by nothing
      row.position = action === "position" ? position : null;
    }

    let ins = await sb.from("generation_rules").insert(row).select("*").single();
    if (ins.error && key && `${ins.error.message}`.includes("slide_key")) {
      return Response.json(
        { error: "Run migration 0013_structure_rules_and_slide_stars.sql in the Supabase SQL editor first." },
        { status: 400 }
      );
    }
    if (ins.error) return Response.json({ error: ins.error.message }, { status: 500 });
    return Response.json({ rule: ins.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
