"use client";

// Marketing-claims layer for the Claims Library. A marketing claim is "what we can say about the
// product" (plain, benefit-facing) — NOT a verbatim study sentence. Each is backed_by one or more
// science claims (the evidence), so the statement is always traceable to its substantiation.

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Claim, Category, ClaimStatus } from "./lib/claims-types";
import { decodeEntities } from "./lib/text";

type Link = { parent_claim_id: string; child_claim_id: string; relation: string };
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
        <p className="max-w-2xl text-sm text-zinc-500">
          What marketing can say about the product. Each claim is written in plain, benefit facing
          language and linked to the science that substantiates it, so it stays defensible.
        </p>
        <button
          onClick={() => setCreating(true)}
          className="shrink-0 rounded-lg bg-[#0A7A8A] px-4 py-2 text-sm font-bold text-white hover:bg-[#086472]"
        >
          ＋ New marketing claim
        </button>
      </div>

      {marketing.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#C2D9E3] p-8 text-center">
          <p className="text-zinc-500">No marketing claims yet.</p>
          <p className="mt-1 text-sm text-zinc-400">
            Create one and link it to the science claims that back it up.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {marketing.map((m) => (
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
    <li className="rounded-2xl border border-[#D6E6EE] bg-white p-5 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[claim.status]}`}>
          {STATUS_LABEL[claim.status] ?? claim.status}
        </span>
        <span className="rounded-full bg-[#E1F4F3] px-2.5 py-0.5 text-[10px] font-semibold text-[#0A7A8A]">
          {categoryName}
        </span>
      </div>

      <p className="text-[15px] font-semibold leading-relaxed text-[#052A4E]">{decodeEntities(claim.text)}</p>

      <button
        onClick={() => setOpen((o) => !o)}
        className="mt-3 text-xs font-semibold text-[#0A7A8A] hover:underline"
      >
        {open ? "Hide evidence ▲" : `Backed by ${backing.length} claim${backing.length === 1 ? "" : "s"}`}
        {backing.length > 0 ? ` · ${approvedBacking} approved` : ""}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {backing.length === 0 ? (
            <p className="rounded-lg bg-[#FBEED6] px-3 py-2 text-[11px] font-medium text-[#8A5A0B]">
              No evidence linked yet. A marketing claim needs backing before it can be approved.
            </p>
          ) : (
            backing.map((b) => {
              const qte = (b.claim_quotes ?? [])[0];
              return (
                <div key={b.id} className="rounded-lg border border-[#E2EDF2] bg-[#FAFDFE] p-3">
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
          placeholder={mode === "reject" ? "Why is this claim not usable? (required)" : "Add a comment"}
          className="mt-2 w-full rounded-md border border-[#B7D9DE] p-2 text-sm outline-none focus:border-[#3FD0C9]"
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
    // selected first, then the rest, capped so the list stays light
    const sel = list.filter((c) => selected.has(c.id));
    const rest = list.filter((c) => !selected.has(c.id));
    return { shown: [...sel, ...rest].slice(0, 60), total: list.length };
  }, [scienceClaims, q, selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function submit() {
    if (!text.trim() || !categoryId) {
      setError("Pick a category and write the claim.");
      return;
    }
    if (selected.size === 0) {
      setError("Link at least one science claim as evidence.");
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
        setError(data.error || "Could not create the claim.");
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
      <div className="my-6 w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#D6E6EE] bg-[#F4FBFC] px-6 py-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0A7A8A]">New marketing claim</div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <span className="text-xl leading-none">✕</span>
          </button>
        </div>

        <div className="max-h-[76vh] overflow-y-auto px-6 py-5">
          <label className="mb-1 block text-xs font-semibold text-zinc-600">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mb-3 w-full rounded-md border border-[#B7D9DE] bg-white p-2 text-sm outline-none focus:border-[#3FD0C9]"
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

          <label className="mb-1 block text-xs font-semibold text-zinc-600">
            Marketing claim (what we can say about the product)
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="e.g. Superba krill oil supports joint comfort in adults."
            className="mb-4 w-full rounded-md border border-[#B7D9DE] p-2 text-sm outline-none focus:border-[#3FD0C9]"
          />

          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-semibold text-zinc-600">
              Evidence — link the science claims that back this up
            </label>
            <span className="text-[11px] font-semibold text-[#0A7A8A]">{selected.size} selected</span>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search science claims or studies…"
            className="mb-2 w-full rounded-md border border-[#B7D9DE] p-2 text-sm outline-none focus:border-[#3FD0C9]"
          />
          <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-[#E2EDF2] bg-[#FAFDFE] p-2">
            {filtered.shown.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-start gap-2 rounded-md p-2 hover:bg-white"
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

          {error && <p className="mt-3 text-[11px] font-semibold text-[#9A2A2A]">{error}</p>}

          <div className="mt-4 flex gap-2">
            <button
              onClick={submit}
              disabled={busy || !text.trim() || !categoryId || selected.size === 0}
              className="rounded-lg bg-[#1B7A3D] px-4 py-2 text-sm font-bold text-white hover:bg-[#166433] disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create marketing claim"}
            </button>
            <button onClick={onClose} className="rounded-lg border border-[#D6E6EE] bg-white px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-50">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
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
      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}
