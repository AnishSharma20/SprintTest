"use client";

// Claims review MODAL for one study (opened from "View claims" in a study card, Tab 1).
// Science reviewers see the pre-filled AI claims and any human ones, filter by status (incl. a
// Rejected view), and approve / reject (reason required) / edit (new version) / comment. They can
// also ADD a claim by hand. AI extraction is NOT triggered here — the library is pre-filled ahead
// of time (see /api/admin/extract-all); this screen is review + manual authoring only.

import { useCallback, useEffect, useState } from "react";
import type { Studie } from "./wiki";
import type { Claim, ClaimStatus, Category } from "./lib/claims-types";
import type { StudyMeta } from "./lib/claims-db";

type Filter = "pending_review" | "approved" | "rejected" | "all";

const STATUS_STYLE: Record<ClaimStatus, string> = {
  approved: "bg-[#DFF3E4] text-[#1B7A3D]",
  pending_review: "bg-[#FBEED6] text-[#8A5A0B]",
  rejected: "bg-[#F3E0E0] text-[#9A2A2A]",
  superseded: "bg-zinc-100 text-zinc-500",
  draft: "bg-zinc-100 text-zinc-500",
};
const STATUS_LABEL: Record<ClaimStatus, string> = {
  approved: "Approved",
  pending_review: "Pending review",
  rejected: "Rejected",
  superseded: "Superseded",
  draft: "Draft",
};

function studyMeta(s: Studie): StudyMeta {
  return {
    pmid: s.pmid,
    doi: s.doiUrl ? s.doiUrl.replace(/^https?:\/\/doi\.org\//, "") : null,
    title: s.tittel,
    authors: s.forfattere,
    year: s.ar,
    journal: s.tidsskrift,
    verification: s.verified ? "curated" : "ai",
  };
}

// ── Modal shell ──────────────────────────────────────────────────────────────

export default function ClaimsModal({
  s,
  reviewer,
  onClose,
}: {
  s: Studie;
  reviewer: string;
  onClose: () => void;
}) {
  // Close on Escape, and lock background scroll while the dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#031B34]/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="my-8 w-full max-w-3xl rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 rounded-t-2xl border-b border-[#D6E6EE] bg-[#F4FBFC] px-5 py-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0A7A8A]">
              Claims for this study
            </div>
            <p className="mt-1 line-clamp-2 max-w-xl text-sm font-semibold text-[#052A4E]">{s.tittel}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <span className="text-xl leading-none">✕</span>
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <ClaimsBody s={s} reviewer={reviewer} />
        </div>
      </div>
    </div>
  );
}

// ── Body: filters, list, add-claim ─────────────────────────────────────────────

