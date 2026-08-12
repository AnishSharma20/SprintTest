// /api/custom-studies — studies a reviewer added directly (uploaded a PDF the site otherwise has
// no way to carry: no PMID, or AKBM never supplied it as part of the curated/full text library).
//
//   GET  /api/custom-studies   { configured, migrated, studies: [...] }
//   POST /api/custom-studies   create one, from the "Add study" flow's review step

import { supabase, dbNotConfigured } from "../../lib/supabase";
import { canonicalStudyPmids } from "../../studies";

const LABELS = ["High", "Moderate", "Low"];
const DIRECTIONS = ["positive", "neutral", "negative"];

export async function GET() {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, migrated: false, studies: [] });

  const res = await sb.from("custom_studies").select("*").order("created_at", { ascending: false });
  // Before migration 0011 the table does not exist.
  if (res.error) return Response.json({ configured: true, migrated: false, studies: [] });
  return Response.json({ configured: true, migrated: true, studies: res.data });
}

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const body = await req.json();
    const {
      pmid,
      doi,
      title,
      authors,
      year,
      journal,
      storage_path,
      pdf_filename,
      full_text,
      abstract,
      key_findings_assessment,
      quality_score,
      quality_label,
      outcome_direction,
      category_ids,
      created_by,
    } = body as {
      pmid?: string;
      doi?: string;
      title?: string;
      authors?: string;
      year?: number | string;
      journal?: string;
      storage_path?: string;
      pdf_filename?: string;
      full_text?: string;
      abstract?: string;
      key_findings_assessment?: string;
      quality_score?: number | string;
      quality_label?: string;
      outcome_direction?: string;
      category_ids?: string[];
      created_by?: string;
    };

    // Unlike findings/quality (scientific judgements that must be attributable), adding a study
    // is not traced to a person — no sign in is required for this flow.
    const reviewer = (created_by ?? "").trim() || "Unattributed";
    const cleanTitle = (title ?? "").trim();
    const cleanAuthors = (authors ?? "").trim();
    const cleanYear = year ? parseInt(String(year), 10) || null : null;
    const cleanPmid = (pmid ?? "").trim() || null;
    const path = (storage_path ?? "").trim();

    if (!cleanTitle) return Response.json({ error: "Title is required." }, { status: 400 });
    if (!cleanAuthors) return Response.json({ error: "Authors are required." }, { status: 400 });
    if (!cleanYear) return Response.json({ error: "Year is required." }, { status: 400 });
    if (!path) return Response.json({ error: "Upload the PDF before saving." }, { status: 400 });
    if (!Array.isArray(category_ids) || category_ids.length === 0)
      return Response.json({ error: "Pick at least one benefit area." }, { status: 400 });

    // Never let a manually added study shadow one already in the library — that study should be
    // edited in place instead (the same rule /api/claims enforces for findings).
    if (cleanPmid && canonicalStudyPmids().has(cleanPmid))
      return Response.json({ error: "This PMID is already in the Scientific Studies library." }, { status: 400 });
    if (cleanPmid) {
      const dupe = await sb.from("custom_studies").select("id").eq("pmid", cleanPmid).maybeSingle();
      if (dupe.data)
        return Response.json({ error: "A study with this PMID has already been added." }, { status: 400 });
    }

    const cats = await sb.from("categories").select("id").eq("parent", "science");
    if (cats.error) return Response.json({ error: cats.error.message }, { status: 500 });
    const validCats = new Set(cats.data.map((c) => c.id));
    const cleanCatIds = [...new Set(category_ids)].filter((id) => validCats.has(id));
    if (cleanCatIds.length === 0)
      return Response.json({ error: "Pick at least one real benefit area." }, { status: 400 });

    const score = quality_score === undefined || quality_score === null || quality_score === "" ? null : Math.round(Number(quality_score));
    if (score !== null && (!Number.isFinite(score) || score < 0 || score > 100))
      return Response.json({ error: "Quality score must be a number between 0 and 100." }, { status: 400 });
    const label = (quality_label ?? "").trim() || null;
    if (label && !LABELS.includes(label))
      return Response.json({ error: "Quality rating must be High, Moderate or Low." }, { status: 400 });
    const direction = (outcome_direction ?? "").trim() || null;
    if (direction && !DIRECTIONS.includes(direction))
      return Response.json({ error: "Outcome must be positive, neutral or negative." }, { status: 400 });

    const inserted = await sb
      .from("custom_studies")
      .insert({
        pmid: cleanPmid,
        doi: (doi ?? "").trim() || null,
        title: cleanTitle,
        authors: cleanAuthors,
        year: cleanYear,
        journal: (journal ?? "").trim() || null,
        storage_path: path,
        pdf_filename: (pdf_filename ?? "").trim() || null,
        full_text: full_text ?? null,
        abstract: (abstract ?? "").trim() || null,
        key_findings_assessment: (key_findings_assessment ?? "").trim() || null,
        quality_score: score,
        quality_label: label,
        outcome_direction: direction,
        category_ids: cleanCatIds,
        created_by: reviewer,
      })
      .select("*")
      .single();
    if (inserted.error)
      return Response.json(
        { error: `Could not save the study. ${inserted.error.message} (has migration 0011 been run?)` },
        { status: 500 }
      );

    return Response.json({ study: inserted.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
