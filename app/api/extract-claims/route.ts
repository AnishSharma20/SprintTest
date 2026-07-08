// /api/extract-claims — AI claim extraction with deterministic quote grounding.
//
// POST { study: StudyMeta, fullText?: string, actor?: string }
//   1. Source text: the pasted/uploaded full text if provided, otherwise the PubMed abstract.
//   2. Claude extracts atomic candidate claims, each with a VERBATIM supporting quote
//      and a science category.
//   3. Every quote is verified deterministically (normalized substring match against the
//      source text — no AI judgment). Claims whose quote fails the check are inserted
//      with verified = false so reviewers see exactly which ones lack grounding.
//   4. Claims land as status pending_review, origin ai_extracted — nothing is approved
//      by the machine. Re running skips claims whose text already exists for the study
//      (including rejected ones, so rejected claims are not re proposed).

import Anthropic from "@anthropic-ai/sdk";
import { supabase, dbNotConfigured } from "../../lib/supabase";
import { getOrCreateStudy, logEvent, type StudyMeta } from "../../lib/claims-db";

export const runtime = "nodejs";
export const maxDuration = 60;

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const FELLES = "tool=llm-wiki&email=anish.sharma@sprint.no";

type Extracted = { text: string; quote: string; location?: string; category: string };

/** Normalize for quote matching: unify unicode dashes/quotes, collapse whitespace, lowercase. */
function norm(s: string): string {
  return s
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

async function fetchAbstract(pmid: string): Promise<string | null> {
  const res = await fetch(
    `${EUTILS}/efetch.fcgi?db=pubmed&${FELLES}&retmode=xml&rettype=abstract&id=${pmid}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const xml = await res.text();
  const parts = [...xml.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map((m) =>
    m[1]
      .replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
      .trim()
  );
  const text = parts.join("\n\n").trim();
  return text || null;
}

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ error: "ANTHROPIC_API_KEY is not configured." }, { status: 503 });

  try {
    const body = await req.json();
    const study = body.study as StudyMeta;
    const actor: string = (body.actor || "unknown").trim() || "unknown";
    if (!study?.pmid || !study?.title)
      return Response.json({ error: "study (pmid, title) is required." }, { status: 400 });

    // 1) Source text: uploaded full text wins; otherwise fall back to the PubMed abstract.
    let fullText: string | null = (body.fullText || "").trim() || null;
    let source: "upload" | "abstract_only" = "upload";
    if (!fullText) {
      fullText = await fetchAbstract(study.pmid);
      source = "abstract_only";
    }
    if (!fullText)
      return Response.json(
        { error: "No source text available: PubMed has no abstract for this study. Paste the full text instead." },
        { status: 422 }
      );

    const studyId = await getOrCreateStudy(sb, study);
    await sb.from("studies").update({ full_text: fullText, full_text_source: source }).eq("id", studyId);

    // 2) Science categories the model may choose from.
    const cats = await sb.from("categories").select("id, name").eq("parent", "science").order("sort_order");
    if (cats.error) return Response.json({ error: cats.error.message }, { status: 500 });
    const validCats = new Set(cats.data.map((c) => c.id));
    const fallbackCat = validCats.has("other_science") ? "other_science" : cats.data[0]?.id;
    const catList = cats.data.map((c) => `${c.id}: ${c.name}`).join("\n");

    // 3) Extract atomic claims + verbatim quotes.
    const anthropic = new Anthropic();
    const prompt =
`You extract atomic scientific claims from a study for a claims library that a science team will review and approve. Accuracy is critical: a claim may only state what the source text supports, and every claim must be backed by a quote copied EXACTLY from the source.

Study: "${study.title}" (PMID ${study.pmid})

Source text (${source === "abstract_only" ? "abstract only" : "full text"}):
<source>
${fullText.slice(0, 60000)}
</source>

Available science categories (use the id):
${catList}

Rules:
- One fact per claim. Keep each claim to a single, self contained sentence.
- Prefer claims with specific numbers (doses, durations, effect sizes, p values, populations).
- "quote" MUST be copied character for character from the source text above. Do not paraphrase, trim mid word, or fix typos. Pick the shortest span that supports the claim.
- Do not invent findings the source does not state. If the source is only an abstract, extract only what it contains.
- Do not use dash characters ("-", "—", "–") in the "text" field; reword instead. Quotes are copied verbatim regardless.

Return ONLY a JSON object: {"claims": [{"text": "...", "quote": "...", "location": "e.g. Results", "category": "one of the ids above"}]}`;

    const msg = await anthropic.messages.create({
      model: process.env.CLAIMS_MODEL || "claude-sonnet-5",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = msg.content.find((b) => b.type === "text")?.text ?? "";
    const jsonText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    let extracted: Extracted[];
    try {
      extracted = (JSON.parse(jsonText).claims ?? []) as Extracted[];
    } catch {
      return Response.json({ error: "Model did not return valid JSON.", raw }, { status: 502 });
    }

    // 4) Skip claims whose text already exists for this study (rejected included).
    const existing = await sb.from("claims").select("text").eq("study_id", studyId);
    const seen = new Set((existing.data ?? []).map((c) => norm(c.text)));
    const haystack = norm(fullText);

    let created = 0;
    let unverified = 0;
    let skipped = 0;
    for (const c of extracted) {
      if (!c.text?.trim() || !c.quote?.trim()) continue;
      if (seen.has(norm(c.text))) { skipped++; continue; }
      seen.add(norm(c.text));

      const category = validCats.has(c.category) ? c.category : fallbackCat;
      const verified = haystack.includes(norm(c.quote));
      if (!verified) unverified++;

      const claim = await sb
        .from("claims")
        .insert({
          scope: "paper",
          claim_type: "science",
          category_id: category,
          study_id: studyId,
          text: c.text.trim(),
          status: "pending_review",
          origin: "ai_extracted",
          created_by: actor,
        })
        .select("id")
        .single();
      if (claim.error) continue;

      await sb.from("claim_quotes").insert({
        claim_id: claim.data.id,
        quote: c.quote.trim(),
        location: c.location ?? null,
        verified,
        verified_at: verified ? new Date().toISOString() : null,
      });
      await logEvent(sb, claim.data.id, actor, null, "pending_review",
        verified ? "Extracted by AI (quote verified)" : "Extracted by AI (quote NOT found in source)");
      created++;
    }

    return Response.json({ created, unverified, skipped, source, total: extracted.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
