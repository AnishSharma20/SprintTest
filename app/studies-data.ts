// The curated key trials from Aker BioMarine's krill-oil / joint-health whitepaper.
//
// These 5 are listed here rather than derived from the PDF library for two reasons: KARAOKE
// (Laslett 2024) is the only one AKBM never supplied as a PDF, and all 5 carry a hand-checked
// scientific quality score and outcome direction that no automated pass could produce.
//
// HISTORY (2026-08-17): each of these also used to carry a 4-section plain-language Summary
// (background / design / findings / limitations) and a free-text `akerNote`, and the page showed
// those instead of the paper's own words. The client replaced both: the reading panel now shows
// the study's real ABSTRACT (app/study-abstracts.json, verbatim from PubMed), and AKBM's role is
// a tag from studies.ts AKBM_ROLES rather than prose. The AI-written summaries in
// `ai-summaries.json` went in the same sweep. If a plain-language layer is ever wanted again,
// it belongs next to the abstract, not instead of it.

export type Quality = { score: number; label: "High" | "Moderate" | "Low" };

// Whether the study's own RESULT favored krill oil — independent of how rigorously it was run.
// Quality/score above is "how much to trust the method"; this is "which way the result pointed".
// The two are deliberately separate fields: a rigorous trial can still land on a null/negative
// result (see KARAOKE below), and a poorly run one can still land on a positive result.
export type OutcomeDirection = "positive" | "neutral" | "negative";

export type CuratedStudy = {
  pmid: string;
  doi: string;
  title: string;
  journal: string;
  year: string;
  authors: string;
  quality: Quality;
  outcomeDirection: OutcomeDirection;
};

export const CURATED_STUDIES: CuratedStudy[] = [
  {
    pmid: "35880828",
    doi: "10.1093/ajcn/nqac125",
    title:
      "Krill oil improved osteoarthritic knee pain in adults with mild to moderate knee osteoarthritis: a 6-month multicenter, randomized, double-blind, placebo-controlled trial",
    journal: "Am J Clin Nutr",
    year: "2022",
    authors: "Stonehouse W, Benassi-Evans B, Bednarz J, et al.",
    // Met all eight pre-specified methodological criteria.
    quality: { score: 100, label: "High" },
    outcomeDirection: "positive",
  },
  {
    pmid: "38776073",
    doi: "10.1001/jama.2024.6063",
    title: "Krill Oil for Knee Osteoarthritis: A Randomized Clinical Trial (KARAOKE)",
    journal: "JAMA",
    year: "2024",
    authors: "Laslett LL, Scheepers LEJM, Antony B, et al.",
    // Rigorous, well powered JAMA RCT — the null primary-endpoint result doesn't make the study
    // itself weak, so research quality stays High; only the outcome direction is negative.
    quality: { score: 100, label: "High" },
    outcomeDirection: "negative",
  },
  {
    pmid: "27701428",
    doi: "10.1371/journal.pone.0162769",
    title: "Krill Oil Improves Mild Knee Joint Pain: A Randomized Control Trial",
    journal: "PLoS ONE",
    year: "2016",
    authors: "Suzuki Y, Fukushima M, Sakuraba K, et al.",
    // Small (n = 50), short (30 days), per-protocol rather than ITT, allocation concealment
    // not clearly described.
    quality: { score: 63, label: "Moderate" },
    outcomeDirection: "positive",
  },
  {
    pmid: "17353582",
    doi: "10.1080/07315724.2007.10719584",
    title:
      "Evaluation of the effect of Neptune Krill Oil on chronic inflammation and arthritic symptoms",
    journal: "J Am Coll Nutr",
    year: "2007",
    authors: "Deutsch L.",
    // Early proof of concept: heterogeneous sample, 30 days, and allocation concealment, ITT
    // analysis, sample-size justification and dropout reporting all unreported.
    quality: { score: 25, label: "Low" },
    outcomeDirection: "positive",
  },
  {
    pmid: "12777162",
    doi: "",
    title:
      "Evaluation of the Effects of Neptune Krill Oil™ on the Management of Premenstrual Syndrome and Dysmenorrhea",
    journal: "Altern Med Rev",
    year: "2003",
    authors: "Sampalis F, Bunea R, Pelland MF, et al.",
    // Reasonably transparent for its era (explicit power calculation, zero dropouts, double
    // blind) but undermined by a missing placebo arm and a severe sponsor/author conflict.
    quality: { score: 50, label: "Moderate" },
    outcomeDirection: "positive",
  },
];

// Fictional / not-real study to EXCLUDE from display (SUPERBA-OA / Andersen 2026 in the whitepaper).
export const EXCLUDED_TITLE_HINTS = ["superba-oa", "andersen"];
