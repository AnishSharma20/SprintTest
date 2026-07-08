// Shared claim-extraction core (server-only). Used to PRE-FILL the claims library:
// /api/admin/extract-all runs it across every study. End users no longer trigger extraction
// from the UI — the library is populated ahead of time, and users review + add claims by hand.
//
// AI extracts atomic claims each with a verbatim quote; the quote is verified deterministically
// (normalized substring match against the source text — no AI judgment). Claims land as
// pending_review, origin ai_extracted; nothing is auto-approved.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOrCreateStudy, logEvent, type StudyMeta } from "./claims-db";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const FELLES = "tool=llm-wiki&email=anish.sharma@sprint.no";

type Extracted = { text: string; quote: string; location?: string; category: string };
export type ExtractResult = {
  created: number;
  unverified: number;
  skipped: number;
  source: "upload" | "abstract_only";
  total: number;
};

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

/**
 * Extract + store claims for one study. Returns counts. Throws on a hard failure
 * (no source text, model returned non-JSON, or a DB error on the study upsert).
 */
export async function extractForStudy(
  sb: SupabaseClient,
  study: StudyMeta,
  opts: { fullText?: string; actor?: string } = {}
): Promise<ExtractResult> {
  const actor = (opts.actor || "prefill").trim() || "prefill";

  // 1) Source text: provided full text wins; otherwise the PubMed abstract.
  let fullText: string | null = (opts.fullText || "").trim() || null;
  let source: "upload" | "abstract_only" = "upload";
  if (!fullText) {
    fullText = await fetchAbstract(study.pmid);
    source = "abstract_only";
  }
  if (!fullText) throw new Error("No source text available (no abstract on PubMed).");

  const studyId = await getOrCreateStudy(sb, study);
  await sb.from("studies").update({ full_text: fullText, full_text_source: source }).eq("id", studyId);

  // 2) Science categories the model may choose from.
  const cats = await sb.from("categories").select("id, name").eq("parent", "science").order("sort_order");
  if (cats.error) throw new Error(cats.error.message);
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
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });

  const raw = msg.content.find((b) => b.type === "text")?.text ?? "";
  const jsonText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  let extracted: Extracted[];
  try {
    extracted = (JSON.parse(jsonText).claims ?? []) as Extracted[];
  } catch {
    throw new Error("Model did not return valid JSON.");
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

  return { created, unverified, skipped, source, total: extracted.length };
}
