"use client";

import { useState } from "react";

export default function DeckGenerator() {
  const [filer, setFiler] = useState<File[]>([]);
  const [laster, setLaster] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [ferdig, setFerdig] = useState(false);

  function leggTilFiler(nye: FileList | null) {
    if (!nye) return;
    setFiler((f) => [...f, ...Array.from(nye)]);
    setFerdig(false);
    setFeil(null);
  }

  function fjern(i: number) {
    setFiler((f) => f.filter((_, idx) => idx !== i));
  }

  async function generer() {
    if (filer.length === 0) return;
    setLaster(true);
    setFeil(null);
    setFerdig(false);

    try {
      const form = new FormData();
      filer.forEach((f) => form.append("filer", f));

      const res = await fetch("/api/generate-deck", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.feil || `Server svarte ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // Én fil → .pptx, flere → .zip (backend bestemmer content-type)
      const zip = blob.type.includes("zip");
      a.download = zip ? "superba-decks.zip" : "superba-deck.pptx";
      a.click();
      URL.revokeObjectURL(url);
      setFerdig(true);
    } catch (e) {
      setFeil((e as Error).message);
    } finally {
      setLaster(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F2F7F9]">
      <header className="bg-gradient-to-br from-[#031B34] via-[#052A4E] to-[#06456B] px-4 pb-12 pt-8">
        <div className="mx-auto max-w-3xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7FD4E6]">
            Deck Generator
          </div>
          <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Summaries → Superba deck
          </h1>
          <p className="mt-3 max-w-2xl text-[#BFE3EF]">
            Upload one or more science summaries. Claude turns each into
            structured, on-brand deck content and renders it onto the Superba
            template — ready to download as PowerPoint.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {/* Upload */}
        <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-[#9FC9D9] bg-white p-8 text-center transition-colors hover:border-[#3FD0C9] hover:bg-[#E1F4F3]">
          <input
            type="file"
            accept=".docx,.txt,.md"
            multiple
            className="hidden"
            onChange={(e) => leggTilFiler(e.target.files)}
          />
          <div className="text-4xl">📄</div>
          <div className="mt-2 font-semibold text-[#052A4E]">
            Click to add summary files
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            .docx, .txt or .md · you can add several
          </div>
        </label>

        {/* File list */}
        {filer.length > 0 && (
          <ul className="mt-4 space-y-2">
            {filer.map((f, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-xl border border-[#D6E6EE] bg-white px-4 py-2 text-sm"
              >
                <span className="truncate text-[#052A4E]">📎 {f.name}</span>
                <button
                  onClick={() => fjern(i)}
                  className="ml-3 shrink-0 text-xs font-medium text-zinc-400 hover:text-red-500"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-xs text-zinc-500">
          One deck is generated per summary. Multiple summaries download as a zip.
        </p>

        {/* Generate */}
        <button
          onClick={generer}
          disabled={filer.length === 0 || laster}
          className="mt-6 w-full rounded-xl bg-[#E30917] py-4 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-[#c40813] disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {laster ? "Claude is building your deck…" : "Generate deck"}
        </button>

        {/* Status */}
        {feil && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {feil}
          </div>
        )}
        {ferdig && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            ✅ Done! Your deck was downloaded — check your downloads folder.
          </div>
        )}

        <p className="mt-8 text-center text-xs text-zinc-400">
          Powered by Claude · rendered on the Superba brand template
        </p>
      </main>
    </div>
  );
}
