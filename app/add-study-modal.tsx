"use client";

// "Add study" — upload a study PDF the Scientific Studies page otherwise has no way to carry
// (no PMID, or AKBM never supplied it as part of the curated/full text library). Three steps:
// upload the PDF straight to Storage, extract its text + a drafted abstract (deck-service +
// Claude), then review/fill in the rest by hand — key findings assessment, research quality,
// outcome, and benefit areas. Saves to custom_studies (migration 0011), merged into the page's
// study list by app/studies.ts's hentStudier().

import { useState } from "react";
import { createPortal } from "react-dom";
import type { Category } from "./lib/claims-types";
import type { OutcomeDirection } from "./studies-data";
import { OUTCOME_LABEL } from "./study-meta";
import { useCurrentUser } from "./lib/use-current-user";

type Step = "upload" | "extracting" | "details";

export default function AddStudyModal({
  categories,
  onClose,
  onCreated,
}: {
  categories: Category[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { name: reviewer } = useCurrentUser();
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [storagePath, setStoragePath] = useState<string | null>(null);
  const [pdfFilename, setPdfFilename] = useState("");
  const [fullText, setFullText] = useState("");
  const [charsExtracted, setCharsExtracted] = useState(0);

  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState("");
  const [year, setYear] = useState("");
  const [journal, setJournal] = useState("");
  const [pmid, setPmid] = useState("");
  const [doi, setDoi] = useState("");
  const [abstract, setAbstract] = useState("");
  const [keyFindings, setKeyFindings] = useState("");
  const [qualityScore, setQualityScore] = useState("");
  const [qualityLabel, setQualityLabel] = useState<"High" | "Moderate" | "Low" | "">("");
  const [outcomeDirection, setOutcomeDirection] = useState<OutcomeDirection | "">("");
  const [categoryIds, setCategoryIds] = useState<Set<string>>(new Set());

  const scienceCategories = categories.filter((c) => c.parent === "science");

  function toggleCategory(id: string) {
    setCategoryIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
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
      setCharsExtracted(extractData.chars || 0);
      setTitle((t) => t || file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "));
      setStep("details");
    } catch (e) {
      setError((e as Error).message);
      setStep("upload");
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !!title.trim() && categoryIds.size > 0 && !!storagePath;

  async function submit() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (categoryIds.size === 0) {
      setError("Pick at least one benefit area.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/custom-studies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pmid: pmid.trim() || null,
          doi: doi.trim() || null,
          title: title.trim(),
          authors: authors.trim() || null,
          year: year.trim() || null,
          journal: journal.trim() || null,
          storage_path: storagePath,
          pdf_filename: pdfFilename,
          full_text: fullText || null,
          abstract: abstract.trim() || null,
          key_findings_assessment: keyFindings.trim() || null,
          quality_score: qualityScore.trim() ? Number(qualityScore) : null,
          quality_label: qualityLabel || null,
          outcome_direction: outcomeDirection || null,
          category_ids: [...categoryIds],
          created_by: reviewer,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not save the study.");
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
                Extracting the full text and drafting an abstract. This can take a moment for a long paper.
              </p>
            </div>
          )}

          {step === "details" && (
            <>
              <p className="mb-5 rounded-[12px] border border-[#D8E9EA] bg-[#F4FAFB] px-4 py-2.5 text-[12px] text-[#0A5A66]">
                {pdfFilename} · {charsExtracted.toLocaleString()} characters extracted.
                {!abstract && " No abstract could be drafted automatically — write one below."}
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-[11.5px] font-semibold text-[#6E6E73]">
                  Title
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="mt-1 block w-full rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-2 text-[13.5px] font-normal outline-none focus:border-[#C7C7CC]"
                  />
                </label>
                <label className="text-[11.5px] font-semibold text-[#6E6E73]">
                  Authors
                  <input
                    value={authors}
                    onChange={(e) => setAuthors(e.target.value)}
                    placeholder="Smith J, Doe A, et al."
                    className="mt-1 block w-full rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-2 text-[13.5px] font-normal outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
                  />
                </label>
                <label className="text-[11.5px] font-semibold text-[#6E6E73]">
                  Year
                  <input
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="mt-1 block w-full rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-2 text-[13.5px] font-normal outline-none focus:border-[#C7C7CC]"
                  />
                </label>
                <label className="text-[11.5px] font-semibold text-[#6E6E73]">
                  Journal
                  <input
                    value={journal}
                    onChange={(e) => setJournal(e.target.value)}
                    className="mt-1 block w-full rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-2 text-[13.5px] font-normal outline-none focus:border-[#C7C7CC]"
                  />
                </label>
                <label className="text-[11.5px] font-semibold text-[#6E6E73]">
                  PMID, optional
                  <input
                    value={pmid}
                    onChange={(e) => setPmid(e.target.value)}
                    placeholder="Leave blank if none"
                    className="mt-1 block w-full rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-2 text-[13.5px] font-normal outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
                  />
                </label>
                <label className="text-[11.5px] font-semibold text-[#6E6E73]">
                  DOI, optional
                  <input
                    value={doi}
                    onChange={(e) => setDoi(e.target.value)}
                    className="mt-1 block w-full rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-2 text-[13.5px] font-normal outline-none focus:border-[#C7C7CC]"
                  />
                </label>
              </div>

              <label className="mb-1 mt-4 block text-[11.5px] font-semibold text-[#6E6E73]">
                Abstract {abstract && "· drafted from the PDF, edit as needed"}
              </label>
              <textarea
                value={abstract}
                onChange={(e) => setAbstract(e.target.value)}
                rows={4}
                className="w-full rounded-[12px] border border-[#E8E8ED] p-3 text-[14px] outline-none focus:border-[#C7C7CC]"
              />

              <label className="mb-1 mt-4 block text-[11.5px] font-semibold text-[#6E6E73]">
                Key findings assessment
              </label>
              <textarea
                value={keyFindings}
                onChange={(e) => setKeyFindings(e.target.value)}
                rows={3}
                placeholder="Your own evaluation of what this study found and how much it supports"
                className="w-full rounded-[12px] border border-[#E8E8ED] p-3 text-[14px] outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
              />

              <div className="mt-4 text-[12.5px] font-semibold text-[#AEAEB2]">
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
                <label className="text-[11.5px] font-semibold text-[#6E6E73]">
                  Rating
                  <select
                    value={qualityLabel}
                    onChange={(e) => setQualityLabel(e.target.value as "High" | "Moderate" | "Low" | "")}
                    className="mt-1 block rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-2 text-[13.5px] font-normal outline-none focus:border-[#C7C7CC]"
                  >
                    <option value="">Not set</option>
                    <option value="High">High</option>
                    <option value="Moderate">Moderate</option>
                    <option value="Low">Low</option>
                  </select>
                </label>
              </div>

              <div className="mt-4 text-[12.5px] font-semibold text-[#AEAEB2]">
                Outcome · which way the study's own result pointed for krill oil
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

              <div className="mb-1.5 mt-4 text-[12.5px] font-semibold text-[#6E6E73]">Benefit areas</div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {scienceCategories.map((c) => {
                  const on = categoryIds.has(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCategory(c.id)}
                      className={`flex items-center justify-between rounded-[10px] border bg-white px-3 py-2 text-left text-[13px] transition-colors ${
                        on ? "border-[#1D1D1F] font-semibold text-[#1D1D1F]" : "border-[#E8E8ED] text-[#6E6E73]"
                      }`}
                    >
                      {c.name}
                      {on && <span className="font-bold">✓</span>}
                    </button>
                  );
                })}
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
