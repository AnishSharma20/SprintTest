// LLM Wiki — krilloljeforskning (Aker BioMarine sitt felt).
// Henter ekte studier fra PubMed (NCBI E-utilities), kategoriserer dem,
// og sender dem til en interaktiv wiki-komponent med søk.
// Server-komponent: data hentes på serveren og caches/oppdateres daglig.

import Wiki, { type Studie } from "./wiki";

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

// Kategoriser en studie ut fra nøkkelord i tittelen.
function kategori(tittel: string): string {
  const t = tittel.toLowerCase();
  if (/(heart|cardio|lipid|cholesterol|triglycerid|blood pressure|vascular)/.test(t))
    return "Hjerte & blodfett";
  if (/(brain|cognit|memory|neuro|mood|depress|mental)/.test(t))
    return "Hjerne & kognisjon";
  if (/(inflamm|arthritis|joint|pain|rheumat)/.test(t))
    return "Betennelse & ledd";
  if (/(metabol|liver|glucose|diabet|obes|weight|gut|microbiom|fatty liver)/.test(t))
    return "Metabolisme & tarm";
  if (/(emulsion|oxidation|extraction|encapsul|stability|phospholipid|chemistry)/.test(t))
    return "Kjemi & utvinning";
  return "Annet";
}

async function hentStudier(): Promise<Studie[]> {
  // 1) Søk: finn ID-ene til de nyeste krilloljestudiene.
  const sok = await fetch(
    `${EUTILS}/esearch.fcgi?db=pubmed&${FELLES}&retmode=json&retmax=40&sort=date&term=${encodeURIComponent(
      '"krill oil"[tiab]'
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

  return (res.uids as string[]).map((id) => {
    const x: Esummary = res[id];
    const doi = x.articleids?.find((i) => i.idtype === "doi")?.value;
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
    };
  });
}

export default async function Home() {
  const studier = await hentStudier();
  return <Wiki studier={studier} />;
}
