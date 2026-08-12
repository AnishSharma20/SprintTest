// Shared study-fetching logic (used by the Scientific Studies tab AND the /api/studies route that
// feeds the content generator's "pick from studies" picker). Fetches real studies from PubMed
// (Aker BioMarine affiliation), attaches verified whitepaper summaries + AI summaries, and always
// merges in the 4 curated key trials. Server-only (uses Next fetch caching).

import {
  CURATED_STUDIES,
  EXCLUDED_TITLE_HINTS,
  type CuratedStudy,
  type Quality,
  type OutcomeDirection,
  type Summary,
} from "./studies-data";
import { canonicalIds } from "./lib/category-ids";
import { supabase } from "./lib/supabase";
import aiSummariesRaw from "./ai-summaries.json";
import fulltextStudiesRaw from "./fulltext-studies.json";

export type Studie = {
  pmid: string;
  tittel: string;
  tidsskrift: string;
  dato: string;
  ar: string;
  forfattere: string;
  flereForfattere: boolean;
  kategori: string[]; // a study can belong to more than one of AKBM's benefit categories
  // The same categories as stable ids. Names can be renamed from the UI, so anything that has to
  // survive a rename (filtering, moving a study, matching a study to its findings) uses these.
  kategoriIds?: string[];
  url: string;
  doiUrl: string | null;
  summary?: Summary | null;
  verified?: boolean; // true = science-verified (whitepaper); false = AI-generated
  quality?: Quality | null;
  // Who set the quality score and when, for a score a reviewer entered (curated scores have none).
  qualityReviewer?: string | null;
  qualityReviewedAt?: string | null;
  qualityNote?: string | null;
  // Which way the study's OWN result pointed — independent of quality above (a rigorous trial
  // can still land on a null/negative result, and vice versa). Curated studies carry one built
  // in; everything else is unset until a reviewer records one.
  outcomeDirection?: OutcomeDirection | null;
  akerNote?: string | null;
  // true = AKBM supplied the paper as a PDF, so summaries/findings come from the FULL TEXT.
  // false = we only have the PubMed abstract for it.
  harFulltekst?: boolean;
  // Science team's own write up (migration 0010's study_assessment table) — distinct from the
  // Background/Design/Findings/Limitations summary above, which is AI written or curated.
  abstract?: string | null;
  keyFindingsAssessment?: string | null;
  // Set once a reviewer removes the study from this page (migration 0010's study_removed table).
  // The base list from PubMed/curated data never marks anything removed itself — this is always
  // laid over the list client side by app/study-meta.ts, same as quality/categories.
  removed?: boolean;
  removedReason?: string | null;
  removedBy?: string | null;
  removedAt?: string | null;
  // A study added through "Add study" (migration 0011's custom_studies table) carries the PDF it
  // was uploaded with — a short lived signed Storage URL, since that bucket is private. Takes
  // priority over url/doiUrl in app/wiki-v2.tsx's studyPdfHref(), which otherwise has nothing
  // real to link to for a study with no PMID.
  customPdfUrl?: string | null;
};

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

// The 10 benefit categories, EXACTLY matching AKBM's product benefit grid (the PPTX "Wellness/Immune
// Support", "Heart Support"... cards). Do not add another category — anything that doesn't fit one
// of these belongs in the closest one (Wellness & Immune Support is the broadest/most general), not
// a new bucket. Foundational/mechanism topics from AKBM's internal Science Archive (absorption,
// omega-3 index) are folded into Wellness & Immune Support, since that card's own bullet list
// already covers omega-3 index, omega-6/omega-3 balance and cell membrane fluidity.
export const CATEGORIES = [
  "Wellness & Immune Support",
  "Heart Support",
  "Liver Support",
  "Joint Support",
  "Brain & Dry Eye Support",
  "Sports Performance Support",
  "Skin Support",
  "PMS Support",
  "Healthy Aging Support",
  "Weight Loss Support",
] as const;

