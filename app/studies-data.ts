// Curated, science-VERIFIED study summaries (from Aker BioMarine's krill-oil / joint-health
// whitepaper). These are shown verbatim and flagged "Verified by science". The 4 are the key
// clinical trials in the evidence base; they are added directly here because they are not all
// retrievable via the "Aker BioMarine"[Affiliation] PubMed query (Deutsch is a Neptune/competitor
// study; Suzuki was Sunsho-funded; Laslett/KARAOKE used Aker product but had no Aker authors).
//
// AI-generated summaries for the OTHER (Aker-affiliated) studies live in `ai-summaries.json`
// (produced by `scripts/gen-summaries.mjs`) and are flagged "AI summary — unverified".

export type Summary = {
  background: string;
  design: string;
  findings: string;
  limitations: string;
};

export type Quality = { score: number; label: "High" | "Moderate" | "Low" };

export type CuratedStudy = {
  pmid: string;
  doi: string;
  title: string;
  journal: string;
  year: string;
  authors: string;
  akerNote: string; // relationship to Aker BioMarine — shown for transparency
  quality: Quality;
  summary: Summary;
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
    akerNote: "Aker BioMarine (Superba krill oil) — strongest positive evidence to date",
    quality: { score: 100, label: "High" },
    summary: {
      background:
        "At publication, the largest, longest and highest-dose RCT of krill oil in knee osteoarthritis. Designed to overcome earlier methodological limitations and generate high-quality evidence for clinical and regulatory discussions.",
      design:
        "235 adults aged 40–75 with mild-to-moderate knee OA and regular knee pain (VAS 4–8) across four Australian sites; 6-month double-blind, placebo-controlled, parallel-arm. 4 g/day krill oil (~0.60 g EPA, 0.28 g DHA, 0.45 mg astaxanthin) vs mixed-vegetable-oil placebo. Primary outcome: change in WOMAC knee pain. Full intention-to-treat, pre-specified analysis, centralised randomisation.",
      findings:
        "Significant, clinically meaningful improvement in WOMAC knee pain vs placebo at 6 months (mean difference −5.18; 95% CI −10.0 to −0.32; p = 0.030). Knee stiffness (p = 0.001) and physical function (p < 0.05) also improved significantly. Omega-3 Index rose from 6.0% to 8.9%, confirming strong tissue incorporation. NSAID use, serum lipids and systemic inflammatory markers were unchanged, suggesting a localised rather than systemic mechanism. No safety concerns.",
      limitations:
        "Population was normo- to borderline hyperlipidaemic, limiting observable lipid effects. Included participants without effusion-synovitis (broader than KARAOKE). The MCID for WOMAC pain is debated. Quality score 100% (High) — met all eight pre-specified methodological criteria.",
    },
  },
  {
    pmid: "38776073",
    doi: "10.1001/jama.2024.6063",
    title: "Krill Oil for Knee Osteoarthritis: A Randomized Clinical Trial (KARAOKE)",
    journal: "JAMA",
    year: "2024",
    authors: "Laslett LL, Scheepers LEJM, Antony B, et al.",
    akerNote: "Independent (NHMRC / University of Tasmania funded) — Aker BioMarine supplied product only, no role in analysis",
    quality: { score: 100, label: "High" },
    summary: {
      background:
        "The KARAOKE trial — the most ambitious krill-oil study to date, published in JAMA. Funded independently by the Australian NHMRC and the University of Tasmania; Aker BioMarine provided supplements only, with no role in data analysis or interpretation.",
      design:
        "262 adults with clinical knee OA, significant pain and MRI-confirmed effusion-synovitis, randomised 1:1 to 2 g/day krill oil or identical placebo for 24 weeks across five Australian cities. Primary outcome: change in knee pain (VAS 0–100). Secondary: MRI effusion-synovitis volume, WOMAC subscales, Omega-3 Index, lipids, inflammatory markers. Pre-specified intention-to-treat.",
      findings:
        "No significant difference in VAS knee pain between krill oil and placebo over 24 weeks (mean difference 0.30; 95% CI −6.9 to 6.4; p = 0.94). The authors concluded the findings do not support 2 g/day krill oil for knee pain in people with OA who have significant pain and effusion-synovitis.",
      limitations:
        "Used 2 g/day — half the dose that produced significant effects in Stonehouse (4 g/day); dose-response for omega-3 is well established. Enrolled a more advanced structural subphenotype (MRI effusion-synovitis) than Stonehouse's broader population. The null result does not contradict the 4 g/day evidence in broader OA. Quality score 100% (High).",
    },
  },
  {
    pmid: "27701428",
    doi: "10.1371/journal.pone.0162769",
    title: "Krill Oil Improves Mild Knee Joint Pain: A Randomized Control Trial",
    journal: "PLoS ONE",
    year: "2016",
    authors: "Suzuki Y, Fukushima M, Sakuraba K, et al.",
    akerNote: "Superba krill oil (Aker BioMarine product); study funded by Sunsho Pharmaceutical",
    quality: { score: 63, label: "Moderate" },
    summary: {
      background:
        "Building on Deutsch, this trial targeted a more commercially relevant population: adults with mild knee pain not yet requiring pharmacotherapy — the primary consumer segment for krill-oil supplements. Conducted at an orthopaedic clinic in rural Japan.",
      design:
        "50 adults aged 38–85 (mean ~64) with mild knee pain, randomised to 2 g/day Superba krill oil (240 mg EPA, 110 mg DHA) or safflower-oil placebo for 30 days. Primary outcomes: Japanese Knee Osteoarthritis Measure (JKOM) and JOA score. Secondary: plasma fatty acids and biochemical markers.",
      findings:
        "Both groups improved (notable placebo effect). After adjusting for age, sex, weight and lifestyle, krill oil gave significantly greater improvement than placebo in knee pain during sleep (p < 0.001) and while standing (p < 0.001), and in range of motion (p = 0.011). Plasma EPA and the EPA/arachidonic-acid ratio rose significantly, confirming uptake and a favourable n-6/n-3 shift.",
      limitations:
        "Small (n = 50), short (30 days), per-protocol (not ITT) analysis. Allocation concealment not clearly described. Industry-funded (Sunsho Pharmaceutical, with stated separation). Single ethnically homogeneous population, uncontrolled diet — limits generalisability. Quality score 63% (Moderate).",
    },
  },
  {
    pmid: "17353582",
    doi: "10.1080/07315724.2007.10719584",
    title:
      "Evaluation of the effect of Neptune Krill Oil on chronic inflammation and arthritic symptoms",
    journal: "J Am Coll Nutr",
    year: "2007",
    authors: "Deutsch L.",
    akerNote: "Neptune Krill Oil (NKO™) — a competitor product, NOT Aker BioMarine; included as the first clinical evidence",
    quality: { score: 25, label: "Low" },
    summary: {
      background:
        "The first RCT to examine krill oil specifically in humans with arthritic and inflammatory conditions. Motivated by pre-clinical evidence that omega-3s could lower C-reactive protein (CRP) and attenuate arthritic symptoms (WOMAC).",
      design:
        "90 patients with cardiovascular disease and/or rheumatoid arthritis and/or osteoarthritis, all with elevated baseline CRP (>1.0 mg/dL), randomised double-blind to Neptune Krill Oil (NKO™) 300 mg/day or placebo for 30 days. CRP and WOMAC (pain, stiffness, function) at baseline and days 7, 14, 30.",
      findings:
        "After 7 days, krill oil reduced CRP vs an increase on placebo (p = 0.049). By day 14, CRP fell 29.7% (krill) vs +32.1% (placebo) (p < 0.001), maintained at day 30. All three WOMAC subscales improved significantly in favour of krill oil at every visit.",
      limitations:
        "Early proof-of-concept only. Heterogeneous sample (CVD + RA + OA mixed), short (30 days); allocation concealment, ITT analysis, sample-size justification and dropout reporting were not reported. Quality score 25% (Low), reflecting limited methodological transparency of early-era trials.",
    },
  },
];

// Fictional / not-real study to EXCLUDE from display (SUPERBA-OA / Andersen 2026 in the whitepaper).
export const EXCLUDED_TITLE_HINTS = ["superba-oa", "andersen"];
