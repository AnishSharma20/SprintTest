"use client";

// The V2 "View diagrams" modal: ONLY the charts, tables and graphs extracted from the
// study's own PDF (public/study-figures/<pmid>/, manifest app/study-figures.json), with a
// lightbox and a download link — the same figure viewer the V1 evidence modal carries, but
// WITHOUT the findings review that surrounds it there (client decision 2026-08-10: the
// findings live on the Findings pages; the studies page only needs the visuals). Styled to
// the V2 pages' calm design.

/* eslint-disable @next/next/no-img-element -- local extracted figures, next/image adds nothing */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import studyFiguresRaw from "../study-figures.json";

type StudyFigure = { file: string; page: number; width: number; height: number; kind: string };
const STUDY_FIGURES = studyFiguresRaw as Record<string, StudyFigure[]>;

export default function DiagramsModal({
  pmid,
  title,
  onClose,
}: {
  pmid: string;
  title: string;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<StudyFigure | null>(null);
  const figures = STUDY_FIGURES[pmid] ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape closes the lightbox first, then the modal.
      setOpen((o) => {
        if (o) return null;
        onClose();
        return o;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-[#1D1D1F]/40 p-4 backdrop-blur-sm sm:p-8"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif" }}
      onClick={onClose}
    >
      <div
        className="my-4 w-full max-w-4xl overflow-hidden rounded-[20px] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-6 border-b border-[#E8E8ED] px-7 py-5">
          <div>
            <div className="text-[12px] font-semibold text-[#AEAEB2]">Diagrams from this study</div>
            <h2 className="mt-1 text-[16px] font-bold leading-snug tracking-[-0.01em] text-[#1D1D1F]">
              {title}
            </h2>
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
          {figures.length === 0 ? (
            <p className="py-8 text-center text-[13.5px] text-[#AEAEB2]">
              No charts or tables could be extracted for this study — that usually means we only
              have the abstract, not the full paper.
            </p>
          ) : (
            <>
              <p className="mb-4 text-[12.5px] text-[#AEAEB2]">
                {figures.length} chart{figures.length === 1 ? "" : "s"}, table
                {figures.length === 1 ? "" : "s"} and graph{figures.length === 1 ? "" : "s"} from
                the paper · tap to enlarge, download as PNG or JPG
              </p>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {figures.map((f) => (
                  <button
                    key={f.file}
                    onClick={() => setOpen(f)}
                    className="group overflow-hidden rounded-[14px] border border-[#E8E8ED] bg-white text-left transition-shadow hover:shadow-[0_4px_16px_rgba(29,29,31,.1)]"
                  >
                    <div className="flex h-32 items-center justify-center overflow-hidden bg-[#FBFBFD] p-3 sm:h-40">
                      <img
                        src={`/study-figures/${pmid}/${f.file}`}
                        alt={`${f.kind} from page ${f.page}`}
                        className="max-h-full max-w-full object-contain"
                        loading="lazy"
                      />
                    </div>
                    <div className="border-t border-[#F2F2F4] px-3.5 py-2.5 text-[12px] text-[#6E6E73]">
                      <b className="font-semibold capitalize text-[#1D1D1F]">{f.kind}</b> · page {f.page}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[#1D1D1F]/80 p-6 backdrop-blur-sm sm:p-10"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(null);
          }}
        >
          <div className="max-h-[92vh] w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-4">
              <span className="text-[12.5px] font-semibold capitalize text-white/80">
                {open.kind} · page {open.page}
              </span>
              <div className="flex gap-2">
                <a
                  href={`/study-figures/${pmid}/${open.file}`}
                  download={`study-${pmid}-p${open.page}.${open.file.split(".").pop()}`}
                  className="rounded-full bg-white px-4 py-1.5 text-[12.5px] font-semibold text-[#1D1D1F] hover:bg-[#EFEFF1]"
                >
                  Download {open.file.split(".").pop()?.toUpperCase()}
                </a>
                <button
                  onClick={() => setOpen(null)}
                  aria-label="Close"
                  className="rounded-full bg-white/15 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-white/25"
                >
                  Close ✕
                </button>
              </div>
            </div>
            <div className="max-h-[80vh] overflow-auto rounded-[16px] bg-white p-4">
              <img
                src={`/study-figures/${pmid}/${open.file}`}
                alt={`${open.kind} from page ${open.page}`}
                className="max-w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
