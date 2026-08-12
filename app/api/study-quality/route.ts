// /api/study-quality — reviewer set scientific quality for a study.
//
//   GET    /api/study-quality                 { configured, migrated, byPmid: { [pmid]: Quality } }
//   PUT    /api/study-quality                 { pmid, score, label, outcomeDirection, note?, reviewer }
//   DELETE /api/study-quality?pmid=12345      clear the score (falls back to the curated one)
//
// Two independent dimensions, both reviewer set: score/label is RESEARCH QUALITY (how
// rigorously the study was designed and run); outcomeDirection is which way the study's own
// RESULT pointed (positive/neutral/negative). They are deliberately kept separate — a rigorous
// trial can still land on a null/negative result (see KARAOKE, migration 0010's motivating
// example), and conflating the two into one score misrepresents one or the other.
//
// The reviewer's name is REQUIRED and stored with the timestamp: both are scientific judgements,
// so they have to be attributable. Every change also lands in study_quality_events, the same
// audit pattern the claims library uses.

import { supabase, dbNotConfigured } from "../../lib/supabase";

const LABELS = ["High", "Moderate", "Low"];
const DIRECTIONS = ["positive", "neutral", "negative"];

export async function GET() {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, migrated: false, byPmid: {} });

  const res = await sb.from("study_quality").select("*");
  // Before migration 0003 the table does not exist — only the curated scores are shown.
  if (res.error) return Response.json({ configured: true, migrated: false, byPmid: {} });

  const byPmid: Record<string, unknown> = {};
  for (const r of res.data)
    byPmid[r.pmid] = {
      score: r.score,
      label: r.label,
      outcomeDirection: r.outcome_direction ?? null,
      note: r.note,
      reviewed_by: r.reviewed_by,
      reviewed_at: r.reviewed_at,
    };
  return Response.json({ configured: true, migrated: true, byPmid });
}

export async function PUT(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const body = (await req.json()) as {
      pmid?: string;
      score?: number | string;
      label?: string;
      outcomeDirection?: string | null;
      note?: string;
      reviewer?: string;
    };
    const pmid = (body.pmid ?? "").trim();
    const reviewer = (body.reviewer ?? "").trim();
    const score = Math.round(Number(body.score));
    const label = (body.label ?? "").trim();
    const outcomeDirection = (body.outcomeDirection ?? "").trim() || null;

    if (!pmid) return Response.json({ error: "pmid is required." }, { status: 400 });
    if (!reviewer)
      return Response.json({ error: "Add your name in the Reviewer field before setting a quality score." }, { status: 400 });
    if (!Number.isFinite(score) || score < 0 || score > 100)
      return Response.json({ error: "The score must be a number between 0 and 100." }, { status: 400 });
    if (!LABELS.includes(label))
      return Response.json({ error: "The rating must be High, Moderate or Low." }, { status: 400 });
    if (outcomeDirection && !DIRECTIONS.includes(outcomeDirection))
      return Response.json({ error: "The outcome direction must be positive, neutral or negative." }, { status: 400 });

    const note = (body.note ?? "").trim() || null;
    const reviewedAt = new Date().toISOString();
    const up = await sb
      .from("study_quality")
      .upsert({
        pmid,
        score,
        label,
        outcome_direction: outcomeDirection,
        note,
        reviewed_by: reviewer,
        reviewed_at: reviewedAt,
      })
      .select("*")
      .single();
    if (up.error)
      return Response.json(
        { error: `Could not save the score. ${up.error.message} (has migration 0010 been run?)` },
        { status: 500 }
      );

    await sb.from("study_quality_events").insert({
      pmid,
      actor: reviewer,
      action: "set",
      score,
      label,
      outcome_direction: outcomeDirection,
      note,
    });

    return Response.json({ quality: up.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  const { searchParams } = new URL(req.url);
  const pmid = (searchParams.get("pmid") ?? "").trim();
  const reviewer = (searchParams.get("reviewer") ?? "").trim();
  if (!pmid) return Response.json({ error: "pmid is required." }, { status: 400 });
  if (!reviewer)
    return Response.json({ error: "Add your name in the Reviewer field before clearing a score." }, { status: 400 });

  const del = await sb.from("study_quality").delete().eq("pmid", pmid);
  if (del.error) return Response.json({ error: del.error.message }, { status: 500 });
  await sb.from("study_quality_events").insert({ pmid, actor: reviewer, action: "cleared" });
  return Response.json({ ok: true });
}
