// Shared study-fetching logic (used by the Scientific Studies tab AND the /api/studies route that
// feeds the content generator's "pick from studies" picker). Fetches real studies from PubMed
// (Aker BioMarine affiliation), attaches verified whitepaper summaries + AI summaries, and always
// merges in the 4 curated key trials. Server-only (uses Next fetch caching).

import { type Studie } from "./wiki";
import { CURATED_STUDIES, EXCLUDED_TITLE_HINTS, type CuratedStudy, type Summary } from "./studies-data";
import aiSummariesRaw from "./ai-summaries.json";
import fulltextStudiesRaw from "./fulltext-studies.json";

const AI_SUMMARIES = aiSummariesRaw as Record<string, Summary>;
// The papers AKBM supplied as PDFs — the study list is built from these.
const FULLTEXT_STUDIES = fulltextStudiesRaw as Record<string,
  { pdf: string; title: string; year: string; first_author: string; chars: number }>;
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const FELLES = "tool=llm-wiki&email=anish.sharma@sprint.no";

type Esummary = {
  uid: string;
  title: string;
  fulljournalname?: string;
  pubdate?: string;
  authors?: { name: string }[];
  articleids?: { idtype: string; value: string }[];
};

// Categorise a study based on keywords in its title.
export function kategori(tittel: string): string {
  const t = tittel.toLowerCase();
  if (/(heart|cardio|lipid|cholesterol|triglycerid|blood pressure|vascular)/.test(t)) return "Heart & lipids";
  if (/(brain|cognit|memory|neuro|mood|depress|mental)/.test(t)) return "Brain & cognition";
  if (/(inflamm|arthritis|joint|pain|rheumat)/.test(t)) return "Inflammation & joints";
  if (/(metabol|liver|glucose|diabet|obes|weight|gut|microbiom|fatty liver)/.test(t)) return "Metabolism & gut";
  if (/(emulsion|oxidation|extraction|encapsul|stability|phospholipid|chemistry)/.test(t)) return "Chemistry & extraction";
  return "Other";
}

function curatedToStudie(c: CuratedStudy): Studie {
  return {
    pmid: c.pmid, tittel: c.title, tidsskrift: c.journal, dato: c.year, ar: c.year,
    forfattere: c.authors, flereForfattere: false, kategori: kategori(c.title),
    url: `https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`,
    doiUrl: c.doi ? `https://doi.org/${c.doi}` : null,
    summary: c.summary, verified: true, quality: c.quality, akerNote: c.akerNote,
  };
}

export async function hentStudier(): Promise<Studie[]> {
  // 1) The list is AKBM's OWN library: the papers they supplied as PDFs (app/fulltext-studies.json,
  //    written by deck-service/scripts/import_fulltext_pdfs.py) plus the curated key trials.
  //    It used to be a live '"Aker BioMarine"[Affiliation]' PubMed search, which pulled in ~45 papers
  //    AKBM never sent us and missed the third-party ones they did (competitor trials,
  //    meta-analyses). Add a PDF to get a study in the list; there is no other source.
  const alleKurerte = CURATED_STUDIES.map(curatedToStudie);
  const ider: string[] = Array.from(
    new Set([...Object.keys(FULLTEXT_STUDIES), ...CURATED_STUDIES.map((c) => c.pmid)])
  );
  if (ider.length === 0) return alleKurerte;

  // 2) Sammendrag: hent tittel, tidsskrift, dato og forfattere for hver ID.
  const sum = await fetch(
    `${EUTILS}/esummary.fcgi?db=pubmed&${FELLES}&retmode=json&id=${ider.join(",")}`,
    { next: { revalidate: 86400 } }
  );
  if (!sum.ok) return alleKurerte;   // PubMed down -> at least show the verified key trials
  const res = (await sum.json()).result;

  const curatedByPmid = new Map(CURATED_STUDIES.map((c) => [c.pmid, c]));
  const curatedByDoi = new Map(CURATED_STUDIES.filter((c) => c.doi).map((c) => [c.doi.toLowerCase(), c]));

  const hentet: Studie[] = (res.uids as string[])
    .map((id): Studie => {
      const x: Esummary = res[id];
      const doi = x.articleids?.find((i) => i.idtype === "doi")?.value;
      const kurert = curatedByPmid.get(id) ?? (doi ? curatedByDoi.get(doi.toLowerCase()) : undefined);
      const ai = AI_SUMMARIES[id];
      return {
        pmid: id,
        tittel: x.title.replace(/\.$/, ""),
        tidsskrift: x.fulljournalname ?? "",
        dato: x.pubdate ?? "",
        ar: (x.pubdate ?? "").slice(0, 4),
        forfattere: (x.authors ?? []).slice(0, 3).map((a) => a.name).join(", "),
        flereForfattere: (x.authors ?? []).length > 3,
        kategori: kategori(x.title),
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        doiUrl: doi ? `https://doi.org/${doi}` : null,
        summary: kurert ? kurert.summary : ai ?? null,
        verified: kurert ? true : ai ? false : undefined,
        quality: kurert ? kurert.quality : null,
        akerNote: kurert ? kurert.akerNote : null,
        // Do we have the paper itself (AKBM PDF), or only the PubMed abstract?
        harFulltekst: !!FULLTEXT_STUDIES[id],
      };
    })
    // Never show the fictional / not-real study (SUPERBA-OA / Andersen).
    .filter((s) => !EXCLUDED_TITLE_HINTS.some((h) => s.tittel.toLowerCase().includes(h)));

  const tilstede = new Set(hentet.map((s) => s.pmid));
  const mangler = CURATED_STUDIES.filter((c) => !tilstede.has(c.pmid)).map(curatedToStudie);

  // Verified studies first, then by year (newest first).
  return [...mangler, ...hentet].sort((a, b) => {
    if (!!b.verified !== !!a.verified) return b.verified ? 1 : -1;
    return (b.ar || "").localeCompare(a.ar || "");
  });
}
