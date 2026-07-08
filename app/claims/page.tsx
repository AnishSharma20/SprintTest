"use client";

// Claims Library — browse the whole approved-claims library across studies. Filter by category
// and status, search, and see each claim's source (study + PubMed link) and its verified quote.

import { useEffect, useMemo, useState } from "react";
import type { Claim, ClaimStatus, Category } from "../lib/claims-types";
import { decodeEntities } from "../lib/text";

type StatusFilter = "all" | "approved" | "pending_review" | "rejected";

type LibClaim = Claim & { studies?: { pmid: string | null; title: string } | null };

const STATUS_STYLE: Record<string, string> = {
  approved: "bg-[#DFF3E4] text-[#1B7A3D]",
  pending_review: "bg-[#FBEED6] text-[#8A5A0B]",
  rejected: "bg-[#F3E0E0] text-[#9A2A2A]",
  superseded: "bg-zinc-100 text-zinc-500",
  draft: "bg-zinc-100 text-zinc-500",
};
const STATUS_LABEL: Record<string, string> = {
  approved: "Approved",
  pending_review: "Pending",
  rejected: "Rejected",
  superseded: "Superseded",
  draft: "Draft",
};

export default function ClaimsLibrary() {
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState<LibClaim[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/claims")
      .then((r) => r.json())
      .then((d) => {
        setConfigured(d.configured !== false);
        setClaims((d.claims ?? []).filter((c: Claim) => c.status !== "superseded"));
        setCategories(d.categories ?? []);
      })
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false));
  }, []);

  const catName = useMemo(() => {
    const m: Record<string, string> = {};
    categories.forEach((c) => (m[c.id] = c.name));
    return m;
  }, [categories]);

  // Claims after status + search, used both for counts and display.
  const matched = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return claims.filter((c) => {
      if (status !== "all" && c.status !== status) return false;
      if (!needle) return true;
      return (
        c.text.toLowerCase().includes(needle) ||
        (c.studies?.title ?? "").toLowerCase().includes(needle)
      );
    });
  }, [claims, status, q]);

  const countByCat = useMemo(() => {
    const m: Record<string, number> = {};
    matched.forEach((c) => (m[c.category_id] = (m[c.category_id] ?? 0) + 1));
    return m;
  }, [matched]);

  // Category chips grouped by parent, in the reference order, only those that have claims.
  const scienceCats = categories.filter((c) => c.parent === "science" && countByCat[c.id]);
  const marketingCats = categories.filter((c) => c.parent === "marketing" && countByCat[c.id]);

  const visible = activeCat ? matched.filter((c) => c.category_id === activeCat) : matched;

  // Group the visible claims by category for display.
  const grouped = useMemo(() => {
    const m = new Map<string, LibClaim[]>();
    visible.forEach((c) => {
      const arr = m.get(c.category_id) ?? [];
      arr.push(c);
      m.set(c.category_id, arr);
    });
    return [...m.entries()].sort((a, b) => {
      const oa = categories.find((c) => c.id === a[0])?.sort_order ?? 999;
      const ob = categories.find((c) => c.id === b[0])?.sort_order ?? 999;
      return oa - ob;
    });
  }, [visible, categories]);

  return (
    <div className="min-h-screen bg-[#F2F7F9]">
      <header className="bg-gradient-to-br from-[#031B34] via-[#052A4E] to-[#06456B] px-4 pb-10 pt-8">
        <div className="mx-auto max-w-5xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7FD4E6]">
            Claims Library
          </div>
          <h1 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight text-white">
            Approved science claims
          </h1>
          <p className="mt-3 max-w-2xl text-[#BFE3EF]">
            Every claim in the library, grouped by category, with the study it comes from and its
            supporting quote. Approve claims in the Scientific Studies tab; approved ones feed the
            content generators.
          </p>
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
          <>
            {/* Search + status */}
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search claims or studies…"
                className="w-full rounded-xl border border-[#D6E6EE] bg-white py-2.5 px-4 text-sm shadow-sm outline-none focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25 sm:max-w-sm"
              />
              <div className="flex flex-wrap gap-2">
                {(["all", "approved", "pending_review", "rejected"] as StatusFilter[]).map((sv) => (
                  <Chip key={sv} active={status === sv} onClick={() => setStatus(sv)}>
                    {sv === "all" ? "All statuses" : STATUS_LABEL[sv]} (
                    {sv === "all" ? matched.length : matched.filter((c) => c.status === sv).length})
                  </Chip>
                ))}
              </div>
            </div>

            {/* Category chips */}
            <div className="mb-6 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Science</span>
                <Chip active={activeCat === null} onClick={() => setActiveCat(null)}>
                  All ({matched.length})
                </Chip>
                {scienceCats.map((c) => (
                  <Chip key={c.id} active={activeCat === c.id} onClick={() => setActiveCat(c.id)}>
                    {c.name} ({countByCat[c.id]})
                  </Chip>
                ))}
              </div>
              {marketingCats.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Marketing</span>
                  {marketingCats.map((c) => (
                    <Chip key={c.id} active={activeCat === c.id} onClick={() => setActiveCat(c.id)}>
                      {c.name} ({countByCat[c.id]})
                    </Chip>
                  ))}
                </div>
              )}
            </div>

            <p className="mb-3 text-sm text-zinc-500">
              Showing {visible.length} claim{visible.length === 1 ? "" : "s"}
              {activeCat ? ` in ${catName[activeCat]}` : ""}.
            </p>

            {visible.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[#C2D9E3] p-8 text-center text-zinc-400">
                No claims match these filters.
              </p>
            ) : (
              <div className="space-y-8">
                {grouped.map(([catId, list]) => (
                  <section key={catId}>
                    <div className="mb-3 flex items-center gap-2 border-b border-[#D6E6EE] pb-2">
                      <h2 className="text-lg font-bold text-[#052A4E]">{catName[catId] ?? catId}</h2>
                      <span className="rounded-full bg-[#E1F4F3] px-2 py-0.5 text-xs font-semibold text-[#0A7A8A]">
                        {list.length}
                      </span>
                    </div>
                    <ul className="space-y-3">
                      {list.map((c) => (
                        <ClaimCard key={c.id} c={c} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ClaimCard({ c }: { c: LibClaim }) {
  const quote = (c.claim_quotes ?? [])[0];
  const pmid = c.studies?.pmid ?? null;
  return (
    <li className="rounded-2xl border border-[#D6E6EE] bg-white p-5 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[c.status]}`}>
          {STATUS_LABEL[c.status] ?? c.status}
        </span>
        <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-[10px] font-semibold text-zinc-500">
          {c.scope === "category" ? "Category claim" : "Paper claim"}
        </span>
        <span className="text-[10px] text-zinc-400">
          {c.origin === "ai_extracted" ? "AI extracted" : "Added manually"}
        </span>
      </div>

      <p className="text-[15px] leading-relaxed text-zinc-800">{decodeEntities(c.text)}</p>

      {quote && (
        <div className="mt-3 border-l-2 border-[#C2D9E3] pl-3">
          <p className="text-[13px] italic leading-relaxed text-zinc-500">“{decodeEntities(quote.quote)}”</p>
          <span className={`text-[10px] font-semibold ${quote.verified ? "text-[#1B7A3D]" : "text-[#9A2A2A]"}`}>
            {quote.verified ? "✓ Quote found in source" : "⚠︎ Quote not found in source"}
          </span>
        </div>
      )}

      {/* Source */}
      <div className="mt-3 border-t border-[#EEF4F7] pt-2.5 text-xs">
        {c.studies?.title ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold text-[#052A4E]">Source:</span>
            <span className="text-zinc-600">{c.studies.title}</span>
            {pmid && (
              <a
                href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-[#0A7A8A] hover:underline"
              >
                PubMed {pmid} →
              </a>
            )}
          </div>
        ) : (
          <span className="text-zinc-400">Aggregated category claim (no single source study).</span>
        )}
      </div>
    </li>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "bg-[#0A7A8A] text-white shadow-sm"
          : "bg-white text-zinc-600 ring-1 ring-[#D6E6EE] hover:bg-[#E1F4F3]"
      }`}
    >
      {children}
    </button>
  );
}
