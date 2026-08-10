"use client";

// Marketing-claims layer for the Claims Library. A marketing claim is "what we can say about the
// product" (plain, benefit-facing) — NOT a verbatim study sentence. Each is backed_by one or more
// science claims (the evidence), so the statement is always traceable to its substantiation.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Claim, Category, ClaimStatus } from "./lib/claims-types";
import { decodeEntities } from "./lib/text";
import {
  authorYearPrefix,
  composeFindingText,
  evidenceBasisLine,
  REGULATORY_DISCLAIMER,
} from "./lib/finding-format";
import CategoryManager from "./category-manager";

type Link = { parent_claim_id: string; child_claim_id: string; relation: string };
type LibClaim = Claim & {
  studies?: {
    pmid: string | null;
    title: string;
    authors: string | null;
    year: number | null;
    journal: string | null;
    doi: string | null;
  } | null;
};

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

export default function MarketingClaims({
  claims,
  links,
  categories,
  reviewer,
  onChanged,
}: {
  claims: LibClaim[];
  links: Link[];
  categories: Category[];
  reviewer: string;
  onChanged: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [administrerer, setAdministrerer] = useState(false);
  const [q, setQ] = useState("");
  const [valgtKategori, setValgtKategori] = useState<string | null>(null);

  const byId = useMemo(() => {
    const m: Record<string, LibClaim> = {};
    claims.forEach((c) => (m[c.id] = c));
    return m;
  }, [claims]);
  const catName = useMemo(() => {
    const m: Record<string, string> = {};
    categories.forEach((c) => (m[c.id] = c.name));
    return m;
  }, [categories]);

  const marketing = useMemo(
    () => claims.filter((c) => c.claim_type === "marketing" && c.status !== "superseded"),
    [claims]
  );

  // Category filter chips, same pattern as the Research Wiki: biggest category first, All last.
  // Keyed by category ID, not name, so renaming a category never strands the selection.
  const kategorier = useMemo(() => {
    const m = new Map<string, { navn: string; antall: number }>();
    marketing.forEach((c) => {
      const e = m.get(c.category_id) ?? { navn: catName[c.category_id] ?? c.category_id, antall: 0 };
      e.antall += 1;
      m.set(c.category_id, e);
    });
    return [...m.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.antall - a.antall || a.navn.localeCompare(b.navn));
  }, [marketing, catName]);

  const filteredMarketing = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return marketing.filter((c) => {
      const treffSok = !needle || c.text.toLowerCase().includes(needle);
      const treffKat = !valgtKategori || c.category_id === valgtKategori;
      return treffSok && treffKat;
    });
  }, [marketing, q, valgtKategori]);
  const scienceClaims = useMemo(
    () => claims.filter((c) => c.claim_type === "science" && c.status !== "superseded"),
    [claims]
  );

  // parent claim id -> backing science claims
  const backingOf = useMemo(() => {
    const m: Record<string, LibClaim[]> = {};
    links
      .filter((l) => l.relation === "backed_by")
      .forEach((l) => {
        const child = byId[l.child_claim_id];
        if (!child) return;
        (m[l.parent_claim_id] ??= []).push(child);
      });
    return m;
  }, [links, byId]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-sm text-zinc-500">
            What marketing can say about the product. Each finding is written in plain, benefit facing
            language and linked to the science that substantiates it, so it stays defensible.
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{REGULATORY_DISCLAIMER}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => setAdministrerer(true)}
            className="rounded-[4px] border border-[#B7D9DE] bg-white px-4 py-2 text-sm font-semibold text-[#0A7A8A] hover:bg-[#E1F4F3]"
          >
            ⚙ Manage categories
          </button>
          <button
            onClick={() => setCreating(true)}
            className="rounded-[4px] bg-[#0A7A8A] px-4 py-2 text-sm font-bold text-white hover:bg-[#086472]"
          >
            ＋ New finding
          </button>
        </div>
      </div>

      {marketing.length > 0 && (
        <>
          <div className="relative mb-4">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400">🔍</span>
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search findings…"
              className="w-full rounded-[4px] border border-[#D6E6EE] bg-white py-3 pl-11 pr-4 text-sm shadow-sm outline-none focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
            />
          </div>

          {/* Biggest category first, down to the smallest, with All last. */}
          <div className="mb-4 flex flex-wrap gap-2">
            {kategorier.map((k) => (
              <FilterKnapp
                key={k.id}
                aktiv={valgtKategori === k.id}
                onClick={() => setValgtKategori(k.id)}
              >
                {k.navn} ({k.antall})
              </FilterKnapp>
            ))}
            <FilterKnapp aktiv={valgtKategori === null} onClick={() => setValgtKategori(null)}>
              All ({marketing.length})
            </FilterKnapp>
          </div>

          <p className="mb-3 text-sm text-zinc-500">
            Showing {filteredMarketing.length} of {marketing.length} findings
          </p>
        </>
      )}

      {marketing.length === 0 ? (
        <div className="rounded-[4px] border border-dashed border-[#C2D9E3] p-8 text-center">
          <p className="text-zinc-500">No findings yet.</p>
          <p className="mt-1 text-sm text-zinc-400">
            Create one and link it to the study evidence that backs it up.
          </p>
        </div>
      ) : filteredMarketing.length === 0 ? (
        <p className="rounded-[4px] border border-dashed border-[#C2D9E3] p-8 text-center text-zinc-400">
          No findings match your search.
        </p>
      ) : (
        <ul className="space-y-3">
          {filteredMarketing.map((m) => (
            <MarketingCard
              key={m.id}
              claim={m}
              backing={backingOf[m.id] ?? []}
              categoryName={catName[m.category_id] ?? m.category_id}
              reviewer={reviewer}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}

      {administrerer && (
        <CategoryManager
          reviewer={reviewer}
          onClose={() => setAdministrerer(false)}
          onChanged={onChanged}
        />
      )}

      {creating && (
        <NewMarketingClaimModal
          categories={categories}
          scienceClaims={scienceClaims}
          reviewer={reviewer}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function MarketingCard({
  claim,
  backing,
  categoryName,
  reviewer,
  onChanged,
}: {
  claim: LibClaim;
  backing: LibClaim[];
  categoryName: string;
  reviewer: string;
  onChanged: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<null | "reject" | "comment">(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const approvedBacking = backing.filter((b) => b.status === "approved").length;
  const evidenceLine =
    claim.scope === "category" && backing.length > 0
      ? evidenceBasisLine(backing.map((b) => ({ pmid: b.studies?.pmid ?? null, title: b.studies?.title ?? "" })))
      : null;

  async function act(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${claim.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: reviewer || "unknown", ...payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Action failed.");
        return;
      }
      setMode(null);
      setReason("");
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-[4px] border border-[#D6E6EE] bg-white p-5 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-[4px] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[claim.status]}`}>
          {STATUS_LABEL[claim.status] ?? claim.status}
        </span>
        <span className="rounded-[4px] bg-[#E1F4F3] px-2.5 py-0.5 text-[10px] font-semibold text-[#0A7A8A]">
          {categoryName}
        </span>
        <span className="text-[10px] font-semibold text-zinc-400">
          {claim.scope === "paper" ? "Single study finding" : "Aggregated claim"}
        </span>
      </div>

      <p className="text-[15px] font-semibold leading-relaxed text-[#052A4E]">{decodeEntities(claim.text)}</p>

      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-3 text-xs font-semibold text-[#0A7A8A] hover:underline"
      >
        {open
          ? "Hide evidence ▲"
          : evidenceLine ?? `Backed by ${backing.length} finding${backing.length === 1 ? "" : "s"}`}
        {!open && backing.length > 0 ? ` · ${approvedBacking} approved` : ""}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {backing.length === 0 ? (
            <p className="rounded-[4px] bg-[#FBEED6] px-3 py-2 text-[11px] font-medium text-[#8A5A0B]">
              No evidence linked yet. A finding needs backing before it can be approved.
            </p>
          ) : (
            backing.map((b) => {
              const qte = (b.claim_quotes ?? [])[0];
              return (
                <div key={b.id} className="rounded-[4px] border border-[#E2EDF2] bg-[#FAFDFE] p-3">
                  {/* The evidence IS the verbatim quote from the study, not a restated claim. */}
                  <p className="border-l-2 border-[#C2D9E3] pl-2.5 text-[12px] italic leading-relaxed text-zinc-600">
                    “{decodeEntities(qte?.quote ?? b.text)}”
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500">
                    {b.studies?.title && (
                      <span className="font-medium text-[#052A4E]">{b.studies.title}</span>
                    )}
                    {qte?.location && <span className="text-zinc-400">· {qte.location}</span>}
                    {b.studies?.pmid && (
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${b.studies.pmid}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-[#0A7A8A] hover:underline"
                      >
                        PubMed {b.studies.pmid} →
                      </a>
                    )}
                    {qte && !qte.verified && (
                      <span className="font-semibold text-[#9A2A2A]">⚠︎ quote not verbatim</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {error && <p className="mt-2 text-[11px] font-semibold text-[#9A2A2A]">{error}</p>}

      {(mode === "reject" || mode === "comment") && (
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={mode === "reject" ? "Why is this finding not usable? (required)" : "Add a comment"}
          className="mt-2 w-full rounded-[4px] border border-[#B7D9DE] p-2 text-sm outline-none focus:border-[#3FD0C9]"
          rows={2}
        />
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {mode === null && (
          <>
            {claim.status !== "approved" && (
              <Btn tone="approve" disabled={busy} onClick={() => act({ action: "approve" })}>✓ Approve</Btn>
            )}
            {claim.status !== "rejected" && (
              <Btn tone="reject" disabled={busy} onClick={() => setMode("reject")}>✕ Reject</Btn>
            )}
            <Btn tone="neutral" disabled={busy} onClick={() => setMode("comment")}>💬 Comment</Btn>
          </>
        )}
        {mode === "reject" && (
          <>
            <Btn tone="reject" disabled={busy || !reason.trim()} onClick={() => act({ action: "reject", comment: reason })}>Confirm reject</Btn>
            <Btn tone="neutral" disabled={busy} onClick={() => { setMode(null); setReason(""); }}>Cancel</Btn>
          </>
        )}
        {mode === "comment" && (
          <>
            <Btn tone="neutral" disabled={busy || !reason.trim()} onClick={() => act({ action: "comment", comment: reason })}>Post comment</Btn>
            <Btn tone="neutral" disabled={busy} onClick={() => { setMode(null); setReason(""); }}>Cancel</Btn>
          </>
        )}
      </div>
    </li>
  );
}

function NewMarketingClaimModal({
  categories,
  scienceClaims,
  reviewer,
  onClose,
  onCreated,
}: {
  categories: Category[];
  scienceClaims: LibClaim[];
  reviewer: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Structured composer fields for a single study finding — see app/lib/finding-format.ts.
  const [authorYear, setAuthorYear] = useState("");
  const [authorYearTouched, setAuthorYearTouched] = useState(false);
  const [result, setResult] = useState("");
  const [design, setDesign] = useState("");
  // Freeform text, used only when evidence spans more than one study (an aggregated claim).
  const [aggregateText, setAggregateText] = useState("");

  const catName = useMemo(() => {
    const m: Record<string, string> = {};
    categories.forEach((c) => (m[c.id] = c.name));
    return m;
  }, [categories]);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    const list = scienceClaims.filter(
      (c) =>
        !needle ||
        c.text.toLowerCase().includes(needle) ||
        (c.studies?.title ?? "").toLowerCase().includes(needle)
    );
    // selected first, then the rest, capped so the list stays light
    const sel = list.filter((c) => selected.has(c.id));
    const rest = list.filter((c) => !selected.has(c.id));
    return { shown: [...sel, ...rest].slice(0, 60), total: list.length };
  }, [scienceClaims, q, selected]);

  const selectedClaims = useMemo(
    () => scienceClaims.filter((c) => selected.has(c.id)),
    [scienceClaims, selected]
  );
  // A finding restates ONE study's own endpoint result — evidence from a single study gets the
  // structured "Author Year: result (design)" composer; evidence spanning several studies is a
  // broader aggregated claim, which keeps the old freeform text plus an evidence-basis line.
  const evidenceStudy = useMemo(() => {
    const pmids = new Set(selectedClaims.map((c) => c.studies?.pmid).filter(Boolean));
    return pmids.size === 1 ? selectedClaims.find((c) => c.studies?.pmid)!.studies! : null;
  }, [selectedClaims]);

  useEffect(() => {
    if (evidenceStudy && !authorYearTouched) {
      setAuthorYear(authorYearPrefix(evidenceStudy.authors, evidenceStudy.year));
    }
  }, [evidenceStudy, authorYearTouched]);

  const composedText = evidenceStudy ? composeFindingText({ authorYear, result, design }) : aggregateText;
  const canSubmit = !!categoryId && selected.size > 0 && (evidenceStudy ? !!result.trim() : !!aggregateText.trim());

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function submit() {
    if (!categoryId) {
      setError("Pick a category.");
      return;
    }
    if (selected.size === 0) {
      setError("Link at least one piece of evidence.");
      return;
    }
    if (!composedText.trim()) {
      setError(evidenceStudy ? "Describe the endpoint result." : "Write the finding.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: evidenceStudy ? "paper" : "category",
          claim_type: "marketing",
          category_id: categoryId,
          text: composedText,
          backed_by: [...selected],
          created_by: reviewer,
          ...(evidenceStudy
            ? {
                study: {
                  pmid: evidenceStudy.pmid,
                  title: evidenceStudy.title,
                  authors: evidenceStudy.authors,
                  year: evidenceStudy.year,
                  journal: evidenceStudy.journal,
                  doi: evidenceStudy.doi,
                },
              }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create the finding.");
        return;
      }
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[#031B34]/60 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div className="my-6 w-full max-w-3xl overflow-hidden rounded-[4px] border border-[#D6E6EE] bg-white shadow-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#D6E6EE] bg-[#F4FBFC] px-6 py-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0A7A8A]">New finding</div>
          <button onClick={onClose} aria-label="Close" className="rounded-[4px] p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <span className="text-xl leading-none">✕</span>
          </button>
        </div>

        <div className="max-h-[76vh] overflow-y-auto px-6 py-5">
          <div className="mb-4 rounded-[4px] border border-[#E2EDF2] bg-[#FAFDFE] px-3.5 py-2.5 text-[11.5px] leading-relaxed text-zinc-600">
            A finding restates what the study itself measured, never a consumer benefit.
            <br />
            <span className="text-[#9A2A2A]">Not: </span>
            "Your body handles X with ease", "reduces inflammation", "supports easy digestion"
            <br />
            <span className="text-[#1B7A3D]">Instead: </span>
            "Stonehouse 2022: Krill oil improved osteoarthritic knee pain in adults with mild to
            moderate knee osteoarthritis (6-month RCT, multicenter, double-blind,
            placebo-controlled)"
          </div>

          <label className="mb-1 block text-xs font-semibold text-zinc-600">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mb-4 w-full rounded-[4px] border border-[#B7D9DE] bg-white p-2 text-sm outline-none focus:border-[#3FD0C9]"
          >
            <option value="">Select a category…</option>
            <optgroup label="Science">
              {categories.filter((c) => c.parent === "science").map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
            <optgroup label="Marketing">
              {categories.filter((c) => c.parent === "marketing").map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
          </select>

          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-semibold text-zinc-600">
              Evidence — pick the study result this finding restates
            </label>
            <span className="text-[11px] font-semibold text-[#0A7A8A]">{selected.size} selected</span>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search findings or studies…"
            className="mb-2 w-full rounded-[4px] border border-[#B7D9DE] p-2 text-sm outline-none focus:border-[#3FD0C9]"
          />
          <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-[4px] border border-[#E2EDF2] bg-[#FAFDFE] p-2">
            {filtered.shown.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-start gap-2 rounded-[4px] p-2 hover:bg-white"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#0A7A8A]"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span className="text-[12px] leading-snug text-zinc-700">
                  <span className="font-medium text-[#052A4E]">[{catName[c.category_id] ?? c.category_id}]</span>{" "}
                  {decodeEntities(c.text)}
                  {c.studies?.title && <span className="text-zinc-400"> · {c.studies.title.slice(0, 60)}</span>}
                </span>
              </label>
            ))}
            {filtered.total > filtered.shown.length && (
              <p className="px-2 py-1 text-[11px] text-zinc-400">
                Showing {filtered.shown.length} of {filtered.total}. Refine the search to narrow.
              </p>
            )}
          </div>

          {selected.size === 0 ? null : evidenceStudy ? (
            <div className="mt-4 rounded-[4px] border border-[#B7D9DE] p-3.5">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#0A7A8A]">
                One study detected · endpoint result
              </p>
              <div className="mb-2.5 flex gap-2.5">
                <div className="w-[130px] shrink-0">
                  <label className="mb-1 block text-[11px] font-semibold text-zinc-600">
                    Author + year
                  </label>
                  <input
                    value={authorYear}
                    onChange={(e) => {
                      setAuthorYear(e.target.value);
                      setAuthorYearTouched(true);
                    }}
                    placeholder="Stonehouse 2022"
                    className="w-full rounded-[4px] border border-[#B7D9DE] p-1.5 text-[13px] outline-none focus:border-[#3FD0C9]"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-[11px] font-semibold text-zinc-600">
                    Study design
                  </label>
                  <input
                    value={design}
                    onChange={(e) => setDesign(e.target.value)}
                    placeholder="e.g. 6-month RCT, multicenter, double-blind, placebo-controlled"
                    className="w-full rounded-[4px] border border-[#B7D9DE] p-1.5 text-[13px] outline-none focus:border-[#3FD0C9]"
                  />
                </div>
              </div>
              <label className="mb-1 block text-[11px] font-semibold text-zinc-600">
                Result on the primary or secondary endpoint
              </label>
              <textarea
                value={result}
                onChange={(e) => setResult(e.target.value)}
                rows={2}
                placeholder="e.g. Krill oil improved osteoarthritic knee pain in adults with mild to moderate knee osteoarthritis"
                className="mb-2.5 w-full rounded-[4px] border border-[#B7D9DE] p-2 text-[13px] outline-none focus:border-[#3FD0C9]"
              />
              <p className="text-[11px] font-semibold text-zinc-500">Preview</p>
              <p className="mt-1 rounded-[4px] bg-[#FAFDFE] p-2 text-[12.5px] text-[#052A4E]">
                {composedText || "…"}
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <div className="mb-2 rounded-[4px] bg-[#FBEED6] px-3 py-2 text-[11px] font-medium text-[#8A5A0B]">
                Evidence spans more than one study, so this becomes an aggregated claim — describe
                what the combined evidence shows, not a single study's result.
              </div>
              <label className="mb-1 block text-xs font-semibold text-zinc-600">
                Aggregated finding
              </label>
              <textarea
                value={aggregateText}
                onChange={(e) => setAggregateText(e.target.value)}
                rows={2}
                className="w-full rounded-[4px] border border-[#B7D9DE] p-2 text-sm outline-none focus:border-[#3FD0C9]"
              />
              <p className="mt-1.5 text-[11px] text-zinc-500">
                {evidenceBasisLine(
                  selectedClaims.map((c) => ({ pmid: c.studies?.pmid ?? null, title: c.studies?.title ?? "" }))
                )}
              </p>
            </div>
          )}

          <p className="mt-3 text-[10.5px] leading-relaxed text-zinc-400">{REGULATORY_DISCLAIMER}</p>

          {error && <p className="mt-3 text-[11px] font-semibold text-[#9A2A2A]">{error}</p>}

          <div className="mt-4 flex gap-2">
            <button
              onClick={submit}
              disabled={busy || !canSubmit}
              className="rounded-[4px] bg-[#1B7A3D] px-4 py-2 text-sm font-bold text-white hover:bg-[#166433] disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create finding"}
            </button>
            <button onClick={onClose} className="rounded-[4px] border border-[#D6E6EE] bg-white px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-50">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function FilterKnapp({
  aktiv,
  onClick,
  children,
}: {
  aktiv: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-[4px] px-3.5 py-1.5 text-xs font-semibold transition-colors ${
        aktiv
          ? "bg-[#0A7A8A] text-white shadow-sm"
          : "bg-white text-zinc-600 ring-1 ring-[#D6E6EE] hover:bg-[#E1F4F3]"
      }`}
    >
      {children}
    </button>
  );
}

function Btn({
  tone,
  disabled,
  onClick,
  children,
}: {
  tone: "approve" | "reject" | "neutral";
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const cls =
    tone === "approve"
      ? "bg-[#1B7A3D] text-white hover:bg-[#166433]"
      : tone === "reject"
      ? "bg-[#9A2A2A] text-white hover:bg-[#7f2020]"
      : "border border-[#D6E6EE] bg-white text-zinc-600 hover:bg-zinc-50";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-[4px] px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}