// Hard-coded from AKBM's Science Archive PPTX, NOT inferred from title keywords — the archive is
// ground truth for which benefit area(s) a given trial actually supports, verified PMID-by-PMID
// against the archive's reference list. A study legitimately belongs to MULTIPLE categories (e.g.
// Drobnic 2021 is Wellness/Immune + Sports) — this mirrors how AKBM's own science team tags it, so
// filtering is any-match, not exclusive. Studies whose only archive placement was "Bioavailability &
// Absorption" or "Omega-3 Index & Balance" (both retired, not one of the 10 real benefit cards) fold
// into Wellness & Immune Support instead of being dropped from every filter.
//
// Two PMIDs are NOT in the archive at all (21862301 is a fish-oil-form comparison study the archive
// never covers; 31937352 is the KARAOKE trial PROTOCOL paper, and the archive only lists completed
// trials) — both are assigned by direct content judgment instead, noted below.
const ARCHIVE_CATEGORIES: Record<string, string[]> = {
  "15656713": ["Heart Support"], // Bunea 2004
  "21042875": ["Wellness & Immune Support"], // Ulven 2010 (was: absorption only)
  "21276269": ["Heart Support"], // Banni 2011
  "21862301": ["Heart Support"], // not in the archive; triglyceride/statin/dyslipidemia trial
  "24098072": ["Brain & Dry Eye Support"], // Konagai 2013
  "24304605": ["Wellness & Immune Support"], // Ramprasath 2013 (was: omega-3 index only)
  "24461313": ["Heart Support"], // Berge K 2013 (omega-3 index tag dropped; heart retained)
  "25884846": ["Wellness & Immune Support"], // Kohler 2015 (was: absorption only)
  "26328782": ["Wellness & Immune Support"], // Yurko-Mauro 2015 (was: absorption only)
  "26407095": ["Wellness & Immune Support", "Sports Performance Support"], // Da Boit 2015
  "26504524": ["Heart Support"], // Lobraico 2015
  "26537218": ["Wellness & Immune Support"], // Ramprasath 2015 (was: omega-3 index only)
  "26557185": ["Sports Performance Support"], // Skarpanska 2015
  "26666303": ["Heart Support"], // Berge R 2015
  "27279841": ["Wellness & Immune Support", "Heart Support"], // Cicero 2016
  "27701428": ["Joint Support"], // Suzuki 2016
  "27817918": ["Wellness & Immune Support", "Brain & Dry Eye Support"], // Deinema 2016
  "28371906": ["Heart Support"], // Ursoniu 2017 meta-analysis
  "29222893": ["Wellness & Immune Support"], // Sung 2018 (was: absorption only)
  "29372051": ["Heart Support"], // Rundblad 2018
  "29854443": ["Sports Performance Support"], // Georges 2018
  "31652561": ["Liver Support"], // Modinger 2019 (absorption tag dropped; liver retained)
  "31937352": ["Joint Support"], // KARAOKE protocol (Laslett 2020); not in the archive
  "33015116": ["Sports Performance Support"], // Storsve 2020 (absorption tag dropped; sports retained)
  "34444996": ["Liver Support"], // Gart 2021
  "34959789": ["Wellness & Immune Support", "Sports Performance Support"], // Drobnic 2021 (absorption/omega-3 index tags dropped)
  "34989797": ["Heart Support"], // Mozaffarian 2022
  "35504165": ["Healthy Aging Support"], // Alkhedhairi 2022 (omega-3 index tag dropped)
  "35880828": ["Joint Support", "Healthy Aging Support"], // Stonehouse 2022 (omega-3 index tag dropped)
  "38039646": ["Heart Support"], // Huang 2023 meta-analysis
  "39169540": ["Skin Support"], // Handeland 2024
  "39555189": ["Sports Performance Support"], // Katare 2024
  "39974718": ["Wellness & Immune Support"], // Pham 2024 (was: absorption only)
  "40671417": ["Weight Loss Support"], // Alblaji 2025
  "41933837": ["Healthy Aging Support"], // Tamargo 2026
  "42144109": ["Wellness & Immune Support"], // Loukil 2026 (was: absorption only)
  "17353582": ["Wellness & Immune Support", "Joint Support"], // Deutsch 2007
  "38776073": ["Joint Support"], // KARAOKE 2024 results (Laslett); not in the archive
  "12777162": ["PMS Support"], // Sampalis 2003, the archive's only PMS study
  // Added 2026-08-06 from a later AKBM PDF batch, after the archive was last reviewed - best-effort
  // categorisation by content, NOT verified against AKBM's Science Archive like the rest of this table.
  "30261756": ["Liver Support"], // Bjorndal 2018, choline/homocysteine kinetics (same topic as Modinger 2019)
  "19854375": ["Wellness & Immune Support"], // Maki 2009, EPA/DHA bioavailability (Aker BioMarine co-authored)
  "36566465": ["Sports Performance Support"], // Yang 2022/2023, muscle injury recovery after resistance exercise
  // 36367773 (SenGupta/Nilsen 2022, C. elegans + human cell dopaminergic neuron aging study) was
  // REMOVED 2026-08-12: preclinical, not a human trial, unlike every other study here. Removed from
  // fulltext-studies.json, ai-summaries.json, study-figures.json and study-pdfs.json too.
};

