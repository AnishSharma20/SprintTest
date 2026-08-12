"use client";

// The Findings Library body: list + evidence chain panel. See ./page.tsx for the why.
// Restyled 2026-08-10 to the same "floating & focused" design as Scientific Studies
// (calm near-white page, text sidebar with brand icons, floating cards, status as words).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Category, ClaimStatus, ClaimSentiment } from "../lib/claims-types";
import type { Studie } from "../studies";
import { decodeEntities } from "../lib/text";
import { formatDate } from "../study-meta";
import {
  evidenceBasisLine,
  guessAuthorSurname,
  splitDesignSuffix,
  stripCitationPrefix,
  REGULATORY_DISCLAIMER,
} from "../lib/finding-format";
import CategoryManager from "../category-manager";
import CategorySelect from "../category-select";
import type { Link, LibClaim } from "./page";
import studyPdfsRaw from "../study-pdfs.json";

const STUDY_PDFS = studyPdfsRaw as Record<string, { file: string; sizeKB: number }>;

/** The real paper's PDF when AKBM supplied one, else its DOI page, else its PubMed record — same
 * fallback chain as Scientific Studies' "Open study in PDF" (app/wiki-v2.tsx). */
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

const SENTIMENT_LABEL: Record<ClaimSentiment, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};

/** Which way the finding's result points, so a review queue or a deck shows balanced evidence
 * rather than cherry picked positives — deliberately as visible as the status pill next to it. */
function sentimentPill(s: ClaimSentiment | null | undefined) {
  if (!s) return <Pill tone="gray">Not yet assessed</Pill>;
  return <Pill tone={s === "positive" ? "green" : s === "negative" ? "red" : "gray"}>{SENTIMENT_LABEL[s]}</Pill>;
}


