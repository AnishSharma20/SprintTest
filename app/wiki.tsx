"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Summary, Quality } from "./studies-data";
import { loadOverrides, saveOverride, type Override } from "./summary-overrides";

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
  summary?: Summary | null;
  verified?: boolean; // true = science-verified (whitepaper); false = AI-generated
  quality?: Quality | null;
  akerNote?: string | null;
};

const QUALITY_DEF =
  "Scientific quality = how rigorously the study was designed and run — an 8-criterion methodological " +
  "score (randomization, blinding, allocation concealment, intention-to-treat analysis, dropout reporting, " +
  "etc.), rated High / Moderate / Low. It reflects how much to trust the study's methods, NOT whether the " +
  "result was positive. Shown for the verified key trials only.";

type SortBy = "date" | "quality";

export default function Wiki({ studier }: { studier: Studie[] }) {
  const [sok, setSok] = useState("");
  const [valgtKategori, setValgtKategori] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [overrides, setOverrides] = useState<Record<string, Override>>({});

  useEffect(() => setOverrides(loadOverrides()), []);

  const kategorier = useMemo(() => {
    const m = new Map<string, number>();
    studier.forEach((s) => m.set(s.kategori, (m.get(s.kategori) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [studier]);

  const filtrert = useMemo(() => {
    const q = sok.toLowerCase().trim();
    const list = studier.filter((s) => {
      const treffSok =
        !q ||
        s.tittel.toLowerCase().includes(q) ||
        s.tidsskrift.toLowerCase().includes(q) ||
        s.forfattere.toLowerCase().includes(q);
      const treffKat = !valgtKategori || s.kategori === valgtKategori;
      return treffSok && treffKat;
    });
    return list.sort((a, b) => {
      if (sortBy === "quality") {
        const qa = a.quality?.score ?? -1;
        const qb = b.quality?.score ?? -1;
        if (qb !== qa) return qb - qa; // High → Low; scored studies first
        return (b.ar || "").localeCompare(a.ar || "");
      }
      return (b.ar || "").localeCompare(a.ar || ""); // newest first
    });
  }, [studier, sok, valgtKategori, sortBy]);

  return (
    <div className="min-h-screen bg-[#F2F7F9]">
      <header className="bg-gradient-to-br from-[#031B34] via-[#052A4E] to-[#06456B] px-4 pb-12 pt-8">
        <div className="mx-auto max-w-4xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7FD4E6]">
            Research Wiki
          </div>
          <h1 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
            Aker BioMarine Research
          </h1>
          <p className="mt-3 max-w-2xl text-[#BFE3EF]">
            Scientific studies affiliated with Aker BioMarine, pulled from PubMed and updated
            automatically — with plain-language summaries, marked verified by science or AI-generated.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 grid grid-cols-3 gap-3">
          {[
            { tall: studier.length, tekst: "studies in the wiki" },
            { tall: kategorier.length, tekst: "topics" },
            { tall: "PubMed", tekst: "data source" },
          ].map((s) => (
            <div key={s.tekst} className="rounded-2xl border border-[#D6E6EE] bg-white p-4 shadow-sm">
              <div className="text-2xl font-extrabold text-[#0A7A8A]">{s.tall}</div>
              <div className="text-xs text-zinc-500">{s.tekst}</div>
            </div>
          ))}
        </div>

        <div className="relative mb-4">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400">🔍</span>
          <input
            type="text"
            value={sok}
            onChange={(e) => setSok(e.target.value)}
            placeholder="Search titles, journals or authors…"
            className="w-full rounded-xl border border-[#D6E6EE] bg-white py-3 pl-11 pr-4 text-sm shadow-sm outline-none focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
          />
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <FilterKnapp aktiv={valgtKategori === null} onClick={() => setValgtKategori(null)}>
            All ({studier.length})
          </FilterKnapp>
          {kategorier.map(([navn, antall]) => (
            <FilterKnapp key={navn} aktiv={valgtKategori === navn} onClick={() => setValgtKategori(navn)}>
              {navn} ({antall})
            </FilterKnapp>
          ))}
        </div>

        {/* Sort control */}
        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Sort by</span>
          <FilterKnapp aktiv={sortBy === "date"} onClick={() => setSortBy("date")}>
            Newest
          </FilterKnapp>
          <button
            onClick={() => setSortBy("quality")}
            className={`group relative rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              sortBy === "quality"
                ? "bg-[#0A7A8A] text-white shadow-sm"
                : "bg-white text-zinc-600 ring-1 ring-[#D6E6EE] hover:bg-[#E1F4F3]"
            }`}
          >
            <span className="border-b border-dotted border-current">Scientific quality</span>
            <span aria-hidden> ⓘ</span>
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-72 -translate-x-1/2 rounded-lg bg-[#052A4E] px-3 py-2 text-left text-[11px] font-normal leading-relaxed normal-case tracking-normal text-white opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100">
              {QUALITY_DEF}
            </span>
          </button>
        </div>

        <p className="mb-3 text-sm text-zinc-500">
          Showing {filtrert.length} of {studier.length} studies
        </p>

        {filtrert.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#C2D9E3] p-8 text-center text-zinc-400">
            {studier.length === 0
              ? "Couldn't load studies right now. Try reloading the page."
              : "No studies match your search."}
          </p>
        ) : (
          <ul className="space-y-3">
            {filtrert.map((s) => (
              <StudyCard
                key={s.pmid}
                s={s}
                override={overrides[s.pmid]}
                onSave={(summary) => {
                  const o = saveOverride(s.pmid, summary);
                  setOverrides((prev) => ({ ...prev, [s.pmid]: o }));
                }}
              />
            ))}
          </ul>
        )}

        <footer className="mt-12 border-t border-[#D6E6EE] pt-6 text-center text-xs text-zinc-400">
          Source: PubMed / NCBI · “Aker BioMarine”[Affiliation] + curated key trials · updated daily
        </footer>
      </main>
    </div>
  );
}

function StudyCard({
  s,
  override,
  onSave,
}: {
  s: Studie;
  override?: Override;
  onSave: (summary: Summary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const edited = !!override;
  const summary: Summary | null | undefined = override?.summary ?? s.summary;
  // An edited summary is human-reviewed → treat as verified.
  const verified = edited ? true : s.verified;

  const q = s.quality;
  const qColor =
    q?.label === "High" ? "bg-[#DFF3E4] text-[#1B7A3D]"
    : q?.label === "Moderate" ? "bg-[#FBEED6] text-[#8A5A0B]"
    : "bg-[#F3E0E0] text-[#9A2A2A]";

  return (
    <li className="group rounded-2xl border border-[#D6E6EE] bg-white p-5 shadow-sm transition-all hover:border-[#3FD0C9] hover:shadow-md">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[#E1F4F3] px-2.5 py-0.5 text-xs font-semibold text-[#0A7A8A]">
          {s.kategori}
        </span>
        {q && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${qColor}`}>
            Quality {q.score}% · {q.label}
          </span>
        )}
        <span className="text-xs text-zinc-400">{s.dato}</span>
      </div>
      <a
        href={s.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold leading-snug text-[#052A4E] group-hover:text-[#0A7A8A] hover:underline"
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
      {s.akerNote && <p className="mt-1 text-xs text-zinc-400">{s.akerNote}</p>}

      {summary && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0A7A8A] px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#086472]"
            >
              📖 {open ? "Hide summary" : "Read summary"}
              <span className="text-white/80">{open ? "▲" : "▼"}</span>
            </button>
            <VerifiedBadge verified={!!verified} edited={edited} />
          </div>

          {open && (
            <div className="mt-3 space-y-3 rounded-xl border-2 border-[#3FD0C9] bg-[#F4FBFC] p-4 text-sm shadow-inner">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#0A7A8A]">
                  Plain-language summary
                </div>
                {!editing && (
                  <button
                    onClick={() => setEditing(true)}
                    className="rounded-md border border-[#B7D9DE] bg-white px-2.5 py-1 text-xs font-semibold text-[#0A7A8A] hover:bg-[#E1F4F3]"
                  >
                    ✎ Edit
                  </button>
                )}
              </div>

              {!verified && !editing && (
                <p className="rounded-md bg-[#FBEED6] px-3 py-1.5 text-[11px] font-medium text-[#8A5A0B]">
                  ⚠︎ AI-generated summary from the abstract — not yet verified by a scientist.
                </p>
              )}

              {editing ? (
                <SummaryEditor
                  initial={summary}
                  onCancel={() => setEditing(false)}
                  onSave={(next) => {
                    onSave(next);
                    setEditing(false);
                  }}
                />
              ) : (
                <>
                  <SummarySection label="Background & rationale" text={summary.background} />
                  <SummarySection label="Design & participants" text={summary.design} />
                  <SummarySection label="Key findings" text={summary.findings} />
                  <SummarySection label="Limitations & quality" text={summary.limitations} />
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex gap-3 text-xs">
        <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#0A7A8A] hover:underline">
          PubMed →
        </a>
        {s.doiUrl && (
          <a href={s.doiUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#0A7A8A] hover:underline">
            DOI →
          </a>
        )}
      </div>
    </li>
  );
}

// Textarea that grows to fit its content (no scrolling inside the box), with a generous minimum.
function AutoTextarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const grow = () => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
    }
  };
  useEffect(grow, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onInput={grow}
      className="mt-1 min-h-[7rem] w-full resize-y overflow-hidden rounded-lg border border-[#B7D9DE] bg-white p-3 text-sm leading-relaxed text-zinc-700 outline-none focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
    />
  );
}

function SummaryEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: Summary;
  onSave: (s: Summary) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Summary>(initial);
  const fields: { key: keyof Summary; label: string }[] = [
    { key: "background", label: "Background & rationale" },
    { key: "design", label: "Design & participants" },
    { key: "findings", label: "Key findings" },
    { key: "limitations", label: "Limitations & quality" },
  ];
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <div key={f.key}>
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#0A7A8A]">{f.label}</div>
          <AutoTextarea
            value={draft[f.key]}
            onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
          />
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onSave(draft)}
          className="rounded-lg bg-[#1B7A3D] px-4 py-2 text-sm font-bold text-white hover:bg-[#166433]"
        >
          Save summary
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-[#D6E6EE] bg-white px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
        >
          Cancel
        </button>
        <span className="text-[11px] text-zinc-400">Saved in this browser only.</span>
      </div>
    </div>
  );
}

function VerifiedBadge({ verified, edited }: { verified: boolean; edited?: boolean }) {
  if (edited)
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#DFF3E4] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#1B7A3D]">
        ✓ Verified · edited by you
      </span>
    );
  return verified ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#DFF3E4] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#1B7A3D]">
      ✓ Verified by science
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#EEE7D6] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#8A6A2B]">
      AI · unverified
    </span>
  );
}

function SummarySection({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-[#0A7A8A]">{label}</div>
      <p className="mt-0.5 leading-relaxed text-zinc-700">{text}</p>
    </div>
  );
}

function FilterKnapp({
  aktiv,
  onClick,
  children,
}: {
  aktiv: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
        aktiv
          ? "bg-[#0A7A8A] text-white shadow-sm"
          : "bg-white text-zinc-600 ring-1 ring-[#D6E6EE] hover:bg-[#E1F4F3]"
      }`}
    >
      {children}
    </button>
  );
}
