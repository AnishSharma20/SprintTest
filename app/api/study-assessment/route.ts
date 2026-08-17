// /api/study-assessment — the Science team's own per study record.
//
//   GET /api/study-assessment   { configured, migrated, byPmid: { [pmid]: Assessment } }
//   PUT /api/study-assessment   { pmid, reviewer, abstract?, keyFindingsAssessment?,
//                                 verified?, akbmRole? }
//
// Four separate things, all attributed and all laid over the base study list client side by
// app/study-meta.ts (same pattern as quality and categories):
//   abstract               an override on the paper's own abstract from app/study-abstracts.json
//   keyFindingsAssessment  the team's own read of the key findings, in their own words
//   verified               "verified by science" (migration 0016) — a deliberate tick. It used to
//                          be derived: curated studies were verified by definition and editing a
//                          summary silently flipped a study to verified. Both couplings are gone.
//   akbmRole               what Aker BioMarine's role in the study was (migration 0016),
//                          overriding the built in AKBM_ROLES value in app/studies.ts
//
// A PUT is a PATCH in practice: only the keys present in the body are written, so ticking
// `verified` cannot blank an abstract someone else wrote, and vice versa.

import { supabase, dbNotConfigured } from "../../lib/supabase";
import { isAkbmRole } from "../../akbm-role";

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
      // Absent before migration 0016; an old row reads as unverified with no role recorded.
      verified: !!r.verified,
      akbmRole: r.akbm_role ?? null,
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
      verified?: boolean;
      akbmRole?: string | null;
      reviewer?: string;
    };
    const pmid = (body.pmid ?? "").trim();
    const reviewer = (body.reviewer ?? "").trim();

    if (!pmid) return Response.json({ error: "pmid is required." }, { status: 400 });
    if (!reviewer)
      return Response.json({ error: "Add your name in the Reviewer field before saving." }, { status: 400 });

    // Only the fields the caller actually sent are written. PostgREST builds its
    // ON CONFLICT DO UPDATE SET list from the payload's own keys, so this upsert behaves as a
    // patch: ticking "verified by science" cannot blank an abstract someone else wrote.
    const row: Record<string, unknown> = {
      pmid,
      updated_by: reviewer,
      updated_at: new Date().toISOString(),
    };
    if (body.abstract !== undefined) row.abstract = body.abstract.trim() || null;
    if (body.keyFindingsAssessment !== undefined)
      row.key_findings_assessment = body.keyFindingsAssessment.trim() || null;
    if (body.verified !== undefined) row.verified = !!body.verified;
    if (body.akbmRole !== undefined) {
      const role = (body.akbmRole ?? "").trim();
      if (role && !isAkbmRole(role))
        return Response.json({ error: `Unknown Aker BioMarine role "${role}".` }, { status: 400 });
      row.akbm_role = role || null;   // clearing it hands the study back to the built in value
    }
    if (Object.keys(row).length === 3)
      return Response.json(
        { error: "Nothing to save. Send an abstract, an assessment, a verified flag or a role." },
        { status: 400 }
      );

    const up = await sb.from("study_assessment").upsert(row).select("*").single();
    if (up.error)
      return Response.json(
        { error: `Could not save. ${up.error.message} (have migrations 0010 and 0016 been run?)` },
        { status: 500 }
      );
    return Response.json({ assessment: up.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
