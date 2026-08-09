"use client";

// The Findings Library V2 body: list + evidence chain panel. See ./page.tsx for the why.

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

type StatusFilter = "pending" | "approved" | "rejected" | "all";

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  pending: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
  all: "All findings",
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

  const tittel = `${STATUS_FILTER_LABEL[status]}${
    valgtKategori ? ` · ${catName[valgtKategori] ?? valgtKategori}` : ""
  }`;

  const sidebar = (
    <div className="pb-4">
      <div className="px-4 pt-5">
        <button
          onClick={() => setCreating(true)}
          className="w-full rounded-[8px] bg-[#0A7A8A] px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-[#086472]"
        >
          ＋ New finding
        </button>
      </div>
      <SideSection title="Status">
        {(["pending", "approved", "rejected", "all"] as StatusFilter[]).map((s) => (
          <SideItem
            key={s}
            active={status === s}
            onClick={() => setStatus(s)}
            count={statusCounts[s]}
            icon={
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  s === "pending"
                    ? "bg-[#E9B44C]"
                    : s === "approved"
                    ? "bg-[#1B7A3D]"
                    : s === "rejected"
                    ? "bg-[#C46A6A]"
                    : "bg-zinc-300"
                }`}
              />
            }
          >
            {STATUS_FILTER_LABEL[s]}
          </SideItem>
        ))}
      </SideSection>
      <SideSection title="Benefit area">
        <SideItem active={valgtKategori === null} onClick={() => setValgtKategori(null)} count={marketing.length}>
          All benefit areas
        </SideItem>
        {kategorier.map((k) => (
          <SideItem
            key={k.id}
            active={valgtKategori === k.id}
            onClick={() => setValgtKategori(k.id)}
            count={k.antall}
          >
            {k.navn}
          </SideItem>
        ))}
        <button
          onClick={() => setAdministrerer(true)}
          className="mt-1 w-full rounded-[6px] px-2.5 py-2 text-left text-[12px] font-bold text-[#0A7A8A] hover:bg-[#E1F4F3]"
        >
          ⚙ Manage categories
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
      <div className="px-5 py-6 sm:px-8">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0A7A8A]">
          Findings library
        </div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-[#052A4E]">{tittel}</h1>
            <p className="mt-1 max-w-xl text-[13px] text-zinc-500">
              {filtrert.length} finding{filtrert.length === 1 ? "" : "s"}
              {status === "pending" && filtrert.length > 0 && " waiting"} · pick one to see its
              evidence chain{valgt ? "" : " on the right"}.
            </p>
          </div>
        </div>

        {/* On small screens the sidebar is hidden, so status surfaces as chips here. */}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
          {(["pending", "approved", "rejected", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                status === s ? "bg-[#0A7A8A] text-white" : "bg-white text-zinc-600 ring-1 ring-[#D6E6EE]"
              }`}
            >
              {STATUS_FILTER_LABEL[s]} ({statusCounts[s]})
            </button>
          ))}
        </div>

        <div className="mt-4 max-w-xl">
          <SearchBox value={q} onChange={setQ} placeholder="Search findings…" />
        </div>

        {marketing.length === 0 ? (
          <div className="mt-4 rounded-[8px] border border-dashed border-[#C2D9E3] p-8 text-center">
            <p className="text-zinc-500">No findings yet.</p>
            <p className="mt-1 text-sm text-zinc-400">
              Create one and link it to the study evidence that backs it up.
            </p>
          </div>
        ) : filtrert.length === 0 ? (
          <p className="mt-4 rounded-[8px] border border-dashed border-[#C2D9E3] p-8 text-center text-zinc-400">
            No findings match your search and filters.
          </p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {filtrert.map((c) => {
              const backing = backingOf[c.id] ?? [];
              const studies = new Set(backing.map((b) => b.study_id ?? b.id)).size;
              return (
                <li
                  key={c.id}
                  onClick={() => setValgtId(c.id)}
                  className={`cursor-pointer rounded-[10px] border bg-white p-4 shadow-sm transition-all ${
                    valgtId === c.id
                      ? "border-[#0A7A8A] ring-1 ring-[#0A7A8A]"
                      : "border-[#D6E6EE] hover:border-[#3FD0C9] hover:shadow-md"
                  }`}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    {statusPill(c.status)}
                    {!valgtKategori && (
                      <Pill tone="teal">{catName[c.category_id] ?? c.category_id}</Pill>
                    )}
                    <span className="ml-auto text-[11.5px] font-bold text-[#0A7A8A]">
                      {backing.length} quote{backing.length === 1 ? "" : "s"} · {studies}{" "}
                      {studies === 1 ? "study" : "studies"}
                    </span>
                  </div>
                  <p className="text-[14px] font-bold leading-relaxed text-[#052A4E]">
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

/* ---------- the evidence chain panel (Concept B) ---------- */

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

  return (
    <div>
      <PanelHeader eyebrow="Evidence chain" onClose={onClose} title={decodeEntities(claim.text)}>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {statusPill(claim.status)}
          <Pill tone="teal">{categoryName}</Pill>
        </div>
      </PanelHeader>

      <div className="px-6 py-5">
        {backing.length === 0 ? (
          <p className="rounded-[6px] bg-[#FBEED6] px-3 py-2 text-[11.5px] font-medium text-[#8A5A0B]">
            No evidence linked yet. A finding needs backing before it can be approved.
          </p>
        ) : (
          backing.map((b, i) => {
            const qte = (b.claim_quotes ?? [])[0];
            const last = i === backing.length - 1;
            return (
              <div key={b.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E1F4F3] text-[11px] font-extrabold text-[#0A7A8A]">
                    {i + 1}
                  </div>
                  {!last && <div className="my-1 w-0.5 flex-1 bg-[#DCEAF0]" />}
                </div>
                <div className="mb-3 flex-1 rounded-[10px] border border-[#E2EDF2] bg-[#FAFDFE] p-3.5">
                  {/* The evidence IS the verbatim quote from the study, not a restated claim. */}
                  <p className="border-l-2 border-[#3FD0C9] pl-2.5 text-[12.5px] italic leading-relaxed text-zinc-600">
                    “{decodeEntities(qte?.quote ?? b.text)}”
                  </p>
                  <div className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                    {b.studies?.title && (
                      <span className="font-semibold text-[#052A4E]">{b.studies.title}</span>
                    )}
                    {qte?.location && <span className="text-zinc-400"> · {qte.location}</span>}
                    <div className="mt-0.5 flex flex-wrap gap-x-3">
                      {b.studies?.pmid && (
                        <>
                          <a
                            href={`https://pubmed.ncbi.nlm.nih.gov/${b.studies.pmid}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-bold text-[#0A7A8A] hover:underline"
                          >
                            PubMed {b.studies.pmid} →
                          </a>
                          <a
                            href={`/studies-v2?pmid=${b.studies.pmid}`}
                            className="font-bold text-[#0A7A8A] hover:underline"
                          >
                            Open study summary
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                  {qte &&
                    (qte.verified ? (
                      <span className="mt-2 inline-block rounded-full bg-[#DFF3E4] px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-[#1B7A3D]">
                        ✓ Quote verified verbatim
                      </span>
                    ) : (
                      <span className="mt-2 inline-block rounded-full bg-[#F3E0E0] px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-[#9A2A2A]">
                        ⚠ Quote not verbatim
                      </span>
                    ))}
                </div>
              </div>
            );
          })
        )}

        {error && <p className="mt-2 text-[11px] font-semibold text-[#9A2A2A]">{error}</p>}

        {(mode === "reject" || mode === "comment") && (
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={mode === "reject" ? "Why is this finding not usable? (required)" : "Add a comment"}
            className="mt-3 w-full rounded-[6px] border border-[#B7D9DE] p-2 text-sm outline-none focus:border-[#3FD0C9]"
            rows={2}
          />
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {mode === null && (
            <>
              {claim.status !== "approved" && (
                <button
                  disabled={busy}
                  onClick={() => act({ action: "approve" })}
                  className="flex-1 rounded-[8px] bg-[#1B7A3D] px-4 py-2.5 text-[13px] font-bold text-white hover:bg-[#166433] disabled:opacity-40"
                >
                  ✓ Approve finding
                </button>
              )}
              {claim.status !== "rejected" && (
                <button
                  disabled={busy}
                  onClick={() => setMode("reject")}
                  className="flex-1 rounded-[8px] border border-[#E6C9C9] bg-white px-4 py-2.5 text-[13px] font-bold text-[#9A2A2A] hover:bg-[#F9EFEF] disabled:opacity-40"
                >
                  ✕ Reject…
                </button>
              )}
              <button
                disabled={busy}
                onClick={() => setMode("comment")}
                className="rounded-[8px] border border-[#D6E6EE] bg-white px-4 py-2.5 text-[13px] font-bold text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
              >
                💬 Comment
              </button>
            </>
          )}
          {mode === "reject" && (
            <>
              <button
                disabled={busy || !reason.trim()}
                onClick={() => act({ action: "reject", comment: reason })}
                className="rounded-[8px] bg-[#9A2A2A] px-4 py-2.5 text-[13px] font-bold text-white hover:bg-[#7f2020] disabled:opacity-40"
              >
                Confirm reject
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setMode(null);
                  setReason("");
                }}
                className="rounded-[8px] border border-[#D6E6EE] bg-white px-4 py-2.5 text-[13px] font-semibold text-zinc-600 hover:bg-zinc-50"
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
                className="rounded-[8px] bg-[#0A7A8A] px-4 py-2.5 text-[13px] font-bold text-white hover:bg-[#086472] disabled:opacity-40"
              >
                Post comment
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setMode(null);
                  setReason("");
                }}
                className="rounded-[8px] border border-[#D6E6EE] bg-white px-4 py-2.5 text-[13px] font-semibold text-zinc-600 hover:bg-zinc-50"
              >
                Cancel
              </button>
            </>
          )}
        </div>

        <div className="mt-5 border-t border-[#EDF4F7] pt-4 text-[11.5px] leading-relaxed text-zinc-500">
          <b className="text-[#052A4E]">History</b>
          <div className="mt-1">
            {claim.origin === "ai_extracted" ? "Extracted by AI" : `Created by ${claim.created_by || "unknown"}`}
            {claim.created_at && <> · {formatDate(claim.created_at)}</>}
          </div>
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
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-[#031B34]/60 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="my-6 w-full max-w-3xl overflow-hidden rounded-[8px] border border-[#D6E6EE] bg-white shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#D6E6EE] bg-[#F4FBFC] px-6 py-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0A7A8A]">New finding</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-[4px] p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <span className="text-xl leading-none">✕</span>
          </button>
        </div>

        <div className="max-h-[76vh] overflow-y-auto px-6 py-5">
          <label className="mb-1 block text-xs font-semibold text-zinc-600">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mb-3 w-full rounded-[6px] border border-[#B7D9DE] bg-white p-2 text-sm outline-none focus:border-[#3FD0C9]"
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

          <label className="mb-1 block text-xs font-semibold text-zinc-600">
            Finding (what we can say about the product)
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="e.g. Superba krill oil supports joint comfort in adults."
            className="mb-4 w-full rounded-[6px] border border-[#B7D9DE] p-2 text-sm outline-none focus:border-[#3FD0C9]"
          />

          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-semibold text-zinc-600">
              Evidence — link the study evidence that backs this up
            </label>
            <span className="text-[11px] font-semibold text-[#0A7A8A]">{selected.size} selected</span>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search findings or studies…"
            className="mb-2 w-full rounded-[6px] border border-[#B7D9DE] p-2 text-sm outline-none focus:border-[#3FD0C9]"
          />
          <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-[6px] border border-[#E2EDF2] bg-[#FAFDFE] p-2">
            {filtered.shown.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded-[4px] p-2 hover:bg-white">
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

          {error && <p className="mt-3 text-[11px] font-semibold text-[#9A2A2A]">{error}</p>}

          <div className="mt-4 flex gap-2">
            <button
              onClick={submit}
              disabled={busy || !text.trim() || !categoryId || selected.size === 0}
              className="rounded-[8px] bg-[#1B7A3D] px-4 py-2 text-sm font-bold text-white hover:bg-[#166433] disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create finding"}
            </button>
            <button
              onClick={onClose}
              className="rounded-[8px] border border-[#D6E6EE] bg-white px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
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
