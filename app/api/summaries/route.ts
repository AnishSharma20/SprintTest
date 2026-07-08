// /api/summaries — shared (cross user) store for edited study summaries.
// Replaces the localStorage only store; the client falls back to localStorage when
// Supabase is not configured, so the tool keeps working before the DB is set up.
//
//   GET  /api/summaries            { configured, overrides: { [pmid]: Summary } }
//   PUT  /api/summaries            { pmid, summary, editedBy? }  → upsert

import { supabase } from "../../lib/supabase";
import type { Summary } from "../../studies-data";

export async function GET() {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, overrides: {} });
  const res = await sb.from("summary_overrides").select("*");
  if (res.error) return Response.json({ error: res.error.message }, { status: 500 });
  const overrides: Record<string, Summary> = {};
  for (const r of res.data) {
    overrides[r.pmid] = {
      background: r.background,
      design: r.design,
      findings: r.findings,
      limitations: r.limitations,
    };
  }
  return Response.json({ configured: true, overrides });
}

export async function PUT(req: Request) {
  const sb = supabase();
  if (!sb)
    return Response.json({ configured: false, error: "Shared store not configured." }, { status: 503 });
  try {
    const { pmid, summary, editedBy } = (await req.json()) as {
      pmid?: string;
      summary?: Summary;
      editedBy?: string;
    };
    if (!pmid || !summary)
      return Response.json({ error: "pmid and summary are required." }, { status: 400 });
    const res = await sb.from("summary_overrides").upsert({
      pmid,
      background: summary.background,
      design: summary.design,
      findings: summary.findings,
      limitations: summary.limitations,
      edited_by: editedBy ?? null,
      updated_at: new Date().toISOString(),
    });
    if (res.error) return Response.json({ error: res.error.message }, { status: 500 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