// Fallback for a study not yet added to ARCHIVE_CATEGORIES (e.g. a brand new PDF AKBM sends before
// anyone updates the table above). Best-effort keyword match against the SAME 10 categories — never
// invents an 11th. Prefer adding the study to ARCHIVE_CATEGORIES over relying on this.
function fallbackCategories(tittel: string): string[] {
  const t = tittel.toLowerCase();
  const hits: string[] = [];
  if (/(heart|cardio|lipid|cholesterol|triglycerid|blood pressure|vascular|hypertriglyceridemia)/.test(t)) hits.push("Heart Support");
  if (/(liver|hepatic|nafld|fatty liver)/.test(t)) hits.push("Liver Support");
  if (/(joint|arthritis|osteoarthritis|knee|rheumat)/.test(t)) hits.push("Joint Support");
  if (/(cognit|memory|neuro|mood|depress|brain)/.test(t)) hits.push("Brain & Dry Eye Support");
  if (/(eye|vision|ocular|dry eye)/.test(t)) hits.push("Brain & Dry Eye Support");
  if (/(muscle|strength|athlet|sport|recovery|endurance|exercise|resistance training)/.test(t)) hits.push("Sports Performance Support");
  if (/(weight loss|obesity|fasting)/.test(t)) hits.push("Weight Loss Support");
  if (/(skin|derma|elasticity|hydration|transepidermal)/.test(t)) hits.push("Skin Support");
  if (/(pms|menstrual|premenstrual|dysmenorrhea)/.test(t)) hits.push("PMS Support");
  if (/(immune|immunity|inflamm|omega-3 index|omega-6|bioavailab|absorption|phospholipid|choline uptake)/.test(t)) hits.push("Wellness & Immune Support");
  if (/(aging|ageing|older adults|elderly|senescence)/.test(t)) hits.push("Healthy Aging Support");
  return [...new Set(hits)];
}

// Categorise a study by PMID against AKBM's Science Archive, falling back to keyword matching only
// for a study the archive table hasn't been updated with yet.
export function kategorier(pmid: string, tittel: string): string[] {
  const archived = ARCHIVE_CATEGORIES[pmid];
  if (archived?.length) return archived;
  return fallbackCategories(tittel);
}

// The exact set of PMIDs the Scientific Studies page can ever show (AKBM-supplied full-text PDFs +
// the curated key trials — see hentStudier() below; there is no other source). Findings/claims must
// only ever be grounded in one of these, so this is exported for the claims API to validate against
// (app/api/claims/route.ts) rather than letting a paper-level claim attach to an arbitrary study.
export function canonicalStudyPmids(): Set<string> {
  return new Set([...Object.keys(FULLTEXT_STUDIES), ...CURATED_STUDIES.map((c) => c.pmid)]);
}

function curatedToStudie(c: CuratedStudy): Studie {
  const kat = kategorier(c.pmid, c.title);
  return {
    pmid: c.pmid, tittel: c.title, tidsskrift: c.journal, dato: c.year, ar: c.year,
    forfattere: c.authors, flereForfattere: false, kategori: kat, kategoriIds: canonicalIds(kat),
    url: `https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`,
    doiUrl: c.doi ? `https://doi.org/${c.doi}` : null,
    summary: c.summary, verified: true, quality: c.quality, outcomeDirection: c.outcomeDirection,
    akerNote: c.akerNote,
  };
}