export default function FindingsV2({
  claims,
  links,
  categories,
  studies,
  reviewer,
  onReviewerChange,
  onChanged,
}: {
  claims: LibClaim[];
  links: Link[];
  categories: Category[];
  studies: Studie[];
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

  // Same default-view rule as Scientific Studies: the biggest benefit area, until the user
  // picks one themselves; a category that disappears hands the selection back.
  const brukerHarValgtKategori = useRef(false);
  useEffect(() => {
    if (kategorier.length === 0) return;
    const finnes = valgtKategori !== null && kategorier.some((k) => k.id === valgtKategori);
    if (!brukerHarValgtKategori.current || (valgtKategori !== null && !finnes)) {
      setValgtKategori(kategorier[0].id);
    }
  }, [kategorier, valgtKategori]);

  const velgKategori = (id: string | null) => {
    brukerHarValgtKategori.current = true;
    setValgtKategori(id);
  };

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
        {kategorier.map((k) => (
          <SideItem
            key={k.id}
            active={valgtKategori === k.id}
            onClick={() => velgKategori(k.id)}
            count={k.antall}
            icon={benefitIcon(k.navn)}
          >
            {k.navn}
          </SideItem>
        ))}
        <SideItem active={valgtKategori === null} onClick={() => velgKategori(null)} count={marketing.length}>
          All benefit areas
        </SideItem>
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
          <div className="min-w-0 flex-1">
            <h1 className="text-[28px] font-bold tracking-[-0.022em] text-[#1D1D1F] sm:text-[32px]">
              {valgtKategori ? `${catName[valgtKategori] ?? "Category"} Findings` : "All findings"}
            </h1>
            <p className="mt-2 max-w-[540px] text-[15px] text-[#6E6E73]">
              What we can say about the product, every finding is traceable to a verified study quote.
            </p>
            <p className="mt-1.5 max-w-[540px] text-[11.5px] leading-relaxed text-[#AEAEB2]">
              {REGULATORY_DISCLAIMER}
            </p>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-3 sm:w-[300px]">
            <SearchBox value={q} onChange={setQ} placeholder="Search findings" />
            <button
              onClick={() => setCreating(true)}
              className={`rounded-full bg-[#1D1D1F] px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#3A3A3C] ${
                valgt ? "self-start" : "self-end"
              }`}
            >
              + New finding
            </button>
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
                    {sentimentPill(c.sentiment)}
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
          studies={studies}
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
          {sentimentPill(claim.sentiment)}
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
          {claim.created_at && <>Created {formatDate(claim.created_at)}</>} · decisions are recorded with
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

type FindingRowDraft = {
  id: string;
  categoryId: string;
  studyId: string;
  text: string;
  sentiment: ClaimSentiment | "";
};

function newFindingRow(): FindingRowDraft {
  return { id: crypto.randomUUID(), categoryId: "", studyId: "", text: "", sentiment: "" };
}

function NewFindingModal({
  categories,
  studies,
  reviewer,
  onClose,
  onCreated,
}: {
  categories: Category[];
  studies: Studie[];
  reviewer: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [findings, setFindings] = useState<FindingRowDraft[]>([newFindingRow()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scienceCategories = useMemo(() => categories.filter((c) => c.parent === "science"), [categories]);
  const catName = useMemo(() => {
    const m: Record<string, string> = {};
    categories.forEach((c) => (m[c.id] = c.name));
    return m;
  }, [categories]);

  function studiesFor(categoryId: string): Studie[] {
    if (!categoryId) return [];
    return studies.filter((s) => (s.kategoriIds ?? []).includes(categoryId));
  }

  function updateFinding(id: string, patch: Partial<FindingRowDraft>) {
    setFindings((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        const next = { ...f, ...patch };
        // A study picked under the old category no longer applies once the category changes.
        if (patch.categoryId !== undefined && patch.categoryId !== f.categoryId) next.studyId = "";
        return next;
      })
    );
  }
  function removeFinding(id: string) {
    setFindings((prev) => (prev.length > 1 ? prev.filter((f) => f.id !== id) : prev));
  }

  const toCreate = findings.filter((f) => f.text.trim());
  const canSubmit =
    toCreate.length > 0 && toCreate.every((f) => f.categoryId && f.studyId && f.sentiment && f.text.trim());

  async function submit() {
    if (toCreate.length === 0) {
      setError("Write at least one finding.");
      return;
    }
    for (const f of findings) {
      if (!f.text.trim()) continue; // an untouched row is skipped, not an error
      if (!f.categoryId || !f.studyId || !f.sentiment) {
        setError("Every finding needs a category, a study and a sentiment.");
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      // Sequential, not Promise.all: two findings for the same brand new study would race each
      // other's getOrCreateStudy() insert into the findings library's own studies table.
      let failed = 0;
      for (const f of toCreate) {
        const study = studies.find((s) => s.pmid === f.studyId);
        if (!study) {
          failed++;
          continue;
        }
        const res = await fetch("/api/claims", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: "paper",
            claim_type: "marketing",
            category_id: f.categoryId,
            text: f.text.trim(),
            sentiment: f.sentiment,
            created_by: reviewer,
            study: {
              pmid: study.pmid,
              title: study.tittel,
              authors: study.forfattere,
              year: study.ar ? parseInt(study.ar, 10) || null : null,
              journal: study.tidsskrift,
              doi: study.doiUrl ? study.doiUrl.replace("https://doi.org/", "") : null,
            },
          }),
        });
        if (!res.ok) failed++;
      }
      if (failed > 0) {
        setError(`${failed} of ${toCreate.length} finding(s) could not be created — try again.`);
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
        className="my-6 w-full max-w-2xl overflow-hidden rounded-[20px] bg-white shadow-2xl"
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
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[12.5px] font-semibold text-[#6E6E73]">Findings</div>
            <button
              type="button"
              onClick={() => setFindings((prev) => [...prev, newFindingRow()])}
              className="text-[12.5px] font-semibold text-[#0A7A8A] hover:underline"
            >
              + Add finding
            </button>
          </div>
          <div className="space-y-3">
            {findings.map((f, i) => {
              const studyOptions = studiesFor(f.categoryId);
              return (
                <div key={f.id} className="rounded-[12px] border border-[#E8E8ED] bg-[#FBFBFD] p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11.5px] font-semibold text-[#AEAEB2]">Finding {i + 1}</span>
                    {findings.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeFinding(f.id)}
                        className="text-[11.5px] font-semibold text-[#AEAEB2] hover:text-[#B3403A]"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="mb-2 grid gap-2 sm:grid-cols-2">
                    <CategorySelect
                      value={f.categoryId}
                      onChange={(v) => updateFinding(f.id, { categoryId: v })}
                      categories={scienceCategories}
                    />
                    <select
                      value={f.studyId}
                      onChange={(e) => updateFinding(f.id, { studyId: e.target.value })}
                      disabled={!f.categoryId}
                      className="rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-1.5 text-[12.5px] outline-none focus:border-[#C7C7CC] disabled:bg-[#F5F5F5] disabled:text-[#AEAEB2]"
                    >
                      <option value="">{f.categoryId ? "Select a study…" : "Pick a category first"}</option>
                      {studyOptions.map((s) => (
                        <option key={s.pmid} value={s.pmid}>
                          {s.tittel}
                        </option>
                      ))}
                    </select>
                  </div>
                  {f.categoryId && studyOptions.length === 0 && (
                    <p className="mb-2 text-[11.5px] text-[#AEAEB2]">
                      No studies are filed under {catName[f.categoryId] ?? "this category"} yet.
                    </p>
                  )}
                  <div className="mb-2 flex gap-2">
                    {(["positive", "neutral", "negative"] as ClaimSentiment[]).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => updateFinding(f.id, { sentiment: v })}
                        className={`flex-1 rounded-[10px] border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                          f.sentiment === v
                            ? v === "positive"
                              ? "border-[#2E7D4F] bg-[#E9F4EC] text-[#2E7D4F]"
                              : v === "negative"
                              ? "border-[#B3403A] bg-[#FBF3F3] text-[#B3403A]"
                              : "border-[#1D1D1F] bg-[#F4F4F5] text-[#1D1D1F]"
                            : "border-[#E8E8ED] text-[#6E6E73] hover:bg-white"
                        }`}
                      >
                        {SENTIMENT_LABEL[v]}
                      </button>
                    ))}
                  </div>
                  <label className="mb-1 block text-[11.5px] font-semibold text-[#6E6E73]">Key finding</label>
                  <textarea
                    value={f.text}
                    onChange={(e) => updateFinding(f.id, { text: e.target.value })}
                    rows={2}
                    placeholder="e.g. Reduced inflammation markers after 8 weeks of daily supplementation"
                    className="w-full rounded-[10px] border border-[#E8E8ED] bg-white p-2.5 text-[13.5px] outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
                  />
                </div>
              );
            })}
          </div>

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
