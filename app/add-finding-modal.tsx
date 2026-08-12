"use client";

// "Add finding" from a study's own card on the Scientific Studies page — writes one or more
// findings directly for THIS study, same repeatable-list structure as the findings section of
// "Add study" (app/add-study-modal.tsx). Posts each to /api/claims (scope: paper, claim_type:
// marketing), the same endpoint and validation the Findings Library uses, so it's still gated to
// studies in this library and still lands as pending_review for a reviewer to check.

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

type FindingDraft = { id: string; categoryId: string; text: string; sentiment: ClaimSentiment | "" };

function newFinding(): FindingDraft {
  return { id: crypto.randomUUID(), categoryId: "", text: "", sentiment: "" };
}

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
  const [findings, setFindings] = useState<FindingDraft[]>([newFinding()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scienceCategories = categories.filter((c) => c.parent === "science");

  function updateFinding(id: string, patch: Partial<FindingDraft>) {
    setFindings((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }
  function removeFinding(id: string) {
    setFindings((prev) => (prev.length > 1 ? prev.filter((f) => f.id !== id) : prev));
  }

  const toCreate = findings.filter((f) => f.text.trim());
  const canSubmit =
    toCreate.length > 0 && toCreate.every((f) => f.categoryId && f.sentiment && f.text.trim());

  async function submit() {
    if (toCreate.length === 0) {
      setError("Write at least one finding.");
      return;
    }
    for (const f of findings) {
      if (!f.text.trim()) continue; // an untouched row is skipped, not an error
      if (!f.categoryId || !f.sentiment) {
        setError("Every finding needs a category and a sentiment.");
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const studyRef = {
        pmid: study.pmid,
        title: study.tittel,
        authors: study.forfattere,
        year: study.ar ? parseInt(study.ar, 10) || null : null,
        journal: study.tidsskrift,
        doi: study.doiUrl ? study.doiUrl.replace("https://doi.org/", "") : null,
      };
      // Sequential, not Promise.all: the first request may be what registers this study in the
      // findings library's own studies table (if this is its first ever finding) — firing every
      // finding at once would race that insert and drop whichever request lost.
      let failed = 0;
      for (const f of toCreate) {
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
            study: studyRef,
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

        <div className="max-h-[76vh] overflow-y-auto px-7 py-6">
          <div className="mb-5 rounded-[12px] border border-[#E8E8ED] bg-[#FBFBFD] px-4 py-3 text-[12px] leading-relaxed text-[#6E6E73]">
            A finding restates what this study itself measured, never a consumer benefit. e.g.
            “Stonehouse 2022: Krill oil improved osteoarthritic knee pain in adults with mild to
            moderate knee osteoarthritis (6-month RCT, placebo-controlled)”.
          </div>

          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[12.5px] font-semibold text-[#6E6E73]">Findings</div>
            <button
              type="button"
              onClick={() => setFindings((prev) => [...prev, newFinding()])}
              className="text-[12.5px] font-semibold text-[#0A7A8A] hover:underline"
            >
              + Add finding
            </button>
          </div>
          <div className="space-y-3">
            {findings.map((f, i) => (
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
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <select
                    value={f.categoryId}
                    onChange={(e) => updateFinding(f.id, { categoryId: e.target.value })}
                    className="rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-1.5 text-[12.5px] outline-none focus:border-[#C7C7CC]"
                  >
                    <option value="">Category…</option>
                    {scienceCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {(["positive", "neutral", "negative"] as ClaimSentiment[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => updateFinding(f.id, { sentiment: v })}
                      className={`rounded-[10px] border px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
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
                <textarea
                  value={f.text}
                  onChange={(e) => updateFinding(f.id, { text: e.target.value })}
                  rows={2}
                  placeholder="Author Year: result on the primary or secondary endpoint (study design)"
                  className="w-full rounded-[10px] border border-[#E8E8ED] bg-white p-2.5 text-[13.5px] outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
                />
              </div>
            ))}
          </div>

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
