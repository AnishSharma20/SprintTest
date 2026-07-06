// LLM Wiki — krilloljeforskning (Aker BioMarine sitt felt).
// Henter ekte studier fra PubMed (NCBI E-utilities), kategoriserer dem,
// og sender dem til en interaktiv wiki-komponent med søk.
// Server-komponent: data hentes på serveren og caches/oppdateres daglig.

import Wiki, { type Studie } from "./wiki";
import { CURATED_STUDIES, EXCLUDED_TITLE_HINTS, type CuratedStudy, type Summary } from "./studies-data";
import aiSummariesRaw from "./ai-summaries.json";

const AI_SUMMARIES = aiSummariesRaw as Record<string, Summary>;
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const FELLES = "tool=llm-wiki&email=anish.sharma@sprint.no";

function curatedToStudie(c: CuratedStudy): Studie {
  return {
    pmid: c.pmid, tittel: c.title, tidsskrift: c.journal, dato: c.year, ar: c.year,
    forfattere: c.authors, flereForfattere: false, kategori: kategori(c.title),
    url: `https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`,
    doiUrl: c.doi ? `https://doi.org/${c.doi}` : null,
    summary: c.summary, verified: true, quality: c.quality, akerNote: c.akerNote,
  };
}

type Esummary = {
  uid: string;
  title: string;
  fulljournalname?: string;
  pubdate?: string;
  authors?: { name: string }[];
  articleids?: { idtype: string; value: string }[];
};

// Categorise a study based on keywords in its title.
function kategori(tittel: string): string {
  const t = tittel.toLowerCase();
  if (/(heart|cardio|lipid|cholesterol|triglycerid|blood pressure|vascular)/.test(t))
    return "Heart & lipids";
  if (/(brain|cognit|memory|neuro|mood|depress|mental)/.test(t))
    return "Brain & cognition";
  if (/(inflamm|arthritis|joint|pain|rheumat)/.test(t))
    return "Inflammation & joints";
  if (/(metabol|liver|glucose|diabet|obes|weight|gut|microbiom|fatty liver)/.test(t))
    return "Metabolism & gut";
  if (/(emulsion|oxidation|extraction|encapsul|stability|phospholipid|chemistry)/.test(t))
    return "Chemistry & extraction";
  return "Other";
}

async function hentStudier(): Promise<Studie[]> {
  // 1) Søk: studier der Aker BioMarine står som affiliation (Aker sitt eget felt).
  const sok = await fetch(
    `${EUTILS}/esearch.fcgi?db=pubmed&${FELLES}&retmode=json&retmax=60&sort=date&term=${encodeURIComponent(
      '"Aker BioMarine"[Affiliation]'
    )}`,
    { next: { revalidate: 86400 } }
  );
  if (!sok.ok) return [];
  const ider: string[] = (await sok.json()).esearchresult?.idlist ?? [];
  if (ider.length === 0) return [];

  // 2) Sammendrag: hent tittel, tidsskrift, dato og forfattere for hver ID.
  const sum = await fetch(
    `${EUTILS}/esummary.fcgi?db=pubmed&${FELLES}&retmode=json&id=${ider.join(",")}`,
    { next: { revalidate: 86400 } }
  );
  if (!sum.ok) return [];
  const res = (await sum.json()).result;

  const curatedByPmid = new Map(CURATED_STUDIES.map((c) => [c.pmid, c]));
  const curatedByDoi = new Map(
    CURATED_STUDIES.filter((c) => c.doi).map((c) => [c.doi.toLowerCase(), c])
  );

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
      };
    })
    // Never show the fictional / not-real study (SUPERBA-OA / Andersen).
    .filter((s) => !EXCLUDED_TITLE_HINTS.some((h) => s.tittel.toLowerCase().includes(h)));

  // Always include the 4 verified curated studies, even if they aren't Aker-affiliated on PubMed.
  const tilstede = new Set(hentet.map((s) => s.pmid));
  const mangler = CURATED_STUDIES.filter((c) => !tilstede.has(c.pmid)).map(curatedToStudie);

  // Verified studies first, then by year (newest first).
  return [...mangler, ...hentet].sort((a, b) => {
    if (!!b.verified !== !!a.verified) return b.verified ? 1 : -1;
    return (b.ar || "").localeCompare(a.ar || "");
  });
}

export default async function Home() {
  const studier = await hentStudier();
  return <Wiki studier={studier} />;
}
