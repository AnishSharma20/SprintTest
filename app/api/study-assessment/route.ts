// /api/study-assessment — the Science team's own per study write up.
//
//   GET /api/study-assessment                 { configured, migrated, byPmid: { [pmid]: Assessment } }
//   PUT /api/study-assessment                  { pmid, abstract?, keyFindingsAssessment?, reviewer }
//
// Distinct from the page's existing Background/Design/Findings/Limitations summary (AI written
// or curated from the whitepaper) and from the numeric quality score: this is the Science team's
// own abstract as they read it, and their own assessment of the key findings, in their own words.
// Attributed the same way quality/categories are, laid over the base study list client side by
// app/study-meta.ts.

import { supabase, dbNotConfigured } from "../../lib/supabase";

export async function GET() {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, migrated: false, byPmid: {} });

  const res = await sb.from("study_assessment").select("*");
  // Before migration 0010 the table does not exist.
  if (res.error) return Response.json({ configured: true, migrated: false, byPmid: {} });

  const byPmid: Record<string, unknown> = {};
  for (const r of res.data)
    byPmid[r.pmid] = {
      abstract: r.abstract,
      keyFindingsAssessment: r.key_findings_assessment,
      updated_by: r.updated_by,
      updated_at: r.updated_at,
    };
  return Response.json({ configured: true, migrated: true, byPmid });
}

export async function PUT(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const body = (await req.json()) as {
      pmid?: string;
      abstract?: string;
      keyFindingsAssessment?: string;
      reviewer?: string;
    };
    const pmid = (body.pmid ?? "").trim();
    const reviewer = (body.reviewer ?? "").trim();
    const abstract = (body.abstract ?? "").trim() || null;
    const keyFindingsAssessment = (body.keyFindingsAssessment ?? "").trim() || null;

    if (!pmid) return Response.json({ error: "pmid is required." }, { status: 400 });
    if (!reviewer)
      return Response.json({ error: "Add your name in the Reviewer field before saving." }, { status: 400 });
    if (!abstract && !keyFindingsAssessment)
      return Response.json({ error: "Add an abstract or a key findings assessment." }, { status: 400 });

    const up = await sb
      .from("study_assessment")
      .upsert({
        pmid,
        abstract,
        key_findings_assessment: keyFindingsAssessment,
        updated_by: reviewer,
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (up.error)
      return Response.json(
        { error: `Could not save. ${up.error.message} (has migration 0010 been run?)` },
        { status: 500 }
      );
    return Response.json({ assessment: up.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
