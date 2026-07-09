// POST /api/admin/generate-marketing — draft the marketing-claims layer FROM the science evidence.
//
// Per science category, feed the science claims (tagged [C1], [C2], ...) to Claude, which writes a
// few marketing-usable product claims and says which findings back each one. We then create the
// marketing claims (pending_review) and the backed_by links to their supporting science claims.
// Idempotent: skips a category that already has marketing claims. Gated like the other admin routes.

import Anthropic from "@anthropic-ai/sdk";
import { supabase, dbNotConfigured } from "../../../lib/supabase";
import { logEvent } from "../../../lib/claims-db";

export const runtime = "nodejs";
export const maxDuration = 300;

type Drafted = { text: string; supports: string[] };

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

  // Science claims (the evidence) + which categories already have marketing claims (skip those).
  const science = await sb
    .from("claims")
    .select("id, category_id, text, studies(title)")
    .eq("claim_type", "science")
    .neq("status", "superseded");
  if (science.error) return Response.json({ error: science.error.message }, { status: 500 });

  const existingMkt = await sb.from("claims").select("category_id").eq("claim_type", "marketing");
  const catsWithMkt = new Set((existingMkt.data ?? []).map((c) => c.category_id));

  const byCat: Record<string, { id: string; text: string; study: string | null }[]> = {};
  for (const c of science.data ?? []) {
    (byCat[c.category_id] ??= []).push({
      id: c.id,
      text: c.text,
      study: (c.studies as unknown as { title: string } | null)?.title ?? null,
    });
  }

  const anthropic = new Anthropic();
  const results: { category: string; created?: number; skipped?: boolean; error?: string }[] = [];
  let totalCreated = 0;

  for (const cat of cats.data) {
    if (catsWithMkt.has(cat.id)) { results.push({ category: cat.id, skipped: true }); continue; }
    const evidence = (byCat[cat.id] ?? []).slice(0, 40);
    if (evidence.length < 2) { results.push({ category: cat.id, skipped: true }); continue; }

    const evText = evidence
      .map((e, i) => `[C${i + 1}] ${e.text}${e.study ? ` (Source: ${e.study})` : ""}`)
      .join("\n");
    const prompt =
`You write MARKETING CLAIMS for Aker BioMarine's Superba krill oil — short, benefit facing statements the brand can make about the product in the "${cat.name}" area. These are NOT verbatim science; they are what marketing can say, and each must be defensible against the findings below.

Findings from the reviewed studies, each tagged [C1], [C2], and so on:
${evText}

Write 2 to 4 MARKETING CLAIMS for "${cat.name}" — confident, benefit led copy of the kind that would appear on a product slide or in a brochure for supplement brands and informed consumers. The linked findings are the substantiation; the claim itself should read as marketing, not as a study.

Rules:
- Lead with the product benefit, in plain, positive language (e.g. "Superba krill oil supports healthy joint comfort in adults", "Superba krill oil raises your Omega 3 Index"). Do NOT write hedged, regulatory sounding restatements of the study. Avoid clinical phrasings like "reported adverse events at a similar or lower rate", "no toxicologically significant effects", "well tolerated in clinical research" — say it plainly and positively instead.
- Stay TRUE to the evidence: never claim a benefit, or a strength, the findings do not support. If the findings only show safety or tolerability, the claim is about being gentle and safe, not about efficacy. Never invent an effect.
- Each claim must be backed by one or more of the findings.
- Do NOT use dash characters ("-", "—", "–"); reword instead.
- Keep each claim to one sentence.
Return ONLY JSON: {"claims":[{"text":"...","supports":["C1","C3"]}]}`;

    try {
      const msg = await anthropic.messages.create({
        model: process.env.CLAIMS_MODEL || "claude-sonnet-5",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = msg.content.find((b) => b.type === "text")?.text ?? "";
      const drafted = (JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)).claims ??
        []) as Drafted[];

      let created = 0;
      for (const d of drafted) {
        if (!d.text?.trim()) continue;
        const supportIdx = (d.supports ?? [])
          .map((t) => parseInt(String(t).replace(/[^0-9]/g, ""), 10) - 1)
          .filter((n) => n >= 0 && n < evidence.length);
        if (supportIdx.length === 0) continue; // never create an unsubstantiated marketing claim

        const claim = await sb
          .from("claims")
          .insert({
            scope: "category",
            claim_type: "marketing",
            category_id: cat.id,
            study_id: null,
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
      results.push({ category: cat.id, created });
    } catch (e) {
      results.push({ category: cat.id, error: (e as Error).message });
    }
  }

  return Response.json({ total_marketing_claims_created: totalCreated, results });
}
