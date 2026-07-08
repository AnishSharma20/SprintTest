// POST /api/admin/extract-all — pre-fill the claims library: run AI extraction across every
// study in the `studies` table that has no claims yet. Idempotent (skips studies that already
// have claims), so it is safe to re-run. This is the ONLY path that creates AI claims now — the
// end-user UI does not extract.
//
// Gated by a token: send { token } matching SEED_TOKEN (or ADMIN_TOKEN). If neither env var is
// set, it runs from localhost only. Long-running (one Claude call per study) — intended to be
// run locally, where there is no serverless timeout.

import { supabase, dbNotConfigured } from "../../../lib/supabase";
import { extractForStudy } from "../../../lib/claims-extract";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ error: "ANTHROPIC_API_KEY is not configured." }, { status: 503 });

  const expected = process.env.SEED_TOKEN || process.env.ADMIN_TOKEN;
  const { token } = await req.json().catch(() => ({ token: undefined }));
  if (expected) {
    if (token !== expected) return Response.json({ error: "Unauthorized." }, { status: 401 });
  } else {
    const host = new URL(req.url).hostname;
    if (host !== "localhost" && host !== "127.0.0.1")
      return Response.json({ error: "Set SEED_TOKEN to run this on a deployed environment." }, { status: 401 });
  }

  const studies = await sb
    .from("studies")
    .select("id, pmid, doi, title, authors, year, journal, verification")
    .order("created_at");
  if (studies.error) return Response.json({ error: studies.error.message }, { status: 500 });

  // Which studies already have at least one claim → skip them (idempotent).
  const withClaims = await sb.from("claims").select("study_id");
  if (withClaims.error) return Response.json({ error: withClaims.error.message }, { status: 500 });
  const hasClaims = new Set((withClaims.data ?? []).map((c) => c.study_id));

  const results: { pmid: string | null; title: string; created?: number; skipped?: boolean; error?: string }[] = [];
  let totalCreated = 0;
  for (const s of studies.data ?? []) {
    if (!s.pmid) { results.push({ pmid: null, title: s.title, error: "no pmid" }); continue; }
    if (hasClaims.has(s.id)) { results.push({ pmid: s.pmid, title: s.title, skipped: true }); continue; }
    try {
      const r = await extractForStudy(sb, {
        pmid: s.pmid,
        doi: s.doi,
        title: s.title,
        authors: s.authors,
        year: s.year,
        journal: s.journal,
        verification: s.verification,
      });
      totalCreated += r.created;
      results.push({ pmid: s.pmid, title: s.title, created: r.created });
    } catch (e) {
      results.push({ pmid: s.pmid, title: s.title, error: (e as Error).message });
    }
  }

  return Response.json({
    studies: studies.data?.length ?? 0,
    extracted: results.filter((r) => typeof r.created === "number").length,
    skipped: results.filter((r) => r.skipped).length,
    total_claims_created: totalCreated,
    results,
  });
}
