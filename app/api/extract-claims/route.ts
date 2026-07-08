// POST /api/extract-claims — AI claim extraction for ONE study (admin / programmatic use).
//
// The end-user UI no longer calls this: the claims library is pre-filled ahead of time
// (see /api/admin/extract-all), and reviewers add claims by hand. Kept as a thin wrapper over
// the shared extractor so a single study can still be (re)extracted when needed.

import { supabase, dbNotConfigured } from "../../lib/supabase";
import { extractForStudy } from "../../lib/claims-extract";
import type { StudyMeta } from "../../lib/claims-db";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ error: "ANTHROPIC_API_KEY is not configured." }, { status: 503 });

  try {
    const body = await req.json();
    const study = body.study as StudyMeta;
    if (!study?.pmid || !study?.title)
      return Response.json({ error: "study (pmid, title) is required." }, { status: 400 });

    const res = await extractForStudy(sb, study, {
      fullText: body.fullText,
      actor: (body.actor || "unknown").trim() || "unknown",
    });
    return Response.json(res);
  } catch (e) {
    const msg = (e as Error).message;
    const status = msg.includes("No source text") ? 422 : 500;
    return Response.json({ error: msg }, { status });
  }
}
