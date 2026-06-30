"use client";

import { useMemo, useState } from "react";

export type Studie = {
  pmid: string;
  tittel: string;
  tidsskrift: string;
  dato: string;
  ar: string;
  forfattere: string;
  flereForfattere: boolean;
  kategori: string;
  url: string;
  doiUrl: string | null;
};

export default function Wiki({ studier }: { studier: Studie[] }) {
  const [sok, setSok] = useState("");
  const [valgtKategori, setValgtKategori] = useState<string | null>(null);

  // Kategorier med antall
  const kategorier = useMemo(() => {
    const m = new Map<string, number>();
    studier.forEach((s) => m.set(s.kategori, (m.get(s.kategori) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [studier]);

  // Filtrert liste
  const filtrert = useMemo(() => {
    const q = sok.toLowerCase().trim();
    return studier.filter((s) => {
      const treffSok =
        !q ||
        s.tittel.toLowerCase().includes(q) ||
        s.tidsskrift.toLowerCase().includes(q) ||
        s.forfattere.toLowerCase().includes(q);
      const treffKat = !valgtKategori || s.kategori === valgtKategori;
      return treffSok && treffKat;
    });
  }, [studier, sok, valgtKategori]);

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-10">
      <main className="mx-auto max-w-3xl">
        <header className="mb-6">
          <div className="text-sm font-semibold uppercase tracking-widest text-indigo-500">
            📚 LLM Wiki
          </div>
          <h1 className="mt-1 text-4xl font-extrabold tracking-tight text-zinc-900">
            Krilloljeforskning
          </h1>
          <p className="mt-2 max-w-xl text-zinc-600">
            Et levende bibliotek over vitenskapelige studier på krillolje og
            omega-3 — forskningsfeltet til Aker BioMarine. Hentet direkte fra{" "}
            <span className="font-medium text-zinc-800">PubMed</span>, oppdateres
            automatisk.
          </p>
        </header>

        {/* Statistikk */}
        <div className="mb-6 flex gap-3">
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
            <div className="text-2xl font-extrabold text-indigo-600">
              {studier.length}
            </div>
            <div className="text-xs text-zinc-500">studier i wikien</div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
            <div className="text-2xl font-extrabold text-indigo-600">
              {kategorier.length}
            </div>
            <div className="text-xs text-zinc-500">temaer</div>
          </div>
        </div>

        {/* Søk */}
        <input
          type="text"
          value={sok}
          onChange={(e) => setSok(e.target.value)}
          placeholder="Søk i titler, tidsskrift eller forfattere…"
          className="mb-4 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />

        {/* Kategorifiltre */}
        <div className="mb-6 flex flex-wrap gap-2">
          <button
            onClick={() => setValgtKategori(null)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              valgtKategori === null
                ? "bg-indigo-600 text-white"
                : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-100"
            }`}
          >
            Alle ({studier.length})
          </button>
          {kategorier.map(([navn, antall]) => (
            <button
              key={navn}
              onClick={() => setValgtKategori(navn)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                valgtKategori === navn
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-100"
              }`}
            >
              {navn} ({antall})
            </button>
          ))}
        </div>

        {/* Treff-teller */}
        <p className="mb-3 text-sm text-zinc-500">
          Viser {filtrert.length} av {studier.length} studier
        </p>

        {/* Liste */}
        {filtrert.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-400">
            {studier.length === 0
              ? "Fikk ikke hentet studier akkurat nå. Prøv å laste siden på nytt."
              : "Ingen studier matcher søket."}
          </p>
        ) : (
          <ul className="space-y-3">
            {filtrert.map((s) => (
              <li
                key={s.pmid}
                className="rounded-xl border border-zinc-200 bg-white p-4 transition-shadow hover:shadow-sm"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                    {s.kategori}
                  </span>
                  <span className="text-xs text-zinc-400">{s.dato}</span>
                </div>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold leading-snug text-zinc-900 hover:text-indigo-600 hover:underline"
                >
                  {s.tittel}
                </a>
                <p className="mt-1 text-sm text-zinc-500">
                  {s.forfattere}
                  {s.flereForfattere && " et al."}
                  {s.tidsskrift && (
                    <>
                      {" · "}
                      <span className="italic">{s.tidsskrift}</span>
                    </>
                  )}
                </p>
                <div className="mt-2 flex gap-3 text-xs">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-indigo-600 hover:underline"
                  >
                    PubMed →
                  </a>
                  {s.doiUrl && (
                    <a
                      href={s.doiUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      DOI →
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <footer className="mt-10 text-center text-xs text-zinc-400">
          Kilde: PubMed / NCBI · søkeord «krill oil» · oppdateres daglig
        </footer>
      </main>
    </div>
  );
}
