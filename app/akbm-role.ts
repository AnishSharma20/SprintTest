// What Aker BioMarine's role in a study was.
//
// Its own module, and deliberately free of imports, because BOTH the server (app/studies.ts, which
// pulls in the Supabase service role client) and client components (the study panel, the "Add
// study" modal) need these labels. Importing them from studies.ts would drag that server module
// into the browser bundle.
//
// Added 2026-08-17, replacing the free text `akerNote` that only 5 of the 42 studies carried. A
// reader has to be able to see, at a glance, whether a result comes from AKBM's own scientists,
// from a trial AKBM paid for, from an independent trial AKBM only handed product to, or from a
// competitor's product entirely.
//
// The keys are also a CHECK constraint in migration 0016 and a validation set in both
// /api/study-assessment and /api/custom-studies/[id]. All four have to agree.

/** Ordered from most to least AKBM involvement. The last three are not "less involvement"
 * versions of the others, they are different in kind: the paper is about someone else's product,
 * about a product nobody named, or is not a trial of one product at all. */
export type AkbmRole =
  | "akbm_authors"     // AKBM employees are authors (in practice they also funded or supplied)
  | "akbm_funded"      // AKBM money, no AKBM author
  | "product_only"     // AKBM supplied the oil; funding and analysis were someone else's
  | "independent"      // no stated AKBM involvement of any kind
  | "competitor"       // the krill oil studied was NOT AKBM's
  | "product_unnamed"  // the paper never says whose krill oil it used
  | "third_party";     // meta-analysis or systematic review, not a trial of a specific product

// Deliberately short: these render as a pill on a scannable card, so they must read at a glance.
// No dash characters, per the house rule on visible copy.
export const AKBM_ROLE_LABELS: Record<AkbmRole, string> = {
  akbm_authors: "Aker BioMarine authors",
  akbm_funded: "Funded by Aker BioMarine",
  product_only: "Aker BioMarine supplied product",
  independent: "No Aker BioMarine involvement",
  competitor: "Competitor product",
  product_unnamed: "Product not stated",
  third_party: "Independent evidence review",
};

export const AKBM_ROLE_HELP: Record<AkbmRole, string> = {
  akbm_authors:
    "One or more authors are Aker BioMarine employees. Read the result knowing the sponsor helped write it.",
  akbm_funded: "Aker BioMarine funded the trial, but no Aker BioMarine employee is an author.",
  product_only:
    "Aker BioMarine supplied the krill oil and placebo. Someone else designed, funded and analysed the trial.",
  independent: "The paper states no Aker BioMarine involvement in funding, product or authorship.",
  competitor:
    "The krill oil studied was another manufacturer's, so the result does not transfer to Superba without care.",
  product_unnamed:
    "The paper never states which krill oil it used, so it cannot be cited as Superba evidence even though it might have been ours.",
  third_party:
    "A meta-analysis or systematic review pooling other people's trials, not a trial of one product.",
};

export const AKBM_ROLE_KEYS = Object.keys(AKBM_ROLE_LABELS) as AkbmRole[];

/** True when `v` is one of the six roles. Used by the two API routes to refuse a bad value before
 * Postgres does, so the caller gets a readable message instead of a constraint error. */
export function isAkbmRole(v: unknown): v is AkbmRole {
  return typeof v === "string" && (AKBM_ROLE_KEYS as string[]).includes(v);
}
