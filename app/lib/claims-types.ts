// Shared types for the claims library (mirrors supabase/migrations/0001_claims_library.sql).

export type ClaimScope = "paper" | "category";
export type ClaimType = "science" | "marketing";
export type ClaimStatus = "draft" | "pending_review" | "approved" | "rejected" | "superseded";
export type ClaimOrigin = "ai_extracted" | "human";

export type Category = {
  id: string;
  parent: ClaimType;
  name: string;
  sort_order: number;
};

export type ClaimQuote = {
  id: string;
  claim_id: string;
  quote: string;
  location: string | null;
  verified: boolean;
  verified_at: string | null;
};

export type ClaimComment = {
  id: string;
  claim_id: string;
  author: string;
  body: string;
  kind: "comment" | "rejection_reason";
  created_at: string;
};

export type Claim = {
  id: string;
  scope: ClaimScope;
  claim_type: ClaimType;
  category_id: string;
  study_id: string | null;
  text: string;
  status: ClaimStatus;
  origin: ClaimOrigin;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  version: number;
  supersedes: string | null;
  created_at: string;
  // joined in by the API
  claim_quotes?: ClaimQuote[];
  claim_comments?: ClaimComment[];
};

export type StudyRow = {
  id: string;
  pmid: string | null;
  doi: string | null;
  title: string;
  authors: string | null;
  year: number | null;
  journal: string | null;
  verification: "curated" | "ai";
  full_text_source: "pmc_oa" | "upload" | "abstract_only" | null;
};
