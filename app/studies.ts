// Shared study-fetching logic (used by the Scientific Studies tab AND the /api/studies route that
// feeds the content generator's "pick from studies" picker). Builds the list from AKBM's own
// library (the PDFs they supplied + the curated key trials), attaches each paper's OWN abstract,
// and records what Aker BioMarine's role in each study was. Server-only (uses Next fetch caching).
//
// 2026-08-17: the AI written / curated 4-section summary this file used to attach was replaced
// everywhere by the paper's real abstract (app/study-abstracts.json). `verified` stopped being
// derived (curated = true) and became a stored reviewer tick, so nothing here sets it.

import {
  CURATED_STUDIES,
  EXCLUDED_TITLE_HINTS,
  type CuratedStudy,
  type Quality,
  type OutcomeDirection,
} from "./studies-data";
import { canonicalIds } from "./lib/category-ids";
import { supabase } from "./lib/supabase";
import type { AkbmRole } from "./akbm-role";
import studyAbstractsRaw from "./study-abstracts.json";
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
  // Ticked by a reviewer in the reading panel, stored in study_assessment.verified (custom
  // studies carry their own column). Never derived: every study starts unverified, and editing
  // anything else about a study does not touch it.
  verified?: boolean;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  // What Aker BioMarine's role in this study was — see AKBM_ROLES below for the built in value
  // and AKBM_ROLE_LABELS for what each key reads as on the page.
  akbmRole?: AkbmRole | null;
  quality?: Quality | null;
  // Who set the quality score and when, for a score a reviewer entered (curated scores have none).
  qualityReviewer?: string | null;
  qualityReviewedAt?: string | null;
  qualityNote?: string | null;
  // Which way the study's OWN result pointed — independent of quality above (a rigorous trial
  // can still land on a null/negative result, and vice versa). Curated studies carry one built
  // in; everything else is unset until a reviewer records one.
  outcomeDirection?: OutcomeDirection | null;
  // true = AKBM supplied the paper as a PDF, so findings can be grounded in the FULL TEXT.
  // false = we only have the published abstract for it.
  harFulltekst?: boolean;
  // The paper's OWN abstract — the study library's text of record since 2026-08-17. Base text
  // comes from app/study-abstracts.json (verbatim from PubMed, structured abstracts keep their
  // BACKGROUND:/METHODS:/RESULTS: labels); a reviewer can override it in study_assessment.
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

// Each paper's own abstract, verbatim from PubMed. Rebuilt by
// `python scripts/fetch_abstracts.py` in deck-service/ whenever AKBM supplies new papers.
const ABSTRACTS = studyAbstractsRaw as Record<string, { title: string; abstract: string }>;
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

/* ── What Aker BioMarine's role in each study was ─────────────────────────────────────────────
 *
 * The tag list, labels and help text live in app/akbm-role.ts, because client components need
 * them too and this module is server only (it holds the Supabase service role client).
 *
 * Hand authored from each paper's OWN funding, acknowledgements and conflict of interest
 * statements (read out of assets/fulltext/ and PubMed's CoiStatement, see
 * deck-service/scripts/fetch_abstracts.py --roles). NOT keyword matched, and not inferred from
 * PubMed's affiliation field alone: that field usually carries only the corresponding author, so
 * it misses AKBM co-authors entirely (Maki 2009, Ulven 2011 and Banni 2011 all have Kjetil Berge
 * and Hogne Vik of AKBM in the author list with no AKBM affiliation shown).
 *
 * This is the built in default. A reviewer's change is stored in study_assessment.akbm_role and
 * laid over it by app/study-meta.ts, same as categories and quality.
 */
