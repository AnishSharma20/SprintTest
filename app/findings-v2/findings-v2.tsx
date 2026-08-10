"use client";

// The Findings Library V2 body: list + evidence chain panel. See ./page.tsx for the why.
// Restyled 2026-08-10 to the same "floating & focused" design as Scientific Studies V2
// (calm near-white page, text sidebar with brand icons, floating cards, status as words).

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Category, ClaimStatus } from "../lib/claims-types";
import { decodeEntities } from "../lib/text";
import { formatDate } from "../study-meta";
import CategoryManager from "../category-manager";
import type { Link, LibClaim } from "./page";
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
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-[300px]">
            <button
              onClick={() => setCreating(true)}
              className="rounded-full bg-[#1D1D1F] px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#3A3A3C] sm:self-end"
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
                      {backing.length} quote{backing.length === 1 ? "" : "s"} · {studies}{" "}
                      {studies === 1 ? "study" : "studies"}
                    </span>
                  </div>
                  <p className="text-[16px] font-semibold leading-[1.5] tracking-[-0.01em] text-[#1D1D1F]">
                    {decodeEntities(c.text)}
                  </p>
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

  return (
    <div>
      <PanelHeader eyebrow="Evidence chain" onClose={onClose} title={decodeEntities(claim.text)}>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {statusPill(claim.status)}
          <span className="text-[12.5px] text-[#AEAEB2]">{categoryName}</span>
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
              The evidence · {backing.length} quote{backing.length === 1 ? "" : "s"} from {studies}{" "}
              {studies === 1 ? "study" : "studies"}
            </div>
            {backing.map((b) => {
              const qte = (b.claim_quotes ?? [])[0];
              return (
                <div key={b.id} className="mb-4 overflow-hidden rounded-[16px] border border-[#E8E8ED]">
                  {/* The evidence IS the verbatim quote from the study, not a restated claim. */}
                  <div className="border-l-[3px] border-[#0A7A8A] bg-[#FAFDFE] px-5 py-4">
                    <p className="text-[14.5px] leading-[1.6] text-[#2C2C2E]">
                      “{decodeEntities(qte?.quote ?? b.text)}”
                    </p>
                  </div>
                  <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      {b.studies?.title && (
                        <p className="text-[13px] font-semibold leading-snug text-[#1D1D1F]">
                          {b.studies.title}
                        </p>
                      )}
                      {qte?.location && (
                        <p className="mt-0.5 text-[11.5px] text-[#AEAEB2]">Cited from: {qte.location}</p>
                      )}
                    </div>
                    {qte && (
                      <span
                        className={`shrink-0 text-[11.5px] font-semibold ${
                          qte.verified ? "text-[#2E7D4F]" : "text-[#B3403A]"
                        }`}
                      >
                        {qte.verified ? "✓ Verbatim" : "Not verbatim"}
                      </span>
                    )}
                  </div>
                  {b.studies?.pmid && (
                    <div className="flex gap-2 border-t border-[#F0F0F2] px-5 py-3">
                      <a
                        href={`/studies-v2?pmid=${b.studies.pmid}`}
                        className="rounded-full bg-[#1D1D1F] px-4 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#3A3A3C]"
                      >
                        View study
                      </a>
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${b.studies.pmid}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full px-4 py-1.5 text-[12px] font-semibold text-[#1D1D1F] shadow-[inset_0_0_0_1px_#D9D9DE] transition-colors hover:bg-[#F5F5F7]"
                      >
                        PubMed
                      </a>
                    </div>
                  )}
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
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function submit() {
    if (!text.trim() || !categoryId) {
      setError("Pick a category and write the finding.");
      return;
    }
    if (selected.size === 0) {
      setError("Link at least one finding as evidence.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "category",
          claim_type: "marketing",
          category_id: categoryId,
          text,
          backed_by: [...selected],
          created_by: reviewer,
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
          <label className="mb-1.5 block text-[12.5px] font-semibold text-[#6E6E73]">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mb-4 w-full rounded-[12px] border border-[#E8E8ED] bg-white p-2.5 text-[14px] outline-none focus:border-[#C7C7CC]"
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

          <label className="mb-1.5 block text-[12.5px] font-semibold text-[#6E6E73]">
            Finding · what we can say about the product
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="e.g. Superba krill oil supports joint comfort in adults."
            className="mb-5 w-full rounded-[12px] border border-[#E8E8ED] p-3 text-[14px] outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
          />

          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[12.5px] font-semibold text-[#6E6E73]">
              Evidence · link the study evidence that backs this up
            </label>
            <span className="text-[12px] font-semibold text-[#1D1D1F]">{selected.size} selected</span>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search findings or studies…"
            className="mb-2.5 w-full rounded-[12px] border border-[#E8E8ED] p-2.5 text-[14px] outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
          />
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-[12px] border border-[#E8E8ED] bg-[#FBFBFD] p-2">
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

          {error && <p className="mt-3 text-[12px] font-semibold text-[#B3403A]">{error}</p>}

          <div className="mt-5 flex gap-2.5">
            <button
              onClick={submit}
              disabled={busy || !text.trim() || !categoryId || selected.size === 0}
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
