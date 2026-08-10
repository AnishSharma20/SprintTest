// POST /api/admin/generate-marketing — draft FINDINGS (the endpoint-result layer) FROM the
// science evidence, one study at a time.
//
// Rewritten 2026-08-10 per regulatory feedback: a finding restates what ONE study measured on
// its own primary/secondary endpoint ("Stonehouse 2022: Krill oil improved osteoarthritic knee
// pain... (6-month RCT, ...)"), never a consumer benefit statement — that phrasing work moves
// downstream, out of this library. So generation is now PER STUDY (mirrors extractForStudy's
// per-study loop in app/lib/claims-extract.ts), producing paper-scope claims with a real
// study_id, not category-scope rollups across many studies.
//
// Idempotent: skips a study that already has a paper-scope marketing finding. Gated like the
// other admin routes.

import Anthropic from "@anthropic-ai/sdk";
import { supabase, dbNotConfigured } from "../../../lib/supabase";
import { logEvent } from "../../../lib/claims-db";

export const runtime = "nodejs";
export const maxDuration = 300;

type Drafted = { text: string; category: string; supports: string[] };
type StudyInfo = { id: string; pmid: string | null; title: string; authors: string | null; year: number | null };

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ error: "ANTHROPIC_API_KEY is not configured." }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const expected = process.env.SEED_TOKEN || process.env.ADMIN_TOKEN;
  if (expected) {
    if (body?.token !== expected) return Response.json({ error: "Unauthorized." }, { status: 401 });
  } else {
    const host = new URL(req.url).hostname;
    if (host !== "localhost" && host !== "127.0.0.1")
      return Response.json({ error: "Set SEED_TOKEN to run this on a deployed environment." }, { status: 401 });
  }

  const cats = await sb.from("categories").select("id, name").eq("parent", "science").order("sort_order");
  if (cats.error) return Response.json({ error: cats.error.message }, { status: 500 });
  const catIds = new Set(cats.data.map((c) => c.id));
  const catList = cats.data.map((c) => `${c.id} (${c.name})`).join(", ");

  // Science claims (the evidence), grouped by study — a finding restates ONE study's own result.
  const science = await sb
    .from("claims")
    .select("id, category_id, text, study_id, studies(id, pmid, title, authors, year)")
    .eq("claim_type", "science")
    .neq("status", "superseded")
    .not("study_id", "is", null);
  if (science.error) return Response.json({ error: science.error.message }, { status: 500 });

  // Skip studies that already have a paper-scope marketing finding, so re-runs never duplicate.
  const existingMkt = await sb
    .from("claims")
    .select("study_id")
    .eq("claim_type", "marketing")
    .eq("scope", "paper")
    .not("study_id", "is", null);
  const studiesWithFindings = new Set((existingMkt.data ?? []).map((c) => c.study_id));

  const byStudy: Record<string, { study: StudyInfo; evidence: { id: string; text: string }[] }> = {};
  for (const c of science.data ?? []) {
    const s = c.studies as unknown as StudyInfo | null;
    if (!s || !c.study_id) continue;
    const entry = (byStudy[c.study_id] ??= { study: s, evidence: [] });
    entry.evidence.push({ id: c.id, text: c.text });
  }

  const anthropic = new Anthropic();
  const results: { study_id: string; created?: number; skipped?: boolean; error?: string }[] = [];
  let totalCreated = 0;

  for (const [studyId, { study, evidence }] of Object.entries(byStudy)) {
    if (studiesWithFindings.has(studyId)) { results.push({ study_id: studyId, skipped: true }); continue; }
    if (evidence.length === 0) { results.push({ study_id: studyId, skipped: true }); continue; }

    const authorYear = [study.authors?.split(",")[0]?.trim().split(/\s+/)[0], study.year]
      .filter(Boolean)
      .join(" ");
    const evText = evidence
      .slice(0, 40)
      .map((e, i) => `[C${i + 1}] ${e.text}`)
      .join("\n");
    const prompt =
`You write FINDINGS for Aker BioMarine's Superba krill oil research library. A finding restates what ONE study measured on its own primary or secondary endpoint — never a consumer benefit statement. Marketing copy is written separately, downstream, FROM these findings; the finding itself must read like a fact sheet entry a scientist would sign off on.

Study: "${study.title}"${authorYear ? ` (${authorYear})` : ""}

Extracted findings from THIS study's reviewed evidence, each tagged [C1], [C2], and so on:
${evText}

Write 1 to 3 FINDINGS for this study, each phrased EXACTLY as:
"${authorYear || "[Author] [Year]"}: [short result on the primary or secondary endpoint] ([study design])"

Example of the required pattern: "Stonehouse 2022: Krill oil improved osteoarthritic knee pain in adults with mild to moderate knee osteoarthritis (6-month RCT, multicenter, double-blind, placebo-controlled)"

Rules:
- FORBIDDEN: consumer benefit language ("supports easy X", "helps your body Y", "with ease", "reduces Z"). State the endpoint result plainly, the way the study itself reports it.
- Every finding must state: the endpoint it concerns, the direction (and size, if the evidence gives a number) of the effect, and the study design in parentheses at the end.
- Stay TRUE to the evidence: never state an effect the findings do not support.
- Each finding must cite one or more of the tagged findings above.
- Pick the single most relevant category id for each finding from: ${catList}
- Do NOT use dash characters ("-", "—", "–"); reword instead.
Return ONLY JSON: {"findings":[{"text":"...","category":"<id>","supports":["C1","C3"]}]}`;

    try {
      const msg = await anthropic.messages.create({
        model: process.env.CLAIMS_MODEL || "claude-sonnet-5",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = msg.content.find((b) => b.type === "text")?.text ?? "";
      const drafted = (JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)).findings ??
        []) as Drafted[];

      let created = 0;
      for (const d of drafted) {
        if (!d.text?.trim() || !catIds.has(d.category)) continue;
        const supportIdx = (d.supports ?? [])
          .map((t) => parseInt(String(t).replace(/[^0-9]/g, ""), 10) - 1)
          .filter((n) => n >= 0 && n < evidence.length);
        if (supportIdx.length === 0) continue; // never create an unsubstantiated finding

        const claim = await sb
          .from("claims")
          .insert({
            scope: "paper",
            claim_type: "marketing",
            category_id: d.category,
            study_id: studyId,
            text: d.text.trim(),
            status: "pending_review",
            origin: "ai_extracted",
            created_by: "marketing-gen",
          })
          .select("id")
          .single();
        if (claim.error) continue;

        await sb.from("claim_links").insert(
          supportIdx.map((n) => ({
            parent_claim_id: claim.data.id,
            child_claim_id: evidence[n].id,
            relation: "backed_by",
          }))
        );
        await logEvent(sb, claim.data.id, "marketing-gen", null, "pending_review",
          "Drafted from evidence");
        created++;
      }
      totalCreated += created;
      results.push({ study_id: studyId, created });
    } catch (e) {
      results.push({ study_id: studyId, error: (e as Error).message });
    }
  }

  return Response.json({ total_findings_created: totalCreated, results });
}
