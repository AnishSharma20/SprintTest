// /api/study-categories — which benefit categories a study belongs to, when a reviewer has
// changed them from the built in assignment in app/studies.ts.
//
//   GET  /api/study-categories        { configured, migrated, byPmid: { [pmid]: categoryId[] } }
//   PUT  /api/study-categories        { pmid, categoryIds, previousCategoryIds?, actor? }
//
// Moving a study also moves its findings: any finding of THAT study sitting in a category the
// study just left is re-filed under the category it moved into, so the evidence never ends up
// stranded in a category the study is no longer part of. The move is recorded in claim_events.
//
// `previousCategoryIds` is what the study showed before the edit. It matters on the first edit
// of a study, when there are no override rows yet and the previous categories are only known to
// the client (they come from the hard coded table in app/studies.ts, which this route cannot see).

import { supabase, dbNotConfigured } from "../../lib/supabase";

export async function GET() {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, migrated: false, byPmid: {} });

  const res = await sb.from("study_categories").select("pmid, category_id");
  // Before migration 0003 the table does not exist — every study then uses its built in categories.
  if (res.error) return Response.json({ configured: true, migrated: false, byPmid: {} });

  const byPmid: Record<string, string[]> = {};
  for (const r of res.data) (byPmid[r.pmid] ??= []).push(r.category_id);
  return Response.json({ configured: true, migrated: true, byPmid });
}

export async function PUT(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const body = (await req.json()) as {
      pmid?: string;
      categoryIds?: string[];
      previousCategoryIds?: string[];
      actor?: string;
    };
    const pmid = (body.pmid ?? "").trim();
    const next = [...new Set(body.categoryIds ?? [])];
    const actor = (body.actor ?? "").trim() || "unknown";
    if (!pmid) return Response.json({ error: "pmid is required." }, { status: 400 });
    if (next.length === 0)
      return Response.json({ error: "A study needs at least one category." }, { status: 400 });

    const cats = await sb.from("categories").select("id, name, parent");
    if (cats.error) return Response.json({ error: cats.error.message }, { status: 500 });
    const known = new Map(cats.data.map((c) => [c.id, c]));
    const ukjent = next.filter((id) => !known.has(id));
    if (ukjent.length) return Response.json({ error: `Unknown category: ${ukjent.join(", ")}` }, { status: 400 });

    const existing = await sb.from("study_categories").select("category_id").eq("pmid", pmid);
    if (existing.error)
      return Response.json(
        { error: "Category editing needs migration 0003 (supabase/migrations) to be run first." },
        { status: 503 }
      );

    const prev = existing.data.length
      ? existing.data.map((r) => r.category_id)
      : [...new Set(body.previousCategoryIds ?? [])];
    const removed = prev.filter((id) => !next.includes(id));
    const added = next.filter((id) => !prev.includes(id));

    // Replace the assignment.
    const wipe = await sb.from("study_categories").delete().eq("pmid", pmid);
    if (wipe.error) return Response.json({ error: wipe.error.message }, { status: 500 });
    const now = new Date().toISOString();
    const ins = await sb
      .from("study_categories")
      .insert(next.map((category_id) => ({ pmid, category_id, updated_by: actor, updated_at: now })));
    if (ins.error) return Response.json({ error: ins.error.message }, { status: 500 });

    // Move this study's findings out of the categories the study just left.
    let movedFindings = 0;
    let movedTo: string | null = null;
    if (removed.length && added.length) {
      const target = added[0];
      const study = await sb.from("studies").select("id").eq("pmid", pmid).maybeSingle();
      if (study.data) {
        const berorte = await sb
          .from("claims")
          .select("id, status, category_id")
          .eq("study_id", study.data.id)
          .in("category_id", removed);
        if (berorte.error) return Response.json({ error: berorte.error.message }, { status: 500 });

        if (berorte.data.length) {
          const upd = await sb
            .from("claims")
            .update({ category_id: target })
            .in("id", berorte.data.map((c) => c.id));
          if (upd.error) return Response.json({ error: upd.error.message }, { status: 500 });

          // Audit trail: the status does not change, but the re-filing is recorded so a reviewer
          // can see why a finding turned up under a different category.
          await sb.from("claim_events").insert(
            berorte.data.map((c) => ({
              claim_id: c.id,
              actor,
              from_status: c.status,
              to_status: c.status,
              note: `Moved with the study from ${known.get(c.category_id)?.name ?? c.category_id} to ${
                known.get(target)?.name ?? target
              }`,
            }))
          );
          movedFindings = berorte.data.length;
          movedTo = known.get(target)?.name ?? target;
        }
      }
    }

    return Response.json({ ok: true, categoryIds: next, movedFindings, movedTo });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
