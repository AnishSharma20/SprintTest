"use client";

// The Findings Library V2 body: list + evidence chain panel. See ./page.tsx for the why.
// Restyled 2026-08-10 to the same "floating & focused" design as Scientific Studies V2
// (calm near-white page, text sidebar with brand icons, floating cards, status as words).

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Category, ClaimStatus } from "../lib/claims-types";
import { decodeEntities } from "../lib/text";
import { formatDate } from "../study-meta";
import {
  authorYearPrefix,
  composeFindingText,
  evidenceBasisLine,
  guessAuthorSurname,
  splitDesignSuffix,
  stripCitationPrefix,
  REGULATORY_DISCLAIMER,
} from "../lib/finding-format";
import CategoryManager from "../category-manager";
import type { Link, LibClaim } from "./page";
import studyPdfsRaw from "../study-pdfs.json";

const STUDY_PDFS = studyPdfsRaw as Record<string, { file: string; sizeKB: number }>;

/** The real paper's PDF when AKBM supplied one, else its DOI page, else its PubMed record — same
 * fallback chain as Scientific Studies V2's "Open study in PDF" (app/studies-v2/wiki-v2.tsx). */
function studySourceHref(s: { pmid: string | null; doi: string | null } | null | undefined): string | null {
  if (!s) return null;
  const local = s.pmid ? STUDY_PDFS[s.pmid] : undefined;
  if (local) return `/study-pdfs/${local.file}`;
  if (s.doi) return `https://doi.org/${s.doi}`;
  if (s.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/`;
  return null;
}
import {
  V2Shell,
  SideSection,
  SideItem,
  SearchBox,
  PanelHeader,
  Pill,
  SideReviewer,
} from "../v2/ui";
import { benefitIcon } from "../v2/benefit-icons";

type StatusFilter = "pending" | "approved" | "rejected" | "all";

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  pending: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
  all: "All findings",
};

const STATUS_DOT: Record<StatusFilter, string> = {
  pending: "bg-[#E0A93E]",
  approved: "bg-[#2E7D4F]",
  rejected: "bg-[#B3403A]",
  all: "bg-[#C7C7CC]",
};

// draft counts as "needs review" — it is not usable yet and someone has to look at it.
function statusBucket(s: ClaimStatus): StatusFilter {
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  return "pending";
}

function statusPill(s: ClaimStatus) {
  if (s === "approved") return <Pill tone="green">Approved</Pill>;
  if (s === "rejected") return <Pill tone="red">Rejected</Pill>;
  if (s === "draft") return <Pill tone="gray">Draft</Pill>;
  return <Pill tone="amber">Pending review</Pill>;
}

export default function FindingsV2({
  claims,
  links,
  categories,
  reviewer,
  onReviewerChange,
  onChanged,
}: {
  claims: LibClaim[];
  links: Link[];
  categories: Category[];
  reviewer: string;
  onReviewerChange: (v: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [valgtKategori, setValgtKategori] = useState<string | null>(null);
  const [valgtId, setValgtId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [administrerer, setAdministrerer] = useState(false);

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
  const scienceClaims = useMemo(
    () => claims.filter((c) => c.claim_type === "science" && c.status !== "superseded"),
    [claims]
  );

  // parent claim id -> backing science claims (the evidence)
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

  const statusCounts = useMemo(() => {
    const c: Record<StatusFilter, number> = { pending: 0, approved: 0, rejected: 0, all: marketing.length };
    marketing.forEach((m) => (c[statusBucket(m.status)] += 1));
    return c;
  }, [marketing]);

  // Benefit areas, biggest first — counts across all statuses so the sidebar stays stable
  // while you work through a queue.
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

  const filtrert = useMemo(() => {
    const needle = q.toLowerCase().trim();
    return marketing.filter((c) => {
      const treffSok = !needle || c.text.toLowerCase().includes(needle);
      const treffKat = !valgtKategori || c.category_id === valgtKategori;
      const treffStatus = status === "all" || statusBucket(c.status) === status;
      return treffSok && treffKat && treffStatus;
    });
  }, [marketing, q, valgtKategori, status]);

  const valgt = valgtId ? byId[valgtId] ?? null : null;

  const sidebar = (
    <div className="pb-6">
      <SideSection title="Status">
        {(["pending", "approved", "rejected", "all"] as StatusFilter[]).map((s) => (
          <SideItem key={s} active={status === s} onClick={() => setStatus(s)} count={statusCounts[s]}>
            <span className="inline-flex items-center gap-2">
              <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${STATUS_DOT[s]}`} />
              {STATUS_FILTER_LABEL[s]}
            </span>
          </SideItem>
        ))}
      </SideSection>
      <SideSection title="Benefit areas">
        <SideItem active={valgtKategori === null} onClick={() => setValgtKategori(null)} count={marketing.length}>
          All benefit areas
        </SideItem>
        {kategorier.map((k) => (
          <SideItem
            key={k.id}
            active={valgtKategori === k.id}
            onClick={() => setValgtKategori(k.id)}
            count={k.antall}
            icon={benefitIcon(k.navn)}
          >
            {k.navn}
          </SideItem>
        ))}
        <button
          onClick={() => setAdministrerer(true)}
          className="mt-2 py-[5px] text-left text-[13px] font-semibold text-[#0A7A8A] hover:underline"
        >
          Manage categories
        </button>
      </SideSection>
      <SideReviewer value={reviewer} onChange={onReviewerChange} hint="Recorded on approvals, rejections and comments." />
    </div>
  );

  return (
    <V2Shell
      sidebar={sidebar}
      panel={
        valgt ? (
          <EvidencePanel
            claim={valgt}
            backing={backingOf[valgt.id] ?? []}
            categoryName={catName[valgt.category_id] ?? valgt.category_id}
            reviewer={reviewer}
            onChanged={onChanged}
            onClose={() => setValgtId(null)}
          />
        ) : null
      }
      onClosePanel={() => setValgtId(null)}
    >
      <div className="px-6 pb-16 pt-10 sm:px-10">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div>
            <h1 className="text-[28px] font-bold tracking-[-0.022em] text-[#1D1D1F] sm:text-[32px]">
              {STATUS_FILTER_LABEL[status]}
              {valgtKategori && <span className="text-[#AEAEB2]"> · {catName[valgtKategori] ?? valgtKategori}</span>}
            </h1>
            <p className="mt-2 max-w-[540px] text-[15px] text-[#6E6E73]">
              What we can say about the product · every finding is traceable to a verified study quote.
            </p>
            <p className="mt-1.5 max-w-[540px] text-[11.5px] leading-relaxed text-[#AEAEB2]">
              {REGULATORY_DISCLAIMER}
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-[300px]">
            <button
              onClick={() => setCreating(true)}
              className="self-end rounded-full bg-[#1D1D1F] px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#3A3A3C]"
            >
              + New finding
            </button>
            <SearchBox value={q} onChange={setQ} placeholder="Search findings" />
          </div>
        </div>

        {/* On small screens the sidebar is hidden, so status surfaces as pills here. */}
        <div className="mt-5 flex gap-2 overflow-x-auto pb-1 lg:hidden">
          {(["pending", "approved", "rejected", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${
                status === s ? "bg-[#1D1D1F] text-white" : "bg-[#EFEFF1] text-[#1D1D1F]"
              }`}
            >
              {STATUS_FILTER_LABEL[s]} · {statusCounts[s]}
            </button>
          ))}
        </div>

        <div className="mt-7 border-b border-[#E8E8ED] pb-3.5 text-[12.5px] text-[#AEAEB2]">
          {filtrert.length} finding{filtrert.length === 1 ? "" : "s"}
          {status === "pending" && filtrert.length > 0 && " waiting"} · pick one to see its evidence
          chain
        </div>

        {marketing.length === 0 ? (
          <div className="mt-10 text-center">
            <p className="text-[14px] text-[#6E6E73]">No findings yet.</p>
            <p className="mt-1 text-[13px] text-[#AEAEB2]">
              Create one and link it to the study evidence that backs it up.
            </p>
          </div>
        ) : filtrert.length === 0 ? (
          <p className="mt-10 text-center text-[14px] text-[#AEAEB2]">
            No findings match your search and filters.
          </p>
        ) : (
          <ul>
            {filtrert.map((c) => {
              const backing = backingOf[c.id] ?? [];
              const evidenceLine =
                c.scope === "category" && backing.length > 0
                  ? evidenceBasisLine(backing.map((b) => ({ pmid: b.studies?.pmid ?? null, title: b.studies?.title ?? "" })))
                  : null;
              const studies = new Set(backing.map((b) => b.study_id ?? b.id)).size;
              return (
                <li
                  key={c.id}
                  onClick={() => setValgtId(c.id)}
                  className={`mt-4 cursor-pointer rounded-[20px] bg-white p-6 transition-shadow sm:p-7 ${
                    valgtId === c.id
                      ? "shadow-[0_0_0_2px_#1D1D1F,0_2px_10px_rgba(29,29,31,.05)]"
                      : "shadow-[0_2px_10px_rgba(29,29,31,.05)] hover:shadow-[0_6px_24px_rgba(29,29,31,.1)]"
                  }`}
                >
                  <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    {statusPill(c.status)}
                    {!valgtKategori && (
                      <span className="text-[12.5px] text-[#AEAEB2]">{catName[c.category_id] ?? c.category_id}</span>
                    )}
                    <span className="ml-auto text-[12.5px] text-[#AEAEB2]">
                      {evidenceLine ??
                        `${backing.length} quote${backing.length === 1 ? "" : "s"} · ${studies} ${
                          studies === 1 ? "study" : "studies"
                        }`}
                    </span>
                  </div>
                  <p className="text-[16px] font-semibold leading-[1.5] tracking-[-0.01em] text-[#1D1D1F]">
                    {splitDesignSuffix(stripCitationPrefix(decodeEntities(c.text))).body}
                  </p>
                  <div className="mt-2 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setValgtId(c.id);
                      }}
                      className="inline-block text-[12.5px] font-semibold text-[#0A7A8A] hover:underline"
                    >
                      Trace source →
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {administrerer && (
        <CategoryManager reviewer={reviewer} onClose={() => setAdministrerer(false)} onChanged={onChanged} />
      )}

      {creating && (
        <NewFindingModal
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
    </V2Shell>
  );
}

/* ---------- the evidence chain panel ---------- */

function EvidencePanel({
  claim,
  backing,
  categoryName,
  reviewer,
  onChanged,
  onClose,
}: {
  claim: LibClaim;
  backing: LibClaim[];
  categoryName: string;
  reviewer: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<null | "reject" | "comment">(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  const comments = claim.claim_comments ?? [];
  const studies = new Set(backing.map((b) => b.study_id ?? b.id)).size;
  // The trailing "(design)" parenthetical is design detail, not part of the headline sentence —
  // shown as its own bullet list next to the source below instead (2026-08-10 feedback).
  // The "Author Year:" citation prefix comes off too (2026-08-10 feedback: "not any name and
  // year") — the study byline is now its own "Study N: Author, Title" list below instead.
  const { body: designStripped, design: claimDesign } = splitDesignSuffix(decodeEntities(claim.text));
  const titleBody = stripCitationPrefix(designStripped);
  const seenStudyIds = new Set<string>();
  const distinctStudies = backing
    .filter((b) => {
      const key = b.study_id ?? b.id;
      if (!b.studies || seenStudyIds.has(key)) return false;
      seenStudyIds.add(key);
      return true;
    })
    .map((b) => b.studies!);

  return (
    <div>
      <PanelHeader
        eyebrow="Evidence chain"
        onClose={onClose}
        title={<span className="text-[14.5px] font-semibold leading-snug">{titleBody}</span>}
      >
        {distinctStudies.length > 0 && (
          <ul className="mt-2.5 space-y-0.5">
            {distinctStudies.map((s, i) => (
              <li key={s.pmid ?? i} className="text-[12.5px] leading-snug text-[#6E6E73]">
                <span className="font-semibold text-[#1D1D1F]">Study {i + 1}:</span>{" "}
                {guessAuthorSurname(s.authors) || "Unknown author"}, {s.title}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {statusPill(claim.status)}
          <span className="text-[12.5px] text-[#AEAEB2]">{categoryName}</span>
          <span className="text-[12.5px] text-[#AEAEB2]">
            {claim.scope === "paper" ? "Single study finding" : "Aggregated claim"}
          </span>
        </div>
      </PanelHeader>

      <div className="px-7 py-6">
        {backing.length === 0 ? (
          <p className="rounded-[12px] border border-[#F2E3BC] bg-[#FFF8E9] px-4 py-2.5 text-[12.5px] text-[#8A6A2B]">
            No evidence linked yet. A finding needs backing before it can be approved.
          </p>
        ) : (
          <>
            <div className="mb-4 text-[12.5px] font-semibold text-[#AEAEB2]">
              {claim.scope === "category"
                ? evidenceBasisLine(backing.map((b) => ({ pmid: b.studies?.pmid ?? null, title: b.studies?.title ?? "" })))
                : `The evidence · ${backing.length} quote${backing.length === 1 ? "" : "s"} from ${studies} ${
                    studies === 1 ? "study" : "studies"
                  }`}
            </div>
            {backing.map((b) => {
              const qte = (b.claim_quotes ?? [])[0];
              const pdfHref = studySourceHref(b.studies);
              return (
                <div key={b.id} className="mb-4 overflow-hidden rounded-[16px] border border-[#E8E8ED]">
                  {/* The evidence IS the verbatim quote from the study, not a restated claim. */}
                  <div className="border-l-[3px] border-[#0A7A8A] bg-[#FAFDFE] px-5 py-4">
                    <p className="text-[13px] leading-[1.6] text-[#2C2C2E]">
                      “{decodeEntities(qte?.quote ?? b.text)}”
                    </p>
                  </div>
                  <div className="border-t border-[#F0F0F2] px-5 py-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#AEAEB2]">
                      Study supporting this quote
                    </p>
                    {b.studies?.title && (
                      <p className="mt-1 text-[13px] font-semibold leading-snug text-[#1D1D1F]">
                        {b.studies.title}
                      </p>
                    )}
                    <p className="mt-1.5 text-[11.5px] text-[#6E6E73]">
                      {qte && (
                        <span className={`font-semibold ${qte.verified ? "text-[#2E7D4F]" : "text-[#B3403A]"}`}>
                          {qte.verified ? "Verbatim quote" : "Not verified verbatim"}
                        </span>
                      )}
                      {qte?.location && <> · from the {qte.location} section of the paper above</>}
                    </p>
                    {claimDesign.length > 0 && (
                      <ul className="mt-2.5 space-y-1">
                        {claimDesign.map((d, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[11.5px] text-[#6E6E73]">
                            <span className="mt-[6px] h-[3px] w-[3px] shrink-0 rounded-full bg-[#C7C7CC]" />
                            {d}
                          </li>
                        ))}
                      </ul>
                    )}
                    {pdfHref && (
                      <a
                        href={pdfHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2.5 inline-block text-[11.5px] font-semibold text-[#0A7A8A] hover:underline"
                      >
                        Open study in PDF →
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}

        {error && <p className="mt-2 text-[12px] font-semibold text-[#B3403A]">{error}</p>}

        {(mode === "reject" || mode === "comment") && (
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={mode === "reject" ? "Why is this finding not usable? (required)" : "Add a comment"}
            className="mt-4 w-full rounded-[12px] border border-[#E8E8ED] bg-white p-3.5 text-[14px] outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
            rows={2}
          />
        )}

        <div className="mt-5 flex flex-wrap gap-2.5">
          {mode === null && (
            <>
              {claim.status !== "approved" && (
                <button
                  disabled={busy}
                  onClick={() => act({ action: "approve" })}
                  className="rounded-[12px] bg-[#1D1D1F] px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-[#3A3A3C] disabled:opacity-40"
                >
                  Approve finding
                </button>
              )}
              {claim.status !== "rejected" && (
                <button
                  disabled={busy}
                  onClick={() => setMode("reject")}
                  className="rounded-[12px] bg-[#F4F4F5] px-5 py-2.5 text-[13.5px] font-semibold text-[#B3403A] hover:bg-[#EDEDEF] disabled:opacity-40"
                >
                  Reject…
                </button>
              )}
              <button
                disabled={busy}
                onClick={() => setMode("comment")}
                className="rounded-[12px] px-5 py-2.5 text-[13.5px] font-semibold text-[#6E6E73] hover:bg-[#F4F4F5] disabled:opacity-40"
              >
                Add comment
              </button>
            </>
          )}
          {mode === "reject" && (
            <>
              <button
                disabled={busy || !reason.trim()}
                onClick={() => act({ action: "reject", comment: reason })}
                className="rounded-[12px] bg-[#B3403A] px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-[#9A322D] disabled:opacity-40"
              >
                Confirm reject
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setMode(null);
                  setReason("");
                }}
                className="rounded-[12px] bg-[#EFEFF1] px-5 py-2.5 text-[13.5px] font-semibold text-[#1D1D1F] hover:bg-[#E4E4E7]"
              >
                Cancel
              </button>
            </>
          )}
          {mode === "comment" && (
            <>
              <button
                disabled={busy || !reason.trim()}
                onClick={() => act({ action: "comment", comment: reason })}
                className="rounded-[12px] bg-[#1D1D1F] px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-[#3A3A3C] disabled:opacity-40"
              >
                Post comment
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setMode(null);
                  setReason("");
                }}
                className="rounded-[12px] bg-[#EFEFF1] px-5 py-2.5 text-[13.5px] font-semibold text-[#1D1D1F] hover:bg-[#E4E4E7]"
              >
                Cancel
              </button>
            </>
          )}
        </div>

        <div className="mt-7 border-t border-[#E8E8ED] pt-4 text-[12px] leading-[1.9] text-[#AEAEB2]">
          {claim.origin === "ai_extracted" ? "Extracted by AI" : `Created by ${claim.created_by || "unknown"}`}
          {claim.created_at && <> · {formatDate(claim.created_at)}</>} · decisions are recorded with
          your reviewer name
          {claim.approved_by && claim.status === "approved" && (
            <div>
              Approved by {claim.approved_by}
              {claim.approved_at && <> · {formatDate(claim.approved_at)}</>}
            </div>
          )}
          {comments.map((c) => (
            <div key={c.id}>
              {c.kind === "rejection_reason" ? "Rejected" : "Comment"} by {c.author || "unknown"} ·
              “{decodeEntities(c.body)}” · {formatDate(c.created_at)}
            </div>
          ))}
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-[#AEAEB2]">{REGULATORY_DISCLAIMER}</p>
      </div>
    </div>
  );
}

/* ---------- new finding modal (same behavior as V1's) ---------- */

function NewFindingModal({
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
  const isAggregate = selected.size > 0 && !evidenceStudy;

  // Re-suggest the author/year prefix from the detected study, unless the reviewer already
  // edited it by hand (never clobber a deliberate correction).
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
      if (n.has(id)) n.delete(id);
      else n.add(id);
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
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-[#1D1D1F]/40 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="my-6 w-full max-w-3xl overflow-hidden rounded-[20px] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E8E8ED] px-7 py-5">
          <div className="text-[15px] font-bold text-[#1D1D1F]">New finding</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-[6px] p-1.5 text-[#AEAEB2] hover:bg-[#F2F2F4] hover:text-[#6E6E73]"
          >
            <span className="text-xl leading-none">✕</span>
          </button>
        </div>

        <div className="max-h-[76vh] overflow-y-auto px-7 py-6">
          <div className="mb-5 rounded-[12px] border border-[#E8E8ED] bg-[#FBFBFD] px-4 py-3 text-[12px] leading-relaxed text-[#6E6E73]">
            A finding restates what the study itself measured, never a consumer benefit.
            <br />
            <span className="text-[#B3403A]">Not: </span>
            "Your body handles X with ease", "reduces inflammation", "supports easy digestion"
            <br />
            <span className="text-[#2E7D4F]">Instead: </span>
            "Stonehouse 2022: Krill oil improved osteoarthritic knee pain in adults with mild to
            moderate knee osteoarthritis (6-month RCT, multicenter, double-blind,
            placebo-controlled)"
            <br />
            Only add a finding for a result favorable to krill oil — a benefit shown, or a
            favorable safety/tolerability result. Skip null or unfavorable endpoints rather than
            wording around them.
          </div>

          <label className="mb-1.5 block text-[12.5px] font-semibold text-[#6E6E73]">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mb-5 w-full rounded-[12px] border border-[#E8E8ED] bg-white p-2.5 text-[14px] outline-none focus:border-[#C7C7CC]"
          >
            <option value="">Select a category…</option>
            <optgroup label="Science">
              {categories
                .filter((c) => c.parent === "science")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Marketing">
              {categories
                .filter((c) => c.parent === "marketing")
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </optgroup>
          </select>

          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[12.5px] font-semibold text-[#6E6E73]">
              Evidence · pick the study result this finding restates
            </label>
            <span className="text-[12px] font-semibold text-[#1D1D1F]">{selected.size} selected</span>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search findings or studies…"
            className="mb-2.5 w-full rounded-[12px] border border-[#E8E8ED] p-2.5 text-[14px] outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
          />
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-[12px] border border-[#E8E8ED] bg-[#FBFBFD] p-2">
            {filtered.shown.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-start gap-2.5 rounded-[8px] p-2 hover:bg-white">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#1D1D1F]"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span className="text-[12.5px] leading-snug text-[#3A3A3C]">
                  <span className="font-semibold text-[#1D1D1F]">[{catName[c.category_id] ?? c.category_id}]</span>{" "}
                  {decodeEntities(c.text)}
                  {c.studies?.title && <span className="text-[#AEAEB2]"> · {c.studies.title.slice(0, 60)}</span>}
                </span>
              </label>
            ))}
            {filtered.total > filtered.shown.length && (
              <p className="px-2 py-1 text-[11.5px] text-[#AEAEB2]">
                Showing {filtered.shown.length} of {filtered.total}. Refine the search to narrow.
              </p>
            )}
          </div>

          {selected.size === 0 ? null : evidenceStudy ? (
            <div className="mt-5 rounded-[12px] border border-[#E8E8ED] p-4">
              <p className="mb-3 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#AEAEB2]">
                One study detected · endpoint result
              </p>
              <div className="mb-3 flex gap-3">
                <div className="w-[140px] shrink-0">
                  <label className="mb-1 block text-[11.5px] font-semibold text-[#6E6E73]">
                    Author + year
                  </label>
                  <input
                    value={authorYear}
                    onChange={(e) => {
                      setAuthorYear(e.target.value);
                      setAuthorYearTouched(true);
                    }}
                    placeholder="Stonehouse 2022"
                    className="w-full rounded-[10px] border border-[#E8E8ED] p-2 text-[13px] outline-none focus:border-[#C7C7CC]"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-[11.5px] font-semibold text-[#6E6E73]">
                    Study design
                  </label>
                  <input
                    value={design}
                    onChange={(e) => setDesign(e.target.value)}
                    placeholder="e.g. 6-month RCT, multicenter, double-blind, placebo-controlled"
                    className="w-full rounded-[10px] border border-[#E8E8ED] p-2 text-[13px] outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
                  />
                </div>
              </div>
              <label className="mb-1 block text-[11.5px] font-semibold text-[#6E6E73]">
                Result on the primary or secondary endpoint
              </label>
              <textarea
                value={result}
                onChange={(e) => setResult(e.target.value)}
                rows={2}
                placeholder="e.g. Krill oil improved osteoarthritic knee pain in adults with mild to moderate knee osteoarthritis"
                className="mb-3 w-full rounded-[10px] border border-[#E8E8ED] p-2.5 text-[13.5px] outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
              />
              <p className="text-[11.5px] font-semibold text-[#AEAEB2]">Preview</p>
              <p className="mt-1 rounded-[10px] bg-[#FBFBFD] p-2.5 text-[13px] text-[#1D1D1F]">
                {composedText || "…"}
              </p>
            </div>
          ) : (
            <div className="mt-5">
              <div className="mb-2 rounded-[10px] border border-[#F2E3BC] bg-[#FFF8E9] px-3.5 py-2.5 text-[12px] text-[#8A6A2B]">
                Evidence spans more than one study, so this becomes an aggregated claim —
                describe what the combined evidence shows, not a single study's result.
              </div>
              <label className="mb-1.5 block text-[12.5px] font-semibold text-[#6E6E73]">
                Aggregated finding
              </label>
              <textarea
                value={aggregateText}
                onChange={(e) => setAggregateText(e.target.value)}
                rows={2}
                className="w-full rounded-[12px] border border-[#E8E8ED] p-3 text-[14px] outline-none focus:border-[#C7C7CC]"
              />
              <p className="mt-2 text-[11.5px] text-[#AEAEB2]">
                {evidenceBasisLine(
                  selectedClaims.map((c) => ({ pmid: c.studies?.pmid ?? null, title: c.studies?.title ?? "" }))
                )}
              </p>
            </div>
          )}

          <p className="mt-4 text-[11px] leading-relaxed text-[#AEAEB2]">{REGULATORY_DISCLAIMER}</p>

          {error && <p className="mt-3 text-[12px] font-semibold text-[#B3403A]">{error}</p>}

          <div className="mt-5 flex gap-2.5">
            <button
              onClick={submit}
              disabled={busy || !canSubmit}
              className="rounded-[12px] bg-[#1D1D1F] px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-[#3A3A3C] disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create finding"}
            </button>
            <button
              onClick={onClose}
              className="rounded-[12px] bg-[#EFEFF1] px-5 py-2.5 text-[13.5px] font-semibold text-[#1D1D1F] hover:bg-[#E4E4E7]"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
