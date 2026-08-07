"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Summary, Quality } from "./studies-data";
import { loadOverrides, saveOverride, type Override } from "./summary-overrides";
import ClaimsModal from "./claims-panel";
import CategoryManager from "./category-manager";
import PageHero, { ReviewerField } from "./PageHero";
import {
  applyStudyMeta,
  formatDate,
  loadStudyMeta,
  suggestLabel,
  EMPTY_META,
  type StudyMeta,
} from "./study-meta";

const REVIEWER_KEY = "claimsReviewerName:v1";

export type Studie = {
  pmid: string;
  tittel: string;
  tidsskrift: string;
  dato: string;
  ar: string;
  forfattere: string;
  flereForfattere: boolean;
  kategori: string[]; // a study can belong to more than one of AKBM's benefit categories
  // The same categories as stable ids. Names can be renamed from the UI, so anything that has to
  // survive a rename (filtering, moving a study, matching a study to its findings) uses these.
  kategoriIds?: string[];
  url: string;
  doiUrl: string | null;
  summary?: Summary | null;
  verified?: boolean; // true = science-verified (whitepaper); false = AI-generated
  quality?: Quality | null;
  // Who set the quality score and when, for a score a reviewer entered (curated scores have none).
  qualityReviewer?: string | null;
  qualityReviewedAt?: string | null;
  qualityNote?: string | null;
  akerNote?: string | null;
  // true = AKBM supplied the paper as a PDF, so summaries/findings come from the FULL TEXT.
  // false = we only have the PubMed abstract for it.
  harFulltekst?: boolean;
};

const QUALITY_DEF =
  "Scientific quality = how rigorously the study was designed and run. A methodological score across 8 criteria " +
  "(randomization, blinding, allocation concealment, intention to treat analysis, dropout reporting, " +
  "etc.), rated High / Moderate / Low. It reflects how much to trust the study's methods, NOT whether the " +
  "result was positive. Shown for the verified key trials only.";

type SortBy = "date" | "quality";

