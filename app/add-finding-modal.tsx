"use client";

// Lightweight "Add finding" quick action from a study's own card on the Scientific Studies
// page — writes a finding directly for THIS study with no evidence-linking step (unlike the
// Findings Library's "New finding" modal, which composes from pre-extracted evidence claims).
// Posts straight to /api/claims (scope: paper, claim_type: marketing), the same endpoint and
// validation the Findings Library uses, so it's still gated to studies in this library and
// still lands as pending_review for a reviewer to check.

import { useState } from "react";
import { createPortal } from "react-dom";
import type { Studie } from "./studies";
import type { Category, ClaimSentiment } from "./lib/claims-types";
import { useCurrentUser } from "./lib/use-current-user";

const SENTIMENT_LABEL: Record<ClaimSentiment, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};

export default function AddFindingModal({
  study,
  categories,
  onClose,
  onCreated,
}: {
  study: Studie;
  categories: Category[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { name: reviewer } = useCurrentUser();
  const [categoryId, setCategoryId] = useState("");
  const [text, setText] = useState("");
  const [sentiment, setSentiment] = useState<ClaimSentiment | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scienceCategories = categories.filter((c) => c.parent === "science");
  const canSubmit = !!categoryId && !!sentiment && !!text.trim();

  async function submit() {
    if (!categoryId) {
      setError("Pick a category.");
      return;
    }
    if (!sentiment) {
      setError("Pick which way this result points.");
      return;
    }
    if (!text.trim()) {
      setError("Write the finding.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "paper",
          claim_type: "marketing",
          category_id: categoryId,
          text: text.trim(),
          sentiment,
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
        className="my-6 w-full max-w-lg overflow-hidden rounded-[20px] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E8E8ED] px-7 py-5">
          <div>
            <div className="text-[15px] font-bold text-[#1D1D1F]">Add finding</div>
            <div className="mt-0.5 text-[12.5px] text-[#AEAEB2]">{study.tittel}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-[6px] p-1.5 text-[#AEAEB2] hover:bg-[#F2F2F4] hover:text-[#6E6E73]"
          >
            <span className="text-xl leading-none">✕</span>
          </button>
        </div>

        <div className="px-7 py-6">
          <div className="mb-5 rounded-[12px] border border-[#E8E8ED] bg-[#FBFBFD] px-4 py-3 text-[12px] leading-relaxed text-[#6E6E73]">
            A finding restates what this study itself measured, never a consumer benefit. e.g.
            “Stonehouse 2022: Krill oil improved osteoarthritic knee pain in adults with mild to
            moderate knee osteoarthritis (6-month RCT, placebo-controlled)”.
          </div>

          <label className="mb-1.5 block text-[12.5px] font-semibold text-[#6E6E73]">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mb-5 w-full rounded-[12px] border border-[#E8E8ED] bg-white p-2.5 text-[14px] outline-none focus:border-[#C7C7CC]"
          >
            <option value="">Select a category…</option>
            {scienceCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <label className="mb-1.5 block text-[12.5px] font-semibold text-[#6E6E73]">
            Sentiment · which way this result points
          </label>
          <div className="mb-5 flex gap-2">
            {(["positive", "neutral", "negative"] as ClaimSentiment[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setSentiment(v)}
                className={`flex-1 rounded-[10px] border px-3 py-2 text-[13px] font-semibold transition-colors ${
                  sentiment === v
                    ? v === "positive"
                      ? "border-[#2E7D4F] bg-[#E9F4EC] text-[#2E7D4F]"
                      : v === "negative"
                      ? "border-[#B3403A] bg-[#FBF3F3] text-[#B3403A]"
                      : "border-[#1D1D1F] bg-[#F4F4F5] text-[#1D1D1F]"
                    : "border-[#E8E8ED] text-[#6E6E73] hover:bg-[#F5F5F7]"
                }`}
              >
                {SENTIMENT_LABEL[v]}
              </button>
            ))}
          </div>

          <label className="mb-1.5 block text-[12.5px] font-semibold text-[#6E6E73]">Finding</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="Author Year: result on the primary or secondary endpoint (study design)"
            className="w-full rounded-[12px] border border-[#E8E8ED] p-3 text-[14px] outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
          />

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
