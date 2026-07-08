// POST /api/admin/extract-all — pre-fill the claims library: run AI extraction across every
// study in the `studies` table that has no claims yet. Idempotent (skips studies that already
// have claims), so it is safe to re-run. This is the ONLY path that creates AI claims now — the
// end-user UI does not extract.
//
// Gated by a token: send { token } matching SEED_TOKEN (or ADMIN_TOKEN). If neither env var is
// set, it runs from localhost only. Long-running (one Claude call per study) — intended to be
// run locally, where there is no serverless timeout.

import { supabase, dbNotConfigured } from "../../../lib/supabase";
import { extractForStudy, fetchPmcFullText } from "../../../lib/claims-extract";

export const runtime = "nodejs";
// Vercel Hobby caps maxDuration at 300s. This is a local/admin pre-fill route (dev has no
// timeout, so it runs to completion there); 300 keeps the production build valid.
export const maxDuration = 300;

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ error: "ANTHROPIC_API_KEY is not configured." }, { status: 503 });

  const expected = process.env.SEED_TOKEN || process.env.ADMIN_TOKEN;
  const body = await req.json().catch(() => ({}));
  const token = body?.token;
  // upgrade mode: re-extract PMC open-access studies from full text, replacing their
  // pending AI claims (leaves approved/rejected/human claims untouched).
  const upgrade = body?.upgrade === true;
  if (expected) {
    if (token !== expected) return Response.json({ error: "Unauthorized." }, { status: 401 });
  } else {
    const host = new URL(req.url).hostname;
    if (host !== "localhost" && host !== "127.0.0.1")
      return Response.json({ error: "Set SEED_TOKEN to run this on a deployed environment." }, { status: 401 });
  }

  const studies = await sb
    .from("studies")
    .select("id, pmid, doi, title, authors, year, journal, verification, full_text_source")
    .order("created_at");
  if (studies.error) return Response.json({ error: studies.error.message }, { status: 500 });

  // Which studies already have at least one claim → skip them in normal (pre-fill) mode.
  const withClaims = await sb.from("claims").select("study_id");
  if (withClaims.error) return Response.json({ error: withClaims.error.message }, { status: 500 });
  const hasClaims = new Set((withClaims.data ?? []).map((c) => c.study_id));

  const meta = (s: (typeof studies.data)[number]) => ({
    pmid: s.pmid!,
    doi: s.doi,
    title: s.title,
    authors: s.authors,
    year: s.year,
    journal: s.journal,
    verification: s.verification,
  });

  const results: {
    pmid: string | null;
    title: string;
    created?: number;
    upgraded?: boolean;
    skipped?: boolean;
    error?: string;
  }[] = [];
  let totalCreated = 0;
  let upgradedCount = 0;

  for (const s of studies.data ?? []) {
    if (!s.pmid) { results.push({ pmid: null, title: s.title, error: "no pmid" }); continue; }
    try {
      if (upgrade) {
        // Only touch studies that are NOT already on PMC full text.
        if (s.full_text_source === "pmc_oa") { results.push({ pmid: s.pmid, title: s.title, skipped: true }); continue; }
        const pmc = await fetchPmcFullText(s.pmid);
        if (!pmc) { results.push({ pmid: s.pmid, title: s.title, skipped: true }); continue; }
        // Extract the full-text claims FIRST, then delete the OLD pending AI claims (those
        // created before this run). If extraction throws, nothing is deleted — a study is
        // never left empty. Approved/rejected/human claims are always kept.
        const cutoff = new Date().toISOString();
        const r = await extractForStudy(sb, meta(s), { fullText: pmc, fullTextSource: "pmc_oa" });
        await sb.from("claims").delete()
          .eq("study_id", s.id).eq("origin", "ai_extracted").eq("status", "pending_review")
          .lt("created_at", cutoff);
        totalCreated += r.created;
        upgradedCount++;
        results.push({ pmid: s.pmid, title: s.title, upgraded: true, created: r.created });
        continue;
      }
      if (hasClaims.has(s.id)) { results.push({ pmid: s.pmid, title: s.title, skipped: true }); continue; }
      const r = await extractForStudy(sb, meta(s));
      totalCreated += r.created;
      results.push({ pmid: s.pmid, title: s.title, created: r.created });
    } catch (e) {
      results.push({ pmid: s.pmid, title: s.title, error: (e as Error).message });
    }
  }

  return Response.json({
    mode: upgrade ? "upgrade" : "prefill",
    studies: studies.data?.length ?? 0,
    extracted: results.filter((r) => typeof r.created === "number" && !r.upgraded).length,
    upgraded: upgradedCount,
    skipped: results.filter((r) => r.skipped).length,
    total_claims_created: totalCreated,
    results,
  });
}