export default function Wiki({ studier: grunnStudier }: { studier: Studie[] }) {
  const [sok, setSok] = useState("");
  // The selected category is held as an ID, so a rename never loses the selection.
  const [valgtKategori, setValgtKategori] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("date");
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [reviewer, setReviewer] = useState("");
  const [meta, setMeta] = useState<StudyMeta>(EMPTY_META);
  const [administrerer, setAdministrerer] = useState(false);

  const lastMeta = useCallback(async () => setMeta(await loadStudyMeta()), []);
  useEffect(() => {
    void lastMeta();
  }, [lastMeta]);

  // The study list as it stands after the reviewer edits (category names and membership,
  // scientific quality) are laid over the built in data.
  const studier = useMemo(() => applyStudyMeta(grunnStudier, meta), [grunnStudier, meta]);

  useEffect(() => {
    setReviewer(window.localStorage.getItem(REVIEWER_KEY) || "");
  }, []);
  const onReviewerChange = (v: string) => {
    setReviewer(v);
    try {
      window.localStorage.setItem(REVIEWER_KEY, v);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    let alive = true;
    loadOverrides().then((o) => {
      if (alive) setOverrides(o);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Categories with a study in them, biggest first — the order the filter chips are shown in.
  const kategorier = useMemo(() => {
    const navn = new Map(meta.categories.map((c) => [c.id, c.name]));
    const m = new Map<string, { navn: string; antall: number }>();
    studier.forEach((s) =>
      (s.kategoriIds ?? []).forEach((id, i) => {
        const e = m.get(id) ?? { navn: navn.get(id) ?? s.kategori[i] ?? id, antall: 0 };
        e.antall += 1;
        m.set(id, e);
      })
    );
    return [...m.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.antall - a.antall || a.navn.localeCompare(b.navn));
  }, [studier, meta.categories]);

  // The biggest category is the default view. It keeps following the biggest one until the user
  // picks a chip themselves, and a category that disappears (deleted, or emptied by a move) hands
  // the selection back to the biggest one rather than leaving an empty list on screen.
  const brukerHarValgt = useRef(false);
  useEffect(() => {
    if (kategorier.length === 0) return;
    const finnes = valgtKategori !== null && kategorier.some((k) => k.id === valgtKategori);
    if (!brukerHarValgt.current || (valgtKategori !== null && !finnes)) {
      setValgtKategori(kategorier[0].id);
    }
  }, [kategorier, valgtKategori]);

  const velgKategori = (id: string | null) => {
    brukerHarValgt.current = true;
    setValgtKategori(id);
  };

  const filtrert = useMemo(() => {
    const q = sok.toLowerCase().trim();
    const list = studier.filter((s) => {
      const treffSok =
        !q ||
        s.tittel.toLowerCase().includes(q) ||
        s.tidsskrift.toLowerCase().includes(q) ||
        s.forfattere.toLowerCase().includes(q);
      const treffKat = !valgtKategori || (s.kategoriIds ?? []).includes(valgtKategori);
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
      <PageHero
        eyebrow="Research Wiki"
        title="Aker BioMarine Research"
        actions={
          <ReviewerField
            value={reviewer}
            onChange={onReviewerChange}
            placeholder="Your name (recorded on approvals)"
          />
        }
      >
        Scientific studies affiliated with Aker BioMarine, pulled from PubMed and updated
        automatically, with plain language summaries, marked verified by science or generated by AI.
      </PageHero>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 grid grid-cols-3 gap-3">
          {[
            { tall: studier.length, tekst: "studies in the wiki" },
            { tall: kategorier.length, tekst: "topics" },
            { tall: "PubMed", tekst: "data source" },
          ].map((s) => (
            <div key={s.tekst} className="rounded-[4px] border border-[#D6E6EE] bg-white p-4 shadow-sm">
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
            className="w-full rounded-[4px] border border-[#D6E6EE] bg-white py-3 pl-11 pr-4 text-sm shadow-sm outline-none focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
          />
        </div>

        {/* Biggest category first, down to the smallest, with All last. */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {kategorier.map((k) => (
            <FilterKnapp key={k.id} aktiv={valgtKategori === k.id} onClick={() => velgKategori(k.id)}>
              {k.navn} ({k.antall})
            </FilterKnapp>
          ))}
          <FilterKnapp aktiv={valgtKategori === null} onClick={() => velgKategori(null)}>
            All ({studier.length})
          </FilterKnapp>
          {meta.configured && (
            <button
              onClick={() => setAdministrerer(true)}
              className="ml-auto rounded-[4px] border border-[#B7D9DE] bg-white px-3 py-1.5 text-xs font-semibold text-[#0A7A8A] transition-colors hover:bg-[#E1F4F3]"
            >
              ⚙ Manage categories
            </button>
          )}
        </div>

        {/* Sort control */}
        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Sort by</span>
          <FilterKnapp aktiv={sortBy === "date"} onClick={() => setSortBy("date")}>
            Newest
          </FilterKnapp>
          <button
            onClick={() => setSortBy("quality")}
            className={`group relative rounded-[4px] px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              sortBy === "quality"
                ? "bg-[#0A7A8A] text-white shadow-sm"
                : "bg-white text-zinc-600 ring-1 ring-[#D6E6EE] hover:bg-[#E1F4F3]"
            }`}
          >
            <span className="border-b border-dotted border-current">Scientific quality</span>
            <span aria-hidden> ⓘ</span>
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-72 -translate-x-1/2 rounded-[4px] bg-[#052A4E] px-3 py-2 text-left text-[11px] font-normal leading-relaxed normal-case tracking-normal text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
              {QUALITY_DEF}
            </span>
          </button>
        </div>

        <p className="mb-3 text-sm text-zinc-500">
          Showing {filtrert.length} of {studier.length} studies
        </p>

        {filtrert.length === 0 ? (
          <p className="rounded-[4px] border border-dashed border-[#C2D9E3] p-8 text-center text-zinc-400">
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
                reviewer={reviewer}
                meta={meta}
                onMetaChanged={lastMeta}
                override={overrides[s.pmid]}
                onSave={(summary) => {
                  const o = saveOverride(s.pmid, summary);
                  setOverrides((prev) => ({ ...prev, [s.pmid]: o }));
                }}
              />
            ))}
          </ul>
        )}

        {administrerer && (
          <CategoryManager
            reviewer={reviewer}
            onClose={() => setAdministrerer(false)}
            onChanged={lastMeta}
          />
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
  reviewer,
  meta,
  onMetaChanged,
  override,
  onSave,
}: {
  s: Studie;
  reviewer: string;
  meta: StudyMeta;
  onMetaChanged: () => Promise<void>;
  override?: Override;
  onSave: (summary: Summary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [claimsOpen, setClaimsOpen] = useState(false);

  const edited = !!override;
  const summary: Summary | null | undefined = override?.summary ?? s.summary;
  // An edited summary is human-reviewed → treat as verified.
  const verified = edited ? true : s.verified;

  const q = s.quality;
  const qColor =
    q?.label === "High" ? "bg-[#DFF3E4] text-[#1B7A3D]"
    : q?.label === "Moderate" ? "bg-[#FBEED6] text-[#8A5A0B]"
    : "bg-[#F3E0E0] text-[#9A2A2A]";
  // Who scored it and when, kept on the badge as a tooltip so the card face stays clean; the
  // same line is spelled out inside the summary, next to the control that changes it.
  const qTitle = s.qualityReviewer
    ? `Rated by ${s.qualityReviewer} on ${formatDate(s.qualityReviewedAt)}${
        s.qualityNote ? ` · ${s.qualityNote}` : ""
      }`
    : s.qualityNote ?? undefined;

  return (
    <li className="group rounded-[4px] border border-[#D6E6EE] bg-white p-5 shadow-sm transition-all hover:border-[#3FD0C9] hover:shadow-md">
      {/* The card face is read only: categories, quality and date. Changing any of them lives
          inside "Read summary", so the list stays scannable. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {s.kategori.map((k) => (
          <span key={k} className="rounded-[4px] bg-[#E1F4F3] px-2.5 py-0.5 text-xs font-semibold text-[#0A7A8A]">
            {k}
          </span>
        ))}
        {q && (
          <span className={`rounded-[4px] px-2.5 py-0.5 text-xs font-semibold ${qColor}`} title={qTitle}>
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
              className="inline-flex items-center gap-2 rounded-[4px] bg-[#0A7A8A] px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#086472]"
            >
              📖 {open ? "Hide summary" : "Read summary"}
              <span className="text-white/80">{open ? "▲" : "▼"}</span>
            </button>
            <VerifiedBadge verified={!!verified} edited={edited} />
          </div>

          {open && (
            <div className="mt-3 space-y-3 rounded-[4px] border-2 border-[#3FD0C9] bg-[#F4FBFC] p-4 text-sm">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#0A7A8A]">
                  Plain-language summary
                </div>
                {!editing && (
                  <button
                    onClick={() => setEditing(true)}
                    className="rounded-[4px] border border-[#B7D9DE] bg-white px-2.5 py-1 text-xs font-semibold text-[#0A7A8A] hover:bg-[#E1F4F3]"
                  >
                    ✎ Edit
                  </button>
                )}
              </div>

              {!verified && !editing && (
                <p className="rounded-[4px] bg-[#FBEED6] px-3 py-1.5 text-[11px] font-medium text-[#8A5A0B]">
                  ⚠︎ AI generated summary from the abstract. Not yet verified by a scientist.
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
                  <ReviewerTools s={s} meta={meta} reviewer={reviewer} onMetaChanged={onMetaChanged} />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* A study with no summary at all has nothing to open, so it keeps its own strip. */}
      {!summary && meta.editable && (
        <div className="mt-3 rounded-[4px] border border-[#D6E6EE] bg-[#F4FBFC] p-4 text-sm">
          <ReviewerTools s={s} meta={meta} reviewer={reviewer} onMetaChanged={onMetaChanged} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#0A7A8A] hover:underline">
          PubMed →
        </a>
        {s.doiUrl && (
          <a href={s.doiUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#0A7A8A] hover:underline">
            DOI →
          </a>
        )}
        <button
          onClick={() => setClaimsOpen(true)}
          className="ml-auto rounded-[4px] bg-[#E1F4F3] px-3 py-1 font-semibold text-[#0A7A8A] transition-colors hover:bg-[#0A7A8A] hover:text-white"
        >
          View evidence
        </button>
      </div>

      {claimsOpen && (
        <ClaimsModal s={s} reviewer={reviewer} onClose={() => setClaimsOpen(false)} />
      )}
    </li>
  );
}

/**
 * The reviewer controls for one study: which categories it belongs to, and its scientific
 * quality. They live INSIDE the opened summary rather than on the card face, so the list stays
 * clean and only the person actually reading a study is offered the edits.
 */
function ReviewerTools({
  s,
  meta,
  reviewer,
  onMetaChanged,
}: {
  s: Studie;
  meta: StudyMeta;
  reviewer: string;
  onMetaChanged: () => Promise<void>;
}) {
  const [redigererKategorier, setRedigererKategorier] = useState(false);
  const [redigererKvalitet, setRedigererKvalitet] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);

  if (!meta.editable) return null;

  async function etterEndring(tekst: string) {
    setMelding(tekst);
    setRedigererKategorier(false);
    setRedigererKvalitet(false);
    await onMetaChanged();
  }

  return (
    <div className="border-t border-[#C9E5E8] pt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[#0A7A8A]">
          Categories & quality
        </span>
        <button
          onClick={() => {
            setRedigererKategorier((v) => !v);
            setRedigererKvalitet(false);
            setMelding(null);
          }}
          className="rounded-[4px] border border-[#B7D9DE] bg-white px-2.5 py-1 text-xs font-semibold text-[#0A7A8A] hover:bg-[#E1F4F3]"
        >
          ✎ Categories
        </button>
        <button
          onClick={() => {
            setRedigererKvalitet((v) => !v);
            setRedigererKategorier(false);
            setMelding(null);
          }}
          className="rounded-[4px] border border-[#B7D9DE] bg-white px-2.5 py-1 text-xs font-semibold text-[#0A7A8A] hover:bg-[#E1F4F3]"
        >
          {s.quality ? "✎ Quality" : "＋ Add quality"}
        </button>
        <span className="text-[11px] text-zinc-500">
          {s.kategori.length ? s.kategori.join(", ") : "No category"}
          {s.quality ? ` · Quality ${s.quality.score}% ${s.quality.label}` : " · No quality score"}
        </span>
      </div>

      {s.qualityReviewer && (
        <p className="mb-2 text-[11px] text-zinc-400">
          Quality rated by {s.qualityReviewer} on {formatDate(s.qualityReviewedAt)}
          {s.qualityNote ? ` · ${s.qualityNote}` : ""}
        </p>
      )}

      {melding && (
        <p className="mb-2 rounded-[4px] bg-[#DFF3E4] px-3 py-1.5 text-[11px] font-semibold text-[#1B7A3D]">
          {melding}
        </p>
      )}

      {redigererKategorier && (
        <CategoryEditor
          s={s}
          meta={meta}
          reviewer={reviewer}
          onCancel={() => setRedigererKategorier(false)}
          onSaved={etterEndring}
        />
      )}

      {redigererKvalitet && (
        <QualityEditor
          s={s}
          reviewer={reviewer}
          onCancel={() => setRedigererKvalitet(false)}
          onSaved={etterEndring}
        />
      )}
    </div>
  );
}

/**
 * Move a study between categories. The findings that belong to this study follow it: the API
 * re-files any finding sitting in a category the study just left (see /api/study-categories).
 */
function CategoryEditor({
  s,
  meta,
  reviewer,
  onCancel,
  onSaved,
}: {
  s: Studie;
  meta: StudyMeta;
  reviewer: string;
  onCancel: () => void;
  onSaved: (melding: string) => Promise<void>;
}) {
  const [valgte, setValgte] = useState<Set<string>>(new Set(s.kategoriIds ?? []));
  const [busy, setBusy] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const vitenskap = meta.categories.filter((c) => c.parent === "science");

  function veksle(id: string) {
    setValgte((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function lagre() {
    if (valgte.size === 0) {
      setFeil("A study needs at least one category.");
      return;
    }
    setBusy(true);
    setFeil(null);
    try {
      const res = await fetch("/api/study-categories", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pmid: s.pmid,
          categoryIds: [...valgte],
          previousCategoryIds: s.kategoriIds ?? [],
          actor: reviewer,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeil(data.error || "Could not save the categories.");
        return;
      }
      await onSaved(
        data.movedFindings
          ? `Categories saved. ${data.movedFindings} findings moved to ${data.movedTo}.`
          : "Categories saved."
      );
    } catch (e) {
      setFeil((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 rounded-[4px] border border-[#B7D9DE] bg-white p-3">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#0A7A8A]">
        Categories for this study
      </div>
      <div className="mb-2 grid gap-1 sm:grid-cols-2">
        {vitenskap.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-[4px] px-1 py-0.5 hover:bg-white">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#0A7A8A]"
              checked={valgte.has(c.id)}
              onChange={() => veksle(c.id)}
            />
            <span className="text-[12px] text-zinc-700">{c.name}</span>
          </label>
        ))}
      </div>
      <p className="mb-2 text-[11px] text-zinc-500">
        Findings from this study move with it: anything filed under a category you remove is
        re-filed under the category you add.
      </p>
      {feil && <p className="mb-2 text-[11px] font-semibold text-[#9A2A2A]">{feil}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => void lagre()}
          disabled={busy}
          className="rounded-[4px] bg-[#1B7A3D] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#166433] disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save categories"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-[4px] border border-[#D6E6EE] bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Add or change a study's scientific quality. The reviewer's name is required and stored with the
 * date, so every score on the page is attributable to a person.
 */
function QualityEditor({
  s,
  reviewer,
  onCancel,
  onSaved,
}: {
  s: Studie;
  reviewer: string;
  onCancel: () => void;
  onSaved: (melding: string) => Promise<void>;
}) {
  const [score, setScore] = useState<string>(String(s.quality?.score ?? 75));
  const [label, setLabel] = useState<"High" | "Moderate" | "Low">(
    s.quality?.label ?? suggestLabel(s.quality?.score ?? 75)
  );
  const [note, setNote] = useState(s.qualityNote ?? "");
  const [busy, setBusy] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  // The rating follows the score until the reviewer sets one themselves.
  const egenVurdering = useRef(false);

  function endreScore(v: string) {
    setScore(v);
    const n = Number(v);
    if (!egenVurdering.current && Number.isFinite(n)) setLabel(suggestLabel(n));
  }

  async function lagre() {
    if (!reviewer.trim()) {
      setFeil("Add your name in the Reviewer field at the top of the page first.");
      return;
    }
    setBusy(true);
    setFeil(null);
    try {
      const res = await fetch("/api/study-quality", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pmid: s.pmid, score: Number(score), label, note, reviewer }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeil(data.error || "Could not save the score.");
        return;
      }
      await onSaved(`Quality saved as ${score}% ${label}.`);
    } catch (e) {
      setFeil((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function fjern() {
    if (!reviewer.trim()) {
      setFeil("Add your name in the Reviewer field at the top of the page first.");
      return;
    }
    setBusy(true);
    setFeil(null);
    try {
      const res = await fetch(
        `/api/study-quality?pmid=${encodeURIComponent(s.pmid)}&reviewer=${encodeURIComponent(reviewer)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) {
        setFeil(data.error || "Could not clear the score.");
        return;
      }
      await onSaved("Quality score cleared.");
    } catch (e) {
      setFeil((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 rounded-[4px] border border-[#B7D9DE] bg-white p-3">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#0A7A8A]">
        Scientific quality
      </div>
      <div className="mb-2 flex flex-wrap items-end gap-3">
        <label className="text-[11px] font-semibold text-zinc-600">
          Score (0 to 100)
          <input
            type="number"
            min={0}
            max={100}
            value={score}
            onChange={(e) => endreScore(e.target.value)}
            className="mt-1 block w-24 rounded-[4px] border border-[#B7D9DE] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#3FD0C9]"
          />
        </label>
        <label className="text-[11px] font-semibold text-zinc-600">
          Rating
          <select
            value={label}
            onChange={(e) => {
              egenVurdering.current = true;
              setLabel(e.target.value as "High" | "Moderate" | "Low");
            }}
            className="mt-1 block rounded-[4px] border border-[#B7D9DE] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#3FD0C9]"
          >
            <option value="High">High</option>
            <option value="Moderate">Moderate</option>
            <option value="Low">Low</option>
          </select>
        </label>
        <label className="min-w-[12rem] flex-1 text-[11px] font-semibold text-zinc-600">
          Note (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What the score is based on"
            className="mt-1 block w-full rounded-[4px] border border-[#B7D9DE] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#3FD0C9]"
          />
        </label>
      </div>
      <p className="mb-2 text-[11px] text-zinc-500">
        Saved as {reviewer || "…"} on {formatDate(new Date().toISOString())}. The name and date are
        stored with the score.
      </p>
      {feil && <p className="mb-2 text-[11px] font-semibold text-[#9A2A2A]">{feil}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void lagre()}
          disabled={busy}
          className="rounded-[4px] bg-[#1B7A3D] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#166433] disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save quality"}
        </button>
        {s.qualityReviewer && (
          <button
            onClick={() => void fjern()}
            disabled={busy}
            className="rounded-[4px] border border-[#E6C9C9] bg-white px-3 py-1.5 text-xs font-semibold text-[#9A2A2A] hover:bg-[#F9EFEF] disabled:opacity-40"
          >
            Clear score
          </button>
        )}
        <button
          onClick={onCancel}
          className="rounded-[4px] border border-[#D6E6EE] bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
        >
          Cancel
        </button>
      </div>
    </div>
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
      className="mt-1 min-h-[7rem] w-full resize-y overflow-hidden rounded-[4px] border border-[#B7D9DE] bg-white p-3 text-sm leading-relaxed text-zinc-700 outline-none focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
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
          className="rounded-[4px] bg-[#1B7A3D] px-4 py-2 text-sm font-bold text-white hover:bg-[#166433]"
        >
          Save summary
        </button>
        <button
          onClick={onCancel}
          className="rounded-[4px] border border-[#D6E6EE] bg-white px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
        >
          Cancel
        </button>
        <span className="text-[11px] text-zinc-400">Saved to the shared library (visible to everyone).</span>
      </div>
    </div>
  );
}

function VerifiedBadge({ verified, edited }: { verified: boolean; edited?: boolean }) {
  if (edited)
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#DFF3E4] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#1B7A3D]">
        ✓ Verified · edited by you
      </span>
    );
  return verified ? (
    <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#DFF3E4] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#1B7A3D]">
      ✓ Verified by science
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#EEE7D6] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#8A6A2B]">
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
      className={`rounded-[4px] px-3.5 py-1.5 text-xs font-semibold transition-colors ${
        aktiv
          ? "bg-[#0A7A8A] text-white shadow-sm"
          : "bg-white text-zinc-600 ring-1 ring-[#D6E6EE] hover:bg-[#E1F4F3]"
      }`}
    >
      {children}
    </button>
  );
}