function ClaimsBody({ s, reviewer }: { s: Studie; reviewer: string }) {
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filter, setFilter] = useState<Filter>("pending_review");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/claims?pmid=${encodeURIComponent(s.pmid)}`);
      const data = await res.json();
      setConfigured(data.configured !== false);
      setClaims(data.claims ?? []);
      setCategories(data.categories ?? []);
    } catch {
      setConfigured(false);
    } finally {
      setLoading(false);
    }
  }, [s.pmid]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = claims
    .filter((c) => c.status !== "superseded" || filter === "all")
    .filter((c) => (filter === "all" ? true : c.status === filter));

  const counts = {
    pending_review: claims.filter((c) => c.status === "pending_review").length,
    approved: claims.filter((c) => c.status === "approved").length,
    rejected: claims.filter((c) => c.status === "rejected").length,
    all: claims.length,
  };

  if (!configured) {
    return (
      <div className="rounded-xl border border-dashed border-[#C2D9E3] bg-white p-4 text-sm text-zinc-500">
        The claims library is not set up yet. Add the Supabase environment variables to enable
        claim review.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {(["pending_review", "approved", "rejected", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                filter === f
                  ? "bg-[#052A4E] text-white"
                  : "bg-white text-zinc-600 ring-1 ring-[#D6E6EE] hover:bg-[#E1F4F3]"
              }`}
            >
              {f === "pending_review" ? "Pending" : f === "all" ? "All" : STATUS_LABEL[f as ClaimStatus]} (
              {counts[f]})
            </button>
          ))}
        </div>
        <button
          onClick={() => setAdding((a) => !a)}
          className="rounded-lg bg-[#0A7A8A] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#086472]"
        >
          {adding ? "Cancel" : "➕ Add a claim"}
        </button>
      </div>

      {adding && (
        <AddClaimForm
          s={s}
          reviewer={reviewer}
          categories={categories}
          onAdded={async () => {
            setAdding(false);
            setFilter("pending_review");
            await load();
          }}
        />
      )}

      {loading ? (
        <p className="text-sm text-zinc-400">Loading claims…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#C2D9E3] p-4 text-center text-sm text-zinc-400">
          {counts.all === 0
            ? "No claims for this study yet. Use “Add a claim” to author one."
            : "No claims in this view."}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((c) => (
            <ClaimRow key={c.id} claim={c} categories={categories} reviewer={reviewer} onChanged={load} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Add-claim form ─────────────────────────────────────────────────────────────

function AddClaimForm({
  s,
  reviewer,
  categories,
  onAdded,
}: {
  s: Studie;
  reviewer: string;
  categories: Category[];
  onAdded: () => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [text, setText] = useState("");
  const [quote, setQuote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const science = categories.filter((c) => c.parent === "science");
  const marketing = categories.filter((c) => c.parent === "marketing");

  async function submit() {
    if (!text.trim() || !categoryId) {
      setError("Pick a category and write the claim.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cat = categories.find((c) => c.id === categoryId);
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "paper",
          claim_type: cat?.parent ?? "science",
          category_id: categoryId,
          text,
          quote: quote.trim() || undefined,
          study: studyMeta(s),
          created_by: reviewer,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not add the claim.");
        return;
      }
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 rounded-xl border-2 border-[#3FD0C9] bg-[#F4FBFC] p-3">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#0A7A8A]">Add a claim</div>
      <label className="mb-1 block text-xs font-semibold text-zinc-600">Category</label>
      <select
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
        className="mb-2 w-full rounded-md border border-[#B7D9DE] bg-white p-2 text-sm outline-none focus:border-[#3FD0C9]"
      >
        <option value="">Select a category…</option>
        <optgroup label="Science">
          {science.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="Marketing">
          {marketing.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      </select>
      <label className="mb-1 block text-xs font-semibold text-zinc-600">Claim (one clear sentence)</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        className="mb-2 w-full rounded-md border border-[#B7D9DE] p-2 text-sm outline-none focus:border-[#3FD0C9]"
      />
      <label className="mb-1 block text-xs font-semibold text-zinc-600">
        Supporting quote from the paper (optional, checked against the source)
      </label>
      <textarea
        value={quote}
        onChange={(e) => setQuote(e.target.value)}
        rows={2}
        placeholder="Paste the exact sentence from the study, if you have one."
        className="mb-2 w-full rounded-md border border-[#B7D9DE] p-2 text-sm outline-none focus:border-[#3FD0C9]"
      />
      {error && <p className="mb-2 text-[11px] font-semibold text-[#9A2A2A]">{error}</p>}
      <button
        onClick={submit}
        disabled={busy || !text.trim() || !categoryId}
        className="rounded-lg bg-[#1B7A3D] px-4 py-2 text-sm font-bold text-white hover:bg-[#166433] disabled:opacity-40"
      >
        {busy ? "Adding…" : "Add claim (pending review)"}
      </button>
    </div>
  );
}

// ── One claim row (approve / reject / edit / comment) ──────────────────────────

function ClaimRow({
  claim,
  categories,
  reviewer,
  onChanged,
}: {
  claim: Claim;
  categories: Category[];
  reviewer: string;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<null | "reject" | "edit" | "comment">(null);
  const [draft, setDraft] = useState(claim.text);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const catName = categories.find((k) => k.id === claim.category_id)?.name ?? claim.category_id;
  const quotes = claim.claim_quotes ?? [];
  const comments = claim.claim_comments ?? [];

  async function act(payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${claim.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor: reviewer, ...payload }),
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
    <li className="rounded-lg border border-[#E2EDF2] bg-[#FAFDFE] p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[claim.status]}`}>
          {STATUS_LABEL[claim.status]}
        </span>
        <span className="rounded-full bg-[#E1F4F3] px-2 py-0.5 text-[10px] font-semibold text-[#0A7A8A]">
          {catName}
        </span>
        <span className="text-[10px] text-zinc-400">
          {claim.origin === "ai_extracted" ? "AI extracted" : "Added manually"}
          {claim.version > 1 && ` · v${claim.version}`}
        </span>
      </div>

      {mode === "edit" ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full rounded-md border border-[#B7D9DE] p-2 text-sm outline-none focus:border-[#3FD0C9]"
          rows={3}
        />
      ) : (
        <p className="text-sm text-zinc-800">{claim.text}</p>
      )}

      {quotes.map((q) => (
        <div key={q.id} className="mt-2 border-l-2 border-[#C2D9E3] pl-2.5">
          <p className="text-[12px] italic text-zinc-500">“{q.quote}”</p>
          <span
            className={`text-[10px] font-semibold ${q.verified ? "text-[#1B7A3D]" : "text-[#9A2A2A]"}`}
          >
            {q.verified
              ? `✓ Quote found in source${q.location ? ` · ${q.location}` : ""}`
              : "⚠︎ Quote NOT found in source — verify manually"}
          </span>
        </div>
      ))}

      {comments.length > 0 && (
        <div className="mt-2 space-y-1">
          {comments.map((cm) => (
            <p key={cm.id} className="text-[11px] text-zinc-500">
              <span className={cm.kind === "rejection_reason" ? "font-bold text-[#9A2A2A]" : "font-semibold text-zinc-600"}>
                {cm.kind === "rejection_reason" ? "Rejected: " : `${cm.author}: `}
              </span>
              {cm.body}
            </p>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-[11px] font-semibold text-[#9A2A2A]">{error}</p>}

      {(mode === "reject" || mode === "comment") && (
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={mode === "reject" ? "Why is this claim wrong or unusable? (required)" : "Add a comment"}
          className="mt-2 w-full rounded-md border border-[#B7D9DE] p-2 text-sm outline-none focus:border-[#3FD0C9]"
          rows={2}
        />
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {mode === null && (
          <>
            {claim.status !== "approved" && (
              <ActionBtn onClick={() => act({ action: "approve" })} disabled={busy} tone="approve">
                ✓ Approve
              </ActionBtn>
            )}
            {claim.status !== "rejected" && (
              <ActionBtn onClick={() => setMode("reject")} disabled={busy} tone="reject">
                ✕ Reject
              </ActionBtn>
            )}
            {(claim.status === "rejected" || claim.status === "superseded") && (
              <ActionBtn onClick={() => act({ action: "reopen" })} disabled={busy} tone="neutral">
                ↺ Reopen
              </ActionBtn>
            )}
            <ActionBtn onClick={() => { setDraft(claim.text); setMode("edit"); }} disabled={busy} tone="neutral">
              ✎ Edit
            </ActionBtn>
            <ActionBtn onClick={() => setMode("comment")} disabled={busy} tone="neutral">
              💬 Comment
            </ActionBtn>
          </>
        )}

        {mode === "reject" && (
          <>
            <ActionBtn onClick={() => act({ action: "reject", comment: reason })} disabled={busy || !reason.trim()} tone="reject">
              Confirm reject
            </ActionBtn>
            <ActionBtn onClick={() => { setMode(null); setReason(""); }} disabled={busy} tone="neutral">
              Cancel
            </ActionBtn>
          </>
        )}
        {mode === "edit" && (
          <>
            <ActionBtn onClick={() => act({ action: "edit", text: draft })} disabled={busy || !draft.trim()} tone="approve">
              Save as new version
            </ActionBtn>
            <ActionBtn onClick={() => setMode(null)} disabled={busy} tone="neutral">
              Cancel
            </ActionBtn>
          </>
        )}
        {mode === "comment" && (
          <>
            <ActionBtn onClick={() => act({ action: "comment", comment: reason })} disabled={busy || !reason.trim()} tone="neutral">
              Post comment
            </ActionBtn>
            <ActionBtn onClick={() => { setMode(null); setReason(""); }} disabled={busy} tone="neutral">
              Cancel
            </ActionBtn>
          </>
        )}
      </div>
    </li>
  );
}

function ActionBtn({
  onClick,
  disabled,
  tone,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone: "approve" | "reject" | "neutral";
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
