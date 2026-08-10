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

/** First author's surname, guessed from a PubMed-style "Last FM, Last2 FM2, ..." string.
 *
 * PubMed's own format is "Surname Initials" — initials are a short, ALL CAPS token (e.g. "AF",
 * "ISM", "L"). Everything before that first all caps token is the surname, so a multi word
 * surname survives whole ("van der Wurff ISM" -> "van der Wurff", not just "van"). */
export function guessAuthorSurname(authors: string | null | undefined): string {
  const first = (authors ?? "").split(",")[0]?.trim() ?? "";
  const tokens = first.split(/\s+/).filter(Boolean);
  const surname: string[] = [];
  for (const t of tokens) {
    if (/^[A-Z]{1,4}$/.test(t)) break;
    surname.push(t);
  }
  return surname.join(" ") || tokens[0] || "";
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

/** The "Author(s) Year: " prefix a stored finding always carries, so a list card can show just
 * the result sentence — the citation stays in the data (that's the required format) but moves
 * into an on-demand "Trace source" action rather than heading every card (2026-08-10 feedback:
 * "we don't need the study this clear"). Falls back to the untouched text if it doesn't match —
 * an aggregated (category-scope) finding was never given this prefix in the first place. */
export function stripCitationPrefix(text: string): string {
  return text.replace(/^[A-Za-zÀ-ÿ' .]+ \d{4}:\s*/, "");
}

/** Splits a finding's trailing "(design, terms, here)" parenthetical off the headline sentence, so
 * the design detail can be shown as its own bullet list next to the source instead of cluttering
 * the sentence (2026-08-10 feedback: the "(...)" reads noisy inline). Only the LAST parenthetical
 * at the very end of the string counts as the design suffix — an inline aside earlier in the
 * sentence (e.g. "Osbond acid (ObA)") is left untouched in the body. Falls back to no suffix if the
 * text doesn't end in one (e.g. an aggregated category-scope finding, which has no design). */
export function splitDesignSuffix(text: string): { body: string; design: string[] } {
  const m = text.match(/^(.*)\s\(([^()]+)\)\s*$/);
  if (!m) return { body: text, design: [] };
  return { body: m[1], design: m[2].split(",").map((s) => s.trim()).filter(Boolean) };
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
