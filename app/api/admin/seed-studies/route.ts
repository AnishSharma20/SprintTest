// POST /api/admin/seed-studies — one-shot, idempotent population of the studies table.
//
// Upserts the 4 curated key trials + every AI-summarised study into `studies` so the
// claims library starts with the known evidence base as first-class rows. Safe to run
// repeatedly (upsert on pmid). Claim extraction also creates study rows lazily, so this
// is a convenience, not a prerequisite.
//
// Gated by a token: send { token } matching SEED_TOKEN (or ADMIN_TOKEN). If neither env
// var is set, seeding is allowed once from localhost only.

import { supabase, dbNotConfigured } from "../../../lib/supabase";
import { CURATED_STUDIES } from "../../../studies-data";
import aiSummariesRaw from "../../../ai-summaries.json";

export const runtime = "nodejs";
export const maxDuration = 60;

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const FELLES = "tool=llm-wiki&email=anish.sharma@sprint.no";

type Row = {
  pmid: string;
  doi: string | null;
  title: string;
  authors: string | null;
  year: number | null;
  journal: string | null;
  verification: "curated" | "ai";
};

// Fetch title / journal / year / authors for a batch of PMIDs from PubMed esummary.
async function fetchSummaries(pmids: string[]): Promise<Map<string, Omit<Row, "verification">>> {
  const out = new Map<string, Omit<Row, "verification">>();
  if (pmids.length === 0) return out;
  const res = await fetch(
    `${EUTILS}/esummary.fcgi?db=pubmed&${FELLES}&retmode=json&id=${pmids.join(",")}`,
    { cache: "no-store" }
  );
  if (!res.ok) return out;
  const result = (await res.json()).result;
  for (const id of (result?.uids as string[]) ?? []) {
    const x = result[id];
    const doi = (x.articleids ?? []).find((i: { idtype: string }) => i.idtype === "doi")?.value ?? null;
    out.set(id, {
      pmid: id,
      doi,
      title: String(x.title ?? "").replace(/\.$/, ""),
      authors: (x.authors ?? []).slice(0, 3).map((a: { name: string }) => a.name).join(", ") || null,
      year: parseInt(String(x.pubdate ?? "").slice(0, 4), 10) || null,
      journal: x.fulljournalname ?? null,
    });
  }
  return out;
}

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  const expected = process.env.SEED_TOKEN || process.env.ADMIN_TOKEN;
  const { token } = await req.json().catch(() => ({ token: undefined }));
  if (expected) {
    if (token !== expected) return Response.json({ error: "Unauthorized." }, { status: 401 });
  } else {
    const host = new URL(req.url).hostname;
    if (host !== "localhost" && host !== "127.0.0.1")
      return Response.json(
        { error: "Set SEED_TOKEN to seed from a deployed environment." },
        { status: 401 }
      );
  }

  const rows = new Map<string, Row>();

  for (const c of CURATED_STUDIES) {
    rows.set(c.pmid, {
      pmid: c.pmid,
      doi: c.doi || null,
      title: c.title,
      authors: c.authors,
      year: parseInt(c.year, 10) || null,
      journal: c.journal,
      verification: "curated",
    });
  }

  // AI-summarised studies: keyed by pmid with only summary fields (no title). Fetch the
  // titles/journals/years from PubMed so the rows are complete. Skip any already curated.
  const aiPmids = Object.keys(aiSummariesRaw as Record<string, unknown>).filter((p) => !rows.has(p));
  const meta = await fetchSummaries(aiPmids);
  for (const [pmid, m] of meta) {
    rows.set(pmid, { ...m, verification: "ai" });
  }

  const list = [...rows.values()];
  const res = await sb.from("studies").upsert(list, { onConflict: "pmid" }).select("pmid");
  if (res.error) return Response.json({ error: res.error.message }, { status: 500 });

  return Response.json({
    seeded: res.data?.length ?? 0,
    curated: CURATED_STUDIES.length,
    ai_requested: aiPmids.length,
    ai_resolved: meta.size,
  });
}
