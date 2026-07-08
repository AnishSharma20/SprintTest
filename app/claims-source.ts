// Phase 2 — feed the science team's APPROVED claims into the generators as an authoritative
// source block, and track which claims a generated asset drew on.
//
// The block numbers each claim [C1], [C2], ... (no dash characters, so the generators' no-dash
// strip leaves the tags intact) and the generator prompts cite those tags. asset_claims records
// the FULL set of claims fed into a generation — a retraction-safe superset ("which assets drew on
// this claim"), which also works for the deck (a binary we can't parse citations out of).

export type ApprovedClaim = {
  id: string;
  scope: "paper" | "category";
  category_id: string;
  categoryName: string;
  text: string;
  quote: string | null;
  studyTitle: string | null;
  pmid: string | null;
};

export type ClaimsLoad = { configured: boolean; claims: ApprovedClaim[] };

type RawClaim = {
  id: string;
  scope: "paper" | "category";
  category_id: string;
  status: string;
  text: string;
  claim_quotes?: { quote: string; verified: boolean }[];
  studies?: { pmid: string | null; title: string } | null;
};

/** Load the approved claims (and their category names) for the generator's source picker. */
export async function loadApprovedClaims(): Promise<ClaimsLoad> {
  try {
    const res = await fetch("/api/claims");
    const data = await res.json();
    if (data.configured === false) return { configured: false, claims: [] };
    const catName: Record<string, string> = {};
    for (const c of data.categories ?? []) catName[c.id] = c.name;
    const claims: ApprovedClaim[] = (data.claims ?? [])
      .filter((c: RawClaim) => c.status === "approved")
      .map((c: RawClaim) => {
        const quotes = c.claim_quotes ?? [];
        const vq = quotes.find((q) => q.verified) ?? quotes[0];
        return {
          id: c.id,
          scope: c.scope,
          category_id: c.category_id,
          categoryName: catName[c.category_id] ?? c.category_id,
          text: c.text,
          quote: vq?.quote ?? null,
          studyTitle: c.studies?.title ?? null,
          pmid: c.studies?.pmid ?? null,
        };
      });
    return { configured: true, claims };
  } catch {
    return { configured: false, claims: [] };
  }
}

/** Turn selected approved claims into a source File + the ordered list of claim ids they carry. */
export function buildClaimsSourceFile(
  claims: ApprovedClaim[]
): { file: File; claimIds: string[] } | null {
  if (!claims.length) return null;
  const lines: string[] = [
    "=== APPROVED SCIENCE CLAIMS ===",
    "Reviewed and approved by the Aker BioMarine science team. These are authoritative: prefer them " +
      "for every scientific statement, and cite the ones you use by their tag (for example [C2]).",
    "",
  ];
  claims.forEach((c, i) => {
    lines.push(`[C${i + 1}] (${c.categoryName}) ${c.text}`);
    if (c.studyTitle) {
      lines.push(`   Source: ${c.studyTitle}${c.pmid ? ` (PMID ${c.pmid})` : ""}`);
    }
    if (c.quote) lines.push(`   Evidence: "${c.quote}"`);
    lines.push("");
  });
  const file = new File([lines.join("\n")], "Approved-science-claims.txt", { type: "text/plain" });
  return { file, claimIds: claims.map((c) => c.id) };
}

/** Record which approved claims a generated asset drew on (best-effort; no-op if unconfigured). */
export async function recordAssetClaims(
  assetType: "deck" | "blog" | "whitepaper",
  claimIds: string[],
  opts: { title?: string; createdBy?: string } = {}
): Promise<void> {
  if (!claimIds.length) return;
  try {
    await fetch("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        asset_type: assetType,
        title: opts.title ?? null,
        created_by: opts.createdBy ?? null,
        claim_ids: claimIds,
      }),
    });
  } catch {
    /* recording is best-effort — never block or fail a generation over it */
  }
}
