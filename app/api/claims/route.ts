// /api/claims — list and create claims.
//
//   GET  /api/claims?pmid=12345          claims for one study (all statuses, with quotes + comments)
//   GET  /api/claims?category=heart      claims in a category (paper + category scope)
//   GET  /api/claims                     everything (review queue), newest first
//   POST /api/claims                     create a human-authored claim (status pending_review)
//
// Every GET response includes { configured, categories, claims } so the UI can render
// filters without a second round trip, and can show a setup notice when Supabase is
// not configured yet.

import { supabase, dbNotConfigured } from "../../lib/supabase";
import { getOrCreateStudy, logEvent, type StudyMeta } from "../../lib/claims-db";

const CLAIM_SELECT =
  "*, claim_quotes(*), claim_comments(*), studies(pmid, title)";

export async function GET(req: Request) {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, categories: [], claims: [] });

  const { searchParams } = new URL(req.url);
  const pmid = searchParams.get("pmid");
  const category = searchParams.get("category");

  const categories = await sb.from("categories").select("*").order("sort_order");
  if (categories.error) return Response.json({ error: categories.error.message }, { status: 500 });

  let q = sb.from("claims").select(CLAIM_SELECT).order("created_at", { ascending: false });
  if (pmid) {
    const study = await sb.from("studies").select("id").eq("pmid", pmid).maybeSingle();
    if (study.error) return Response.json({ error: study.error.message }, { status: 500 });
    if (!study.data) return Response.json({ configured: true, categories: categories.data, claims: [] });
    q = q.eq("study_id", study.data.id);
  }
  if (category) q = q.eq("category_id", category);

  const claims = await q;
  if (claims.error) return Response.json({ error: claims.error.message }, { status: 500 });
  return Response.json({ configured: true, categories: categories.data, claims: claims.data });
}

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const body = await req.json();
    const {
      scope = "paper",
      claim_type = "science",
      category_id,
      text,
      created_by,
      study, // StudyMeta — required for paper claims
      quote, // optional supporting quote for a manually-added claim
    } = body as {
      scope?: string;
      claim_type?: string;
      category_id?: string;
      text?: string;
      created_by?: string;
      study?: StudyMeta;
      quote?: string;
    };

    if (!text?.trim()) return Response.json({ error: "Claim text is required." }, { status: 400 });
    if (!category_id) return Response.json({ error: "Category is required." }, { status: 400 });
    if (scope === "paper" && !study?.pmid)
      return Response.json({ error: "Paper claims need a study (pmid)." }, { status: 400 });

    const studyId = scope === "paper" && study ? await getOrCreateStudy(sb, study) : null;

    const inserted = await sb
      .from("claims")
      .insert({
        scope,
        claim_type,
        category_id,
        study_id: studyId,
        text: text.trim(),
        status: "pending_review",
        origin: "human",
        created_by: created_by ?? null,
      })
      .select(CLAIM_SELECT)
      .single();
    if (inserted.error) return Response.json({ error: inserted.error.message }, { status: 500 });

    // An optional supporting quote from a manual claim. Verify it against the study's stored
    // source text when we have it (so human-added quotes get the same green/red check).
    if (quote?.trim() && studyId) {
      const study_row = await sb.from("studies").select("full_text").eq("id", studyId).maybeSingle();
      const src = study_row.data?.full_text as string | undefined;
      const nrm = (s: string) => s.replace(/\s+/g, " ").toLowerCase().trim();
      const verified = !!src && nrm(src).includes(nrm(quote));
      await sb.from("claim_quotes").insert({
        claim_id: inserted.data.id,
        quote: quote.trim(),
        location: "Added by reviewer",
        verified,
        verified_at: verified ? new Date().toISOString() : null,
      });
    }

    await logEvent(sb, inserted.data.id, created_by ?? "unknown", null, "pending_review", "Created manually");
    // Re-select so the response includes any quote we just inserted.
    const full = await sb.from("claims").select(CLAIM_SELECT).eq("id", inserted.data.id).single();
    return Response.json({ claim: full.data ?? inserted.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
