"use client";

// "Add study" — upload a study PDF the Scientific Studies page otherwise has no way to carry
// (no PMID, or AKBM never supplied it as part of the curated/full text library). Upload the PDF
// straight to Storage, extract its text plus its own verbatim abstract/year/authors (deck-service
// + Claude), then review/fill in the rest by hand — benefit areas, findings (same shape as the
// Findings Library), research quality, and marketing outcome. Saves to custom_studies (migration
// 0011) and, per finding entered, to claims (the same table the Findings Library reads).

import { useState } from "react";
import { createPortal } from "react-dom";
import type { Category, ClaimSentiment } from "./lib/claims-types";
import type { OutcomeDirection } from "./studies-data";
import { OUTCOME_LABEL, suggestLabel } from "./study-meta";
import { benefitIcon } from "./v2/benefit-icons";
import CategorySelect from "./category-select";

type Step = "upload" | "extracting" | "details";

const SENTIMENT_LABEL: Record<ClaimSentiment, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};

type FindingDraft = { id: string; categoryId: string; text: string; sentiment: ClaimSentiment | "" };

function newFinding(): FindingDraft {
  return { id: crypto.randomUUID(), categoryId: "", text: "", sentiment: "" };
}

export default function AddStudyModal({
  categories,
  onClose,
  onCreated,
}: {
  categories: Category[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [pdfFilename, setPdfFilename] = useState("");
  const [fullText, setFullText] = useState("");
  const [charsExtracted, setCharsExtracted] = useState(0);

  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [authorsAuto, setAuthorsAuto] = useState(false);
  const [year, setYear] = useState("");
  const [yearAuto, setYearAuto] = useState(false);
  const [abstract, setAbstract] = useState("");
  const [abstractVerified, setAbstractVerified] = useState(false);
  const [qualityScore, setQualityScore] = useState("");
  const qualityLabel = qualityScore.trim() ? suggestLabel(Number(qualityScore)) : "";
  const [outcomeDirection, setOutcomeDirection] = useState<OutcomeDirection | "">("");
  const [categoryIds, setCategoryIds] = useState<Set<string>>(new Set());
  const [findings, setFindings] = useState<FindingDraft[]>([newFinding()]);

  const scienceCategories = categories.filter((c) => c.parent === "science");

  function toggleCategory(id: string) {
    setCategoryIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function updateFinding(id: string, patch: Partial<FindingDraft>) {
    setFindings((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }
  function removeFinding(id: string) {
    setFindings((prev) => (prev.length > 1 ? prev.filter((f) => f.id !== id) : prev));
  }

  async function onPickFile(file: File) {
    if (file.type !== "application/pdf") {
      setError("Pick a PDF file.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const urlRes = await fetch("/api/custom-studies/upload-url", { method: "POST" });
      const urlData = await urlRes.json();
      if (!urlRes.ok) throw new Error(urlData.error || "Could not prepare the upload.");

      const put = await fetch(urlData.signedUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!put.ok) throw new Error("Could not upload the PDF.");

      setStoragePath(urlData.path);
      setPdfFilename(file.name);
      setStep("extracting");

      const extractRes = await fetch("/api/custom-studies/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_path: urlData.path, filename: file.name }),
      });
      const extractData = await extractRes.json();
      if (!extractRes.ok) throw new Error(extractData.error || "Could not read the PDF.");

      setFullText(extractData.full_text || "");
      setAbstract(extractData.abstract || "");
      setAbstractVerified(!!extractData.abstract_verified);
      setCharsExtracted(extractData.chars || 0);
      if (extractData.year) {
        setYear(extractData.year);
        setYearAuto(true);
      }
      if (extractData.authors) {
        setAuthors(extractData.authors);
        setAuthorsAuto(true);
      }
      setTitle((t) => t || file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "));
      setStep("details");
    } catch (e) {
      setError((e as Error).message);
      setStep("upload");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !!title.trim() && !!year.trim() && !!authors.trim() && categoryIds.size > 0 && !!storagePath;

  async function submit() {
    if (!title.trim()) return setError("Title is required.");
    if (!year.trim()) return setError("Year is required.");
    if (!authors.trim()) return setError("Authors are required.");
    if (categoryIds.size === 0) return setError("Pick at least one benefit area.");
    for (const f of findings) {
      if (!f.text.trim()) continue; // an untouched row is skipped, not an error
      if (!f.categoryId || !f.sentiment)
        return setError("Every finding needs a category and a sentiment.");
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/custom-studies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          authors: authors.trim(),
          year: year.trim(),
          storage_path: storagePath,
          pdf_filename: pdfFilename,
          full_text: fullText || null,
          abstract: abstract.trim() || null,
          quality_score: qualityScore.trim() ? Number(qualityScore) : null,
          quality_label: qualityLabel || null,
          outcome_direction: outcomeDirection || null,
          category_ids: [...categoryIds],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not save the study.");
        return;
      }

      const studyRef = {
        pmid: data.study.pmid || `custom-${data.study.id}`,
        title: data.study.title,
        authors: data.study.authors,
        year: data.study.year,
        journal: null as string | null,
        doi: null as string | null,
      };
      // Sequential, not Promise.all: this is the FIRST finding ever created for this brand new
      // study, so the first request's getOrCreateStudy() call is what inserts its row into the
      // findings library's own `studies` table (keyed by the synthetic pmid above). Firing every
      // finding at once raced two inserts for that same new pmid — the loser hit the table's
      // unique constraint and failed outright, even though the study itself had saved fine.
      const toCreate = findings.filter((f) => f.text.trim());
      const results: boolean[] = [];
      for (const f of toCreate) {
        const ok = await fetch("/api/claims", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: "paper",
            claim_type: "marketing",
            category_id: f.categoryId,
            text: f.text.trim(),
            sentiment: f.sentiment,
            study: studyRef,
          }),
        }).then((r) => r.ok);
        results.push(ok);
      }
      const failed = results.filter((ok) => !ok).length;
      if (failed > 0) {
        setError(`Study saved, but ${failed} of ${toCreate.length} finding(s) could not be added — add them from the study's card.`);
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
      onClick={step === "details" ? undefined : onClose}
    >
      <div
        className="my-6 w-full max-w-2xl overflow-hidden rounded-[20px] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E8E8ED] px-7 py-5">
          <div className="text-[15px] font-bold text-[#1D1D1F]">Add study</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-[6px] p-1.5 text-[#AEAEB2] hover:bg-[#F2F2F4] hover:text-[#6E6E73]"
          >
            <span className="text-xl leading-none">✕</span>
          </button>
        </div>

        <div className="max-h-[76vh] overflow-y-auto px-7 py-6">
          {step === "upload" && (
            <div className="rounded-[16px] border-2 border-dashed border-[#D9D9DE] p-10 text-center">
              <p className="text-[13.5px] text-[#6E6E73]">
                Upload a study PDF — for one AKBM hasn't supplied, or one with no PMID at all.
              </p>
              <label className="mt-4 inline-block cursor-pointer rounded-[12px] bg-[#1D1D1F] px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-[#3A3A3C]">
                {busy ? "Uploading…" : "Choose PDF"}
                <input
                  type="file"
                  accept="application/pdf"
                  disabled={busy}
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && void onPickFile(e.target.files[0])}
                />
              </label>
            </div>
          )}

          {step === "extracting" && (
            <div className="rounded-[16px] border border-[#E8E8ED] bg-[#FBFBFD] p-10 text-center">
              <p className="text-[13.5px] font-semibold text-[#1D1D1F]">Reading {pdfFilename}…</p>
              <p className="mt-1 text-[12.5px] text-[#AEAEB2]">
                Extracting the full text, abstract, year and authors. This can take a moment for a long paper.
              </p>
            </div>
          )}

          {step === "details" && (
            <>
              <p className="mb-5 rounded-[12px] border border-[#D8E9EA] bg-[#F4FAFB] px-4 py-2.5 text-[12px] text-[#0A5A66]">
                {pdfFilename} · {charsExtracted.toLocaleString()} characters extracted.
              </p>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-[11.5px] font-semibold text-[#6E6E73] sm:col-span-1">
                  Title
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="mt-1 block w-full rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-2 text-[13.5px] font-normal outline-none focus:border-[#C7C7CC]"
                  />
                </label>
                <label className="text-[11.5px] font-semibold text-[#6E6E73]">
                  Authors {authorsAuto && "· extracted from the PDF"}
                  <input
                    value={authors}
                    onChange={(e) => {
                      setAuthors(e.target.value);
                      setAuthorsAuto(false);
                    }}
                    placeholder="Smith J, Doe A, et al."
                    className="mt-1 block w-full rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-2 text-[13.5px] font-normal outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
                  />
                </label>
                <label className="text-[11.5px] font-semibold text-[#6E6E73]">
                  Year {yearAuto && "· extracted from the PDF"}
                  <input
                    value={year}
                    onChange={(e) => {
                      setYear(e.target.value);
                      setYearAuto(false);
                    }}
                    className="mt-1 block w-full rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-2 text-[13.5px] font-normal outline-none focus:border-[#C7C7CC]"
                  />
                </label>
              </div>

              <div className="mb-1.5 mt-4 text-[12.5px] font-semibold text-[#6E6E73]">Benefit areas</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {scienceCategories.map((c) => {
                  const on = categoryIds.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCategory(c.id)}
                      className={`flex items-center gap-2.5 rounded-[10px] border bg-white px-3 py-2 text-left text-[13px] transition-colors ${
                        on ? "border-[#1D1D1F] font-semibold text-[#1D1D1F]" : "border-[#E8E8ED] text-[#6E6E73]"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={benefitIcon(c.name)} alt="" className="h-5 w-5 shrink-0" />
                      <span className="flex-1">{c.name}</span>
                      {on && <span className="font-bold">✓</span>}
                    </button>
                  );
                })}
              </div>

              <label className="mb-1 mt-4 block text-[11.5px] font-semibold text-[#6E6E73]">
                Abstract
                {abstract && (abstractVerified ? " · the paper's own text" : " · could not verify this is word for word from the PDF, check it")}
              </label>
              <textarea
                value={abstract}
                onChange={(e) => setAbstract(e.target.value)}
                rows={4}
                placeholder="Paste the paper's own abstract if it wasn't found automatically"
                className="w-full rounded-[12px] border border-[#E8E8ED] p-3 text-[14px] outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
              />

              <div className="mb-1.5 mt-5 flex items-center justify-between">
                <div className="text-[12.5px] font-semibold text-[#6E6E73]">
                  Findings · same as the Findings Library
                </div>
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
                    <CategorySelect
                      value={f.categoryId}
                      onChange={(v) => updateFinding(f.id, { categoryId: v })}
                      categories={scienceCategories}
                      className="mb-2"
                    />
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
                      placeholder="Author Year: result on the primary or secondary endpoint (study design)"
                      className="w-full rounded-[10px] border border-[#E8E8ED] bg-white p-2.5 text-[13.5px] outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-5 text-[12.5px] font-semibold text-[#AEAEB2]">
                Research quality · how rigorously the study was designed and run
              </div>
              <div className="mt-1.5 flex flex-wrap items-end gap-3">
                <label className="text-[11.5px] font-semibold text-[#6E6E73]">
                  Score, 0 to 100
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={qualityScore}
                    onChange={(e) => setQualityScore(e.target.value)}
                    className="mt-1 block w-24 rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-2 text-[13.5px] font-normal outline-none focus:border-[#C7C7CC]"
                  />
                </label>
                {qualityLabel && (
                  <span
                    className={`mb-2 rounded-[10px] px-3 py-1.5 text-[13px] font-semibold ${
                      qualityLabel === "High"
                        ? "bg-[#E9F4EC] text-[#2E7D4F]"
                        : qualityLabel === "Moderate"
                        ? "bg-[#FFF8E9] text-[#8A6A2B]"
                        : "bg-[#FBF3F3] text-[#B3403A]"
                    }`}
                  >
                    {qualityLabel}
                  </span>
                )}
              </div>

              <div className="mt-4 text-[12.5px] font-semibold text-[#AEAEB2]">
                Outcome · is this study positive, neutral or negative for marketing purposes
              </div>
              <div className="mt-1.5 flex gap-2">
                {(["positive", "neutral", "negative"] as OutcomeDirection[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setOutcomeDirection(v)}
                    className={`rounded-[10px] border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                      outcomeDirection === v
                        ? v === "positive"
                          ? "border-[#2E7D4F] bg-[#E9F4EC] text-[#2E7D4F]"
                          : v === "negative"
                          ? "border-[#B3403A] bg-[#FBF3F3] text-[#B3403A]"
                          : "border-[#1D1D1F] bg-[#F4F4F5] text-[#1D1D1F]"
                        : "border-[#E8E8ED] text-[#6E6E73] hover:bg-[#F5F5F7]"
                    }`}
                  >
                    {OUTCOME_LABEL[v]}
                  </button>
                ))}
              </div>
            </>
          )}

          {error && <p className="mt-4 text-[12px] font-semibold text-[#B3403A]">{error}</p>}

          {step === "details" && (
            <div className="mt-5 flex gap-2.5">
              <button
                onClick={submit}
                disabled={busy || !canSubmit}
                className="rounded-[12px] bg-[#1D1D1F] px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-[#3A3A3C] disabled:opacity-40"
              >
                {busy ? "Saving…" : "Add study"}
              </button>
              <button
                onClick={onClose}
                className="rounded-[12px] bg-[#EFEFF1] px-5 py-2.5 text-[13.5px] font-semibold text-[#1D1D1F] hover:bg-[#E4E4E7]"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