/** Studies a reviewer added directly through "Add study" (migration 0011's custom_studies table)
 * — a PDF the site otherwise has no way to carry: no PMID, or AKBM never supplied it as part of
 * the curated/full text library (see STATUS.md's Ding 2024 note). Unlike the rest of this file,
 * these rows carry every field directly (no PubMed lookup, no override layer to merge). */
async function egendefinerteStudier(): Promise<Studie[]> {
  const sb = supabase();
  if (!sb) return [];
  const [rows, cats] = await Promise.all([
    sb.from("custom_studies").select("*"),
    sb.from("categories").select("id, name"),
  ]);
  if (rows.error || !rows.data) return [];
  const navn = new Map((cats.data ?? []).map((c) => [c.id, c.name as string]));
  // The bucket is private (no built in study's PDF is public either), so link to it with a
  // short lived signed URL generated fresh on every request rather than a public path.
  const signed = await Promise.all(
    rows.data.map((r) => sb.storage.from("custom-studies").createSignedUrl(r.storage_path, 3600))
  );
  return rows.data.map((r, i): Studie => {
    const ids = (r.category_ids ?? []) as string[];
    const pdfUrl = signed[i]?.data?.signedUrl ?? null;
    return {
      pmid: r.pmid || `custom-${r.id}`,
      tittel: r.title,
      tidsskrift: r.journal ?? "",
      dato: r.year ? String(r.year) : "",
      ar: r.year ? String(r.year) : "",
      forfattere: r.authors ?? "",
      flereForfattere: false,
      kategori: ids.map((id) => navn.get(id) ?? id),
      kategoriIds: ids,
      url: r.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/` : r.doi ? `https://doi.org/${r.doi}` : pdfUrl || "#",
      doiUrl: r.doi ? `https://doi.org/${r.doi}` : null,
      summary: null,
      verified: false,
      quality: r.quality_score != null && r.quality_label ? { score: r.quality_score, label: r.quality_label } : null,
      outcomeDirection: r.outcome_direction ?? null,
      akerNote: null,
      harFulltekst: !!r.full_text,
      abstract: r.abstract ?? null,
      keyFindingsAssessment: r.key_findings_assessment ?? null,
      customPdfUrl: pdfUrl,
    };
  });
}

export async function hentStudier(): Promise<Studie[]> {
  const [basis, egendefinerte] = await Promise.all([basisStudier(), egendefinerteStudier()]);
  // Verified studies first, then by year (newest first).
  return [...basis, ...egendefinerte].sort((a, b) => {
    if (!!b.verified !== !!a.verified) return b.verified ? 1 : -1;
    return (b.ar || "").localeCompare(a.ar || "");
  });
}

async function basisStudier(): Promise<Studie[]> {
  // 1) The list is AKBM's OWN library: the papers they supplied as PDFs (app/fulltext-studies.json,
  //    written by deck-service/scripts/import_fulltext_pdfs.py) plus the curated key trials.
  //    It used to be a live '"Aker BioMarine"[Affiliation]' PubMed search, which pulled in ~45 papers
  //    AKBM never sent us and missed the third-party ones they did (competitor trials,
  //    meta-analyses). A "Add study" upload (custom_studies, merged in by hentStudier() above) is
  //    the only other source.
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
      const kat = kategorier(id, x.title);
      return {
        pmid: id,
        tittel: x.title.replace(/\.$/, ""),
        tidsskrift: x.fulljournalname ?? "",
        dato: x.pubdate ?? "",
        ar: (x.pubdate ?? "").slice(0, 4),
        forfattere: (x.authors ?? []).slice(0, 3).map((a) => a.name).join(", "),
        flereForfattere: (x.authors ?? []).length > 3,
        kategori: kat,
        kategoriIds: canonicalIds(kat),
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

  return [...mangler, ...hentet]; // sorted once, with custom_studies merged in, by hentStudier() above
}
