"use client";

// Claims Library — the marketing claims we can make about the product. A claim is a benefit-facing
// product statement; the science is the EVIDENCE behind it (shown per claim: verbatim quote + study
// + section). The raw science extractions are not listed here as "claims" — they are only the
// backing evidence a claim points to.

import { useCallback, useEffect, useState } from "react";
import type { Claim, Category } from "../lib/claims-types";
import MarketingClaims from "../marketing-claims";

const REVIEWER_KEY = "claimsReviewerName:v1";

type Link = { parent_claim_id: string; child_claim_id: string; relation: string };
type LibClaim = Claim & { studies?: { pmid: string | null; title: string } | null };

export default function ClaimsLibrary() {
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

  return (
    <div className="min-h-screen bg-[#F2F7F9]">
      <header className="bg-gradient-to-br from-[#031B34] via-[#052A4E] to-[#06456B] px-4 pb-10 pt-8">
        <div className="mx-auto max-w-5xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7FD4E6]">
            Claims Library
          </div>
          <h1 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight text-white">
            What we can say about the product
          </h1>
          <p className="mt-3 max-w-2xl text-[#BFE3EF]">
            Marketing claims in plain, benefit facing language. Each claim links to the evidence that
            substantiates it, so you can see the exact quote, the study and the section it comes from.
          </p>
          <div className="mt-5 flex items-center gap-2">
            <label htmlFor="reviewer" className="text-xs font-semibold text-[#7FD4E6]">
              Reviewer
            </label>
            <input
              id="reviewer"
              value={reviewer}
              onChange={(e) => onReviewerChange(e.target.value)}
              placeholder="Your name (recorded on actions)"
              className="w-64 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm text-white placeholder:text-[#8FB8D0] outline-none focus:border-[#3FD0C9]"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {!configured ? (
          <p className="rounded-xl border border-dashed border-[#C2D9E3] p-8 text-center text-zinc-500">
            The claims library is not set up yet. Add the Supabase environment variables to enable it.
          </p>
        ) : loading ? (
          <p className="text-zinc-400">Loading claims…</p>
        ) : (
          <MarketingClaims
            claims={claims}
            links={links}
            categories={categories}
            reviewer={reviewer}
            onChanged={load}
          />
        )}
      </main>
    </div>
  );
}