const AKBM_ROLES: Record<string, AkbmRole> = {
  // AKBM employees among the authors.
  "19854375": "akbm_authors",  // Maki 2009 — Berge K + Vik H (AKBM) in the author list, Superba
  "21042875": "akbm_authors",  // Ulven 2011 — "K. Berge, H. Vik, Aker BioMarine ASA"; partially AKBM funded
  "21276269": "akbm_authors",  // Banni 2011 — "K.B. and H.V. are employed by Aker Biomarine"; AKBM supported in part
  "24461313": "akbm_authors",  // Berge K 2014 — first author at Aker BioMarine ASA
  "31652561": "akbm_authors",  // Modinger 2019 — Hals (AKBM) corresponding; "sponsored by Aker BioMarine Antarctic AS"
  "33015116": "akbm_authors",  // Storsve 2020 — Storsve, Johnsen, Burri all AKBM
  "34444996": "akbm_authors",  // Gart 2021 — Storsve + Hals (AKBM); "provided a part of the funding"
  "34959789": "akbm_authors",  // Drobnic 2021 — "L.B., A.B.S. and Y.D. are employees of Aker BioMarine"
  "39169540": "akbm_authors",  // Handeland 2024 — Handeland + Burri (AKBM); AKBM funded

  // AKBM money, no AKBM author.
  "26407095": "akbm_funded",   // Da Boit 2015 — "supported with funding from Aker Biomarine Antarctic AS"
  "31937352": "akbm_funded",   // Laslett 2020 protocol — NHMRC led, plus "additional funding from industry (Aker Biomarine)" and in kind product

  // AKBM supplied the oil only; the trial was designed, funded and analysed elsewhere.
  "27701428": "product_only",  // Suzuki 2016 — Superba product, trial funded by Sunsho Pharmaceutical
  "35504165": "product_only",  // Alkhedhairi 2022 — "provided by Aker Biomarine... manufacturer had no role"
  "35880828": "product_only",  // Stonehouse 2022 — Superba BOOST inside the Swisse product; trial supported by Swisse Wellness
  "38776073": "product_only",  // KARAOKE 2024 — NHMRC / University of Tasmania funded, no AKBM disclosure
  "40671417": "product_only",  // Alblaji 2025 — "provided free of charge by Aker BioMarine... no role in design, conduct, or analysis"
  "41933837": "product_only",  // Tamargo 2026 — NIH funded; "supplied at no cost by Aker BioMarine... sponsor had no role"
  "42144109": "product_only",  // Loukil 2026 — SuperbaBoost "provided by Aker BioMarine Antarctic AS"

  // No stated AKBM involvement at all.
  "27817918": "independent",   // Deinema 2017 — Rebecca L. Cooper Foundation + University of Melbourne grants
  "29222893": "independent",   // Sung 2018 — no funding, product source or conflict declared

  // The krill oil studied was someone else's product.
  "12777162": "competitor",    // Sampalis 2003 — Neptune Krill Oil; lead author was Neptune's VP of R&D
  "15656713": "competitor",    // Bunea 2004 — Neptune Krill Oil
  "17353582": "competitor",    // Deutsch 2007 — Neptune Krill Oil
  "21862301": "competitor",    // Schuchardt 2011 — krill arm was Neptune NKO; fish oils from Dr. Loges
  "24098072": "competitor",    // Konagai 2013 — funded by Nippon Suisan Kaisha, whose employees are authors
  "24304605": "competitor",    // Ramprasath 2013 — Enzymotec K-REAL; Enzymotec employees are authors
  "25884846": "competitor",    // Kohler 2015 — Olympic Seafood (Rimfrost) author and product
  // The paper never identifies the krill oil, so we genuinely do not know whose it was. These
  // were briefly tagged `competitor` on the strength of the SPONSOR alone (DSM, Prograde,
  // Erbozeta), which overstated what the papers actually say: the oil could in principle have
  // been anyone's, Superba included. Recording the gap is more honest than guessing either way.
  // Revisit if the science team can trace the real supply chain.
  "26328782": "product_unnamed",  // Yurko-Mauro 2015 — DSM authors, but the oil is never named
  "26504524": "product_unnamed",  // Lobraico 2015 — "two pure krill oil capsules", supplied by Prograde Inc
  "27279841": "product_unnamed",  // Cicero 2016 — "kindly provided by Erbozeta S.r.l.", a formulator

  "26537218": "competitor",    // Ramprasath 2015 — Enzymotec authors
  "26557185": "competitor",    // Skarpanska 2015 — Enzymotec oil (the title's "Neptune" was corrected in an erratum)
  "26666303": "competitor",    // Berge RK 2015 — RIMFROST Sublime; Rimfrost AS authors
  "29372051": "competitor",    // Rundblad 2018 — "RIMFROST Sublime, batch 11335; Rimfrost AS"
  "29854443": "competitor",    // Georges 2018 — authors are employees of Avoca Inc, a krill oil manufacturer
  // No full text supplied, but this is the SAME cohort as Berge RK 2015 above (17 healthy
  // volunteers, 18 to 36 years, 28 days), reported a second time, so the oil is RIMFROST.
  "30261756": "competitor",    // Bjorndal 2018 — Rimfrost AS among the affiliations
  "34989797": "competitor",    // Mozaffarian 2022 — Acasti Pharma's CaPre, Acasti funded
  "36566465": "competitor",    // Yang 2023 — co-author from Aland Health Holding, a krill oil supplier
  "39555189": "competitor",    // Katare 2024 — "Krill oil was provided by Rimfrost AS"; EU Horizon 2020 funded

  // Evidence syntheses, not a trial of one product.
  "28371906": "third_party",   // Ursoniu 2017 — systematic review and meta-analysis
  "38039646": "third_party",   // Huang 2023 — systematic review and meta-analysis, Guangdong grants
  "39974718": "third_party",   // Pham 2024 — network meta-analysis
};

/** AKBM's role in a study, or null when nobody has recorded one (a brand new PDF, or a study a
 * reviewer added by hand and left blank). Null renders as "Role not set" rather than a guess —
 * the wrong provenance tag on a scientific claim is worse than a missing one. */
export function akbmRole(pmid: string): AkbmRole | null {
  return AKBM_ROLES[pmid] ?? null;
}

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
    quality: c.quality, outcomeDirection: c.outcomeDirection,
    abstract: ABSTRACTS[c.pmid]?.abstract ?? null,
    akbmRole: akbmRole(c.pmid),
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
      // Both ticked on the "Add study" form. Unlike a built in study these live on the row
      // itself, since a custom study has no PubMed record and no override layer to merge.
      verified: !!r.verified,
      akbmRole: (r.akbm_role ?? null) as AkbmRole | null,
      quality: r.quality_score != null && r.quality_label ? { score: r.quality_score, label: r.quality_label } : null,
      outcomeDirection: r.outcome_direction ?? null,
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
        quality: kurert ? kurert.quality : null,
        outcomeDirection: kurert ? kurert.outcomeDirection : null,
        abstract: ABSTRACTS[id]?.abstract ?? null,
        akbmRole: akbmRole(id),
        // Do we have the paper itself (AKBM PDF), or only the published abstract?
        harFulltekst: !!FULLTEXT_STUDIES[id],
      };
    })
    // Never show the fictional / not-real study (SUPERBA-OA / Andersen).
    .filter((s) => !EXCLUDED_TITLE_HINTS.some((h) => s.tittel.toLowerCase().includes(h)));

  const tilstede = new Set(hentet.map((s) => s.pmid));
  const mangler = CURATED_STUDIES.filter((c) => !tilstede.has(c.pmid)).map(curatedToStudie);

  return [...mangler, ...hentet]; // sorted once, with custom_studies merged in, by hentStudier() above
}
