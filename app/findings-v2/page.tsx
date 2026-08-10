"use client";

// Findings Library V2 — Concept B (evidence tracer): status + benefit filters in the left
// sidebar, the finding statements in the middle, and the selected finding's evidence chain in
// a reading panel on the right. Same three pane shell as Scientific Studies V2 (app/v2/ui.tsx),
// so the two V2 pages are identical to interact with.
//
// Deliberately a separate page from /claims so the team can compare both (the Content
// Generator V2 pattern); /claims and app/marketing-claims.tsx are untouched.

import { useCallback, useEffect, useState } from "react";
import type { Claim, Category } from "../lib/claims-types";
import FindingsV2 from "./findings-v2";

const REVIEWER_KEY = "claimsReviewerName:v1";

export type Link = { parent_claim_id: string; child_claim_id: string; relation: string };
export type LibClaim = Claim & {
  studies?: {
    pmid: string | null;
    title: string;
    authors: string | null;
    year: number | null;
    journal: string | null;
    doi: string | null;
  } | null;
};

export default function FindingsV2Page() {
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState<LibClaim[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [reviewer, setReviewer] = useState("");

  const load = useCallback(async () => {
    try {
      const d = await (await fetch("/api/claims")).json();
      setConfigured(d.configured !== false);
      setClaims((d.claims ?? []).filter((c: Claim) => c.status !== "superseded"));
      setLinks(d.links ?? []);
      setCategories(d.categories ?? []);
    } catch {
      setConfigured(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    setReviewer(window.localStorage.getItem(REVIEWER_KEY) || "");
  }, [load]);

  const onReviewerChange = (v: string) => {
    setReviewer(v);
    try {
      window.localStorage.setItem(REVIEWER_KEY, v);
    } catch {
      /* ignore */
    }
  };

  if (!configured) {
    return (
      <div className="min-h-screen bg-[#FBFBFD] px-4 py-20">
        <p className="mx-auto max-w-xl text-center text-[14px] text-[#6E6E73]">
          The findings library is not set up yet. Add the Supabase environment variables to enable it.
        </p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="min-h-screen bg-[#FBFBFD] px-4 py-20">
        <p className="text-center text-[14px] text-[#AEAEB2]">Loading findings…</p>
      </div>
    );
  }

  return (
    <FindingsV2
      claims={claims}
      links={links}
      categories={categories}
      reviewer={reviewer}
      onReviewerChange={onReviewerChange}
      onChanged={load}
    />
  );
}
