// Shared helpers for the "endpoint result" finding format required by regulatory feedback
// (2026-08-10, Anca): a finding restates what a study's own primary/secondary endpoint showed,
// never a consumer benefit statement.
//
//   FORBIDDEN pattern: "Your body handles X with ease", "reduces inflammation", ...
//   REQUIRED pattern:  "[Author] [Year]: [short result on the endpoint] ([study design])"
//   Example:           "Stonehouse 2022: Krill oil improved osteoarthritic knee pain in adults
//                        with mild to moderate knee osteoarthritis (6-month RCT, multicenter,
//                        double-blind, placebo-controlled)"
//
// Nothing here is enforced server side — the schema already supports it (a paper-scope claim of
// any claim_type just needs a study_id) — this module only composes the string and offers a
// best-guess starting point the reviewer can edit before saving.

/** First author's surname, guessed from a PubMed-style "Last FM, Last2 FM2, ..." string. */
export function guessAuthorSurname(authors: string | null | undefined): string {
  const first = (authors ?? "").split(",")[0]?.trim() ?? "";
  return first.split(/\s+/)[0] ?? "";
}

/** "[Author] [Year]" prefix, blank pieces omitted gracefully so a half-known study still helps. */
export function authorYearPrefix(
  authors: string | null | undefined,
  year: number | string | null | undefined
): string {
  return [guessAuthorSurname(authors), year ? String(year) : ""].filter(Boolean).join(" ");
}

/** The full composed finding text: "Author Year: result (design)". */
export function composeFindingText(parts: { authorYear: string; result: string; design: string }): string {
  const head = parts.authorYear.trim();
  const result = parts.result.trim();
  const design = parts.design.trim();
  const body = head && result ? `${head}: ${result}` : result || head;
  return design ? `${body} (${design})` : body;
}

/** Closest available signal for "human clinical study" vs "meta-analysis": the study's own title.
 * There is no structured study-design field in the schema (see deck-service-architecture memory) —
 * this is a transparent, inspectable heuristic, not a claim of certainty. */
export function isMetaAnalysisTitle(title: string | null | undefined): boolean {
  return /meta-?analysis|systematic review/i.test(title ?? "");
}

/** "Backed by N human clinical studies (+ M meta-analyses)" for an aggregated (category-scope)
 * finding's set of distinct backing studies. */
export function evidenceBasisLine(
  studies: { pmid: string | null; title: string }[]
): string {
  const distinct = new Map<string, string>();
  studies.forEach((s) => {
    if (s.pmid) distinct.set(s.pmid, s.title);
  });
  const titles = [...distinct.values()];
  const meta = titles.filter(isMetaAnalysisTitle).length;
  const clinical = titles.length - meta;
  const clinicalPart = `${clinical} human clinical stud${clinical === 1 ? "y" : "ies"}`;
  return meta > 0 ? `Backed by ${clinicalPart} (+ ${meta} meta-analys${meta === 1 ? "is" : "es"})` : `Backed by ${clinicalPart}`;
}

/** Standing regulatory note shown wherever findings/claims are displayed. */
export const REGULATORY_DISCLAIMER =
  "Should not be interpreted as health claims. All prospective health claims must be checked for regulatory compliance.";
