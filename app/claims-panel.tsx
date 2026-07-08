"use client";

// Claims review panel for one study (rendered inside each study card in Tab 1).
// Science reviewers see AI-extracted and human claims, filter by status (including a
// Rejected view), and approve / reject (reason required) / edit (new version) / comment.
// Extraction is triggered from here; results land as pending_review, never auto-approved.

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

export default function ClaimsPanel({ s, reviewer }: { s: Studie; reviewer: string }) {
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filter, setFilter] = useState<Filter>("pending_review");
  const [extracting, setExtracting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

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

  async function extract() {
    setExtracting(true);
    setNote(null);
    try {
      const res = await fetch("/api/extract-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ study: studyMeta(s), actor: reviewer }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNote(data.error || "Extraction failed.");
      } else {
        const src = data.source === "abstract_only" ? "the abstract" : "the full text";
        setNote(
          `Extracted ${data.created} new claim${data.created === 1 ? "" : "s"} from ${src}` +
            (data.unverified ? `, ${data.unverified} with a quote not found in the source (flagged)` : "") +
            (data.skipped ? `, ${data.skipped} already present` : "") +
            "."
        );
        await load();
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setExtracting(false);
    }
  }

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
      <div className="mt-3 rounded-xl border border-dashed border-[#C2D9E3] bg-white p-4 text-sm text-zinc-500">
        The claims library is not set up yet. Add the Supabase environment variables to enable
        claim extraction and review.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-[#D6E6EE] bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-bold uppercase tracking-wide text-[#0A7A8A]">
          Claims for this study
        </div>
        <button
          onClick={extract}
          disabled={extracting}
          className="rounded-lg bg-[#0A7A8A] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#086472] disabled:opacity-50"
        >
          {extracting ? "Extracting…" : "✦ Extract claims with AI"}
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
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

      {note && (
        <p className="mb-3 rounded-md bg-[#EAF6F8] px-3 py-2 text-[11px] text-[#0A7A8A]">{note}</p>
      )}

      {loading ? (
        <p className="text-sm text-zinc-400">Loading claims…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[#C2D9E3] p-4 text-center text-sm text-zinc-400">
          {counts.all === 0
            ? "No claims yet. Extract claims with AI, then review them here."
            : "No claims in this view."}
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((c) => (
            <ClaimRow
              key={c.id}
              claim={c}
              categories={categories}
              reviewer={reviewer}
              onChanged={load}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

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

      {/* Grounding quote(s) with verification state */}
      {quotes.map((q) => (
        <div key={q.id} className="mt-2 border-l-2 border-[#C2D9E3] pl-2.5">
          <p className="text-[12px] italic text-zinc-500">“{q.quote}”</p>
          <span
            className={`text-[10px] font-semibold ${
              q.verified ? "text-[#1B7A3D]" : "text-[#9A2A2A]"
            }`}
          >
            {q.verified
              ? `✓ Quote found in source${q.location ? ` · ${q.location}` : ""}`
              : "⚠︎ Quote NOT found in source — verify manually"}
          </span>
        </div>
      ))}

      {/* Comments + rejection reasons */}
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

      {/* Reject reason / comment input */}
      {(mode === "reject" || mode === "comment") && (
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={mode === "reject" ? "Why is this claim wrong or unusable? (required)" : "Add a comment"}
          className="mt-2 w-full rounded-md border border-[#B7D9DE] p-2 text-sm outline-none focus:border-[#3FD0C9]"
          rows={2}
        />
      )}

      {/* Actions */}
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
