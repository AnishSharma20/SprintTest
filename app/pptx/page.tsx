"use client";

import { useState } from "react";

export default function PptxVerktoy() {
  const [fil, setFil] = useState<File | null>(null);
  const [instruks, setInstruks] = useState("");
  const [laster, setLaster] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [ferdig, setFerdig] = useState(false);

  async function generer() {
    if (!fil) return;
    setLaster(true);
    setFeil(null);
    setFerdig(false);

    try {
      const form = new FormData();
      form.append("fil", fil);
      form.append("instruks", instruks);

      const res = await fetch("/api/generer", { method: "POST", body: form });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.feil || "Ukjent feil");
      }

      // Last ned .pptx-filen
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "presentasjon.pptx";
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
    <div className="min-h-screen bg-[#F4F8FA]">
      <header className="bg-gradient-to-br from-[#002A4E] to-[#004A73] px-4 py-10">
        <div className="mx-auto max-w-2xl">
          <div className="text-sm font-semibold uppercase tracking-widest text-[#7FD4E6]">
            ⚡ Internt verktøy
          </div>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-white">
            Last opp → Claude lager PowerPoint
          </h1>
          <p className="mt-3 text-[#BFE3EF]">
            Last opp et dokument (.docx, .txt eller .md), skriv en kort instruks,
            og få en ferdig presentasjon i Aker BioMarine-stil.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8">
        {/* Filopplasting */}
        <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-[#9FC9D9] bg-white p-8 text-center transition-colors hover:border-[#00A9CE] hover:bg-[#E1F2F7]">
          <input
            type="file"
            accept=".docx,.txt,.md"
            className="hidden"
            onChange={(e) => setFil(e.target.files?.[0] ?? null)}
          />
          <div className="text-4xl">📄</div>
          <div className="mt-2 font-semibold text-[#002A4E]">
            {fil ? fil.name : "Klikk for å velge en fil"}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            .docx, .txt eller .md
          </div>
        </label>

        {/* Instruks */}
        <label className="mt-6 block text-sm font-semibold text-[#002A4E]">
          Instruks til Claude (valgfritt)
        </label>
        <textarea
          value={instruks}
          onChange={(e) => setInstruks(e.target.value)}
          rows={3}
          placeholder="F.eks. «Lag en kort pitch på 6 lysbilder for ledergruppen, fokus på resultater»"
          className="mt-2 w-full rounded-xl border border-[#D6E6EE] bg-white p-3 text-sm outline-none focus:border-[#00A9CE] focus:ring-2 focus:ring-[#00A9CE]/20"
        />

        {/* Knapp */}
        <button
          onClick={generer}
          disabled={!fil || laster}
          className="mt-6 w-full rounded-xl bg-[#00A9CE] py-4 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-[#0090b0] disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {laster ? "Claude lager presentasjonen…" : "Lag PowerPoint ✨"}
        </button>

        {/* Status */}
        {feil && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {feil}
          </div>
        )}
        {ferdig && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            ✅ Ferdig! Presentasjonen ble lastet ned. Sjekk nedlastingsmappa di.
          </div>
        )}

        <p className="mt-8 text-center text-xs text-zinc-400">
          Drevet av Claude · bygger ekte .pptx-filer
        </p>
      </main>
    </div>
  );
}
