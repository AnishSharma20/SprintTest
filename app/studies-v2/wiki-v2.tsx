"use client";

// Scientific Studies V2 — Concept A (sidebar explorer) for browsing, Concept B (reading panel)
// for the summary. The list stays scannable: opening a study never pushes the list around, the
// plain language summary lives in a panel on the right instead of an inline accordion.
//
// Functionally equivalent to app/wiki.tsx (which is untouched, V1 keeps working): same study
// meta overlay, summary edit with write through, claims modal, category/quality reviewer tools.
// The duplication is deliberate — collapse it only if V2 is adopted as the replacement.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Studie } from "../wiki";
import type { Summary } from "../studies-data";
import { loadOverrides, saveOverride, type Override } from "../summary-overrides";
import ClaimsModal from "../claims-panel";
import CategoryManager from "../category-manager";
import studyFiguresRaw from "../study-figures.json";
import {
  applyStudyMeta,
  formatDate,
  loadStudyMeta,
  suggestLabel,
  EMPTY_META,
  type StudyMeta,
} from "../study-meta";
import {
  V2Shell,
  SideSection,
  SideItem,
  SideCheck,
  SearchBox,
  PanelHeader,
  Pill,
  SideReviewer,
} from "../v2/ui";

const REVIEWER_KEY = "claimsReviewerName:v1";
const STUDY_FIGURES = studyFiguresRaw as Record<string, unknown[]>;

const QUALITY_DEF =
  "Scientific quality = how rigorously the study was designed and run. A methodological score across 8 criteria " +
  "(randomization, blinding, allocation concealment, intention to treat analysis, dropout reporting, " +
  "etc.), rated High / Moderate / Low. It reflects how much to trust the study's methods, NOT whether the " +
  "result was positive. Shown for the verified key trials only.";

type SortBy = "date" | "quality";

export default function WikiV2({ studier: grunnStudier }: { studier: Studie[] }) {
  const [sok, setSok] = useState("");
  const [valgtKategori, setValgtKategori] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("quality");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [fullTextOnly, setFullTextOnly] = useState(false);
  const [qualHigh, setQualHigh] = useState(true);
  const [qualModerate, setQualModerate] = useState(true);
  const [qualLowUnscored, setQualLowUnscored] = useState(true);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [reviewer, setReviewer] = useState("");
  const [meta, setMeta] = useState<StudyMeta>(EMPTY_META);
  const [administrerer, setAdministrerer] = useState(false);
  const [valgtPmid, setValgtPmid] = useState<string | null>(null);

  const lastMeta = useCallback(async () => setMeta(await loadStudyMeta()), []);
  useEffect(() => {
    void lastMeta();
  }, [lastMeta]);

  const studier = useMemo(() => applyStudyMeta(grunnStudier, meta), [grunnStudier, meta]);

  useEffect(() => {
    setReviewer(window.localStorage.getItem(REVIEWER_KEY) || "");
    // Deep link: /studies-v2?pmid=... opens that study's reading panel directly
    // (the Findings Library V2 evidence chain links here).
    const pmid = new URLSearchParams(window.location.search).get("pmid");
    if (pmid) setValgtPmid(pmid);
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

  // Categories with a study in them, biggest first — the sidebar order.
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

  // Same default-view rule as V1: the biggest category, until the user picks one themselves;
  // a category that disappears hands the selection back.
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
      const treffVer = !verifiedOnly || !!s.verified || !!overrides[s.pmid];
      const treffFt = !fullTextOnly || !!s.harFulltekst;
      const lbl = s.quality?.label;
      const treffKval =
        lbl === "High" ? qualHigh : lbl === "Moderate" ? qualModerate : qualLowUnscored;
      return treffSok && treffKat && treffVer && treffFt && treffKval;
    });
    return list.sort((a, b) => {
      if (sortBy === "quality") {
        const qa = a.quality?.score ?? -1;
        const qb = b.quality?.score ?? -1;
        if (qb !== qa) return qb - qa;
        return (b.ar || "").localeCompare(a.ar || "");
      }
      return (b.ar || "").localeCompare(a.ar || "");
    });
  }, [studier, sok, valgtKategori, sortBy, verifiedOnly, fullTextOnly, qualHigh, qualModerate, qualLowUnscored, overrides]);

  const valgt = useMemo(
    () => (valgtPmid ? studier.find((s) => s.pmid === valgtPmid) ?? null : null),
    [studier, valgtPmid]
  );

  const kategoriNavn = valgtKategori
    ? kategorier.find((k) => k.id === valgtKategori)?.navn ?? "Studies"
    : "All studies";

  const aktiveFiltre: string[] = [];
  if (verifiedOnly) aktiveFiltre.push("Verified");
  if (fullTextOnly) aktiveFiltre.push("Full text");
  if (!(qualHigh && qualModerate && qualLowUnscored)) {
    const on = [qualHigh && "High", qualModerate && "Moderate", qualLowUnscored && "Low or unscored"]
      .filter(Boolean)
      .join(" + ");
    aktiveFiltre.push(on || "no quality levels");
  }

  const sidebar = (
    <div className="pb-4">
      <div className="px-4 pt-5">
        <SearchBox value={sok} onChange={setSok} placeholder={`Search ${studier.length} studies…`} />
      </div>
      <SideSection title="Browse by benefit">
        {kategorier.map((k) => (
          <SideItem
            key={k.id}
            active={valgtKategori === k.id}
            onClick={() => velgKategori(k.id)}
            count={k.antall}
          >
            {k.navn}
          </SideItem>
        ))}
        <SideItem active={valgtKategori === null} onClick={() => velgKategori(null)} count={studier.length}>
          All studies
        </SideItem>
        {meta.configured && (
          <button
            onClick={() => setAdministrerer(true)}
            className="mt-1 w-full rounded-[6px] px-2.5 py-2 text-left text-[12px] font-bold text-[#0A7A8A] hover:bg-[#E1F4F3]"
          >
            ⚙ Manage categories
          </button>
        )}
      </SideSection>
      <SideSection title="Filter">
        <SideCheck checked={verifiedOnly} onChange={setVerifiedOnly}>
          Verified by science only
        </SideCheck>
        <SideCheck checked={fullTextOnly} onChange={setFullTextOnly}>
          Full text available
        </SideCheck>
      </SideSection>
      <SideSection title="Scientific quality">
        <SideCheck checked={qualHigh} onChange={setQualHigh}>
          <span className="inline-block h-2 w-2 rounded-full bg-[#1B7A3D]" /> High
        </SideCheck>
        <SideCheck checked={qualModerate} onChange={setQualModerate}>
          <span className="inline-block h-2 w-2 rounded-full bg-[#D9A21B]" /> Moderate
        </SideCheck>
        <SideCheck checked={qualLowUnscored} onChange={setQualLowUnscored}>
          <span className="inline-block h-2 w-2 rounded-full bg-[#9A2A2A]" /> Low or unscored
        </SideCheck>
      </SideSection>
      <SideReviewer value={reviewer} onChange={onReviewerChange} hint="Recorded on approvals and quality scores." />
    </div>
  );

  return (
    <V2Shell sidebar={sidebar} panel={valgt ? panelFor(valgt) : null} onClosePanel={() => setValgtPmid(null)}>
      <div className="px-5 py-6 sm:px-8">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#0A7A8A]">
          Research wiki · {kategoriNavn}
        </div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold text-[#052A4E]">
              {valgtKategori ? `${kategoriNavn} studies` : "All studies"}
            </h1>
            <p className="mt-1 max-w-xl text-[13px] text-zinc-500">
              Aker BioMarine affiliated research from PubMed, with plain language summaries reviewed
              by the science team.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[12px] text-zinc-500">
            Sort
            <div className="flex overflow-hidden rounded-[8px] border border-[#D6E6EE] bg-white">
              <button
                onClick={() => setSortBy("quality")}
                className={`group relative px-3.5 py-1.5 text-[12px] font-semibold ${
                  sortBy === "quality" ? "bg-[#0A7A8A] text-white" : "text-zinc-600 hover:bg-[#E1F4F3]"
                }`}
              >
                <span className="border-b border-dotted border-current">Quality</span>
                <span aria-hidden> ⓘ</span>
                <span className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-72 rounded-[6px] bg-[#052A4E] px-3 py-2 text-left text-[11px] font-normal leading-relaxed normal-case text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
                  {QUALITY_DEF}
                </span>
              </button>
              <button
                onClick={() => setSortBy("date")}
                className={`px-3.5 py-1.5 text-[12px] font-semibold ${
                  sortBy === "date" ? "bg-[#0A7A8A] text-white" : "text-zinc-600 hover:bg-[#E1F4F3]"
                }`}
              >
                Newest
              </button>
            </div>
          </div>
        </div>

        {/* On small screens the sidebar is hidden, so the categories surface as chips here. */}
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
          {kategorier.map((k) => (
            <button
              key={k.id}
              onClick={() => velgKategori(k.id)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                valgtKategori === k.id
                  ? "bg-[#0A7A8A] text-white"
                  : "bg-white text-zinc-600 ring-1 ring-[#D6E6EE]"
              }`}
            >
              {k.navn} ({k.antall})
            </button>
          ))}
          <button
            onClick={() => velgKategori(null)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold ${
              valgtKategori === null ? "bg-[#0A7A8A] text-white" : "bg-white text-zinc-600 ring-1 ring-[#D6E6EE]"
            }`}
          >
            All ({studier.length})
          </button>
        </div>

        <p className="mt-4 text-[12.5px] text-zinc-500">
          Showing {filtrert.length} of {studier.length} studies
          {aktiveFiltre.length > 0 && <> · filters: {aktiveFiltre.join(", ")}</>}
        </p>

        {filtrert.length === 0 ? (
          <p className="mt-4 rounded-[8px] border border-dashed border-[#C2D9E3] p-8 text-center text-zinc-400">
            {studier.length === 0
              ? "Couldn't load studies right now. Try reloading the page."
              : "No studies match your search and filters."}
          </p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {filtrert.map((s) => (
              <StudyRow
                key={s.pmid}
                s={s}
                edited={!!overrides[s.pmid]}
                selected={valgtPmid === s.pmid}
                onOpen={() => setValgtPmid(s.pmid)}
              />
            ))}
          </ul>
        )}
      </div>

      {administrerer && (
        <CategoryManager reviewer={reviewer} onClose={() => setAdministrerer(false)} onChanged={lastMeta} />
      )}
    </V2Shell>
  );

  function panelFor(s: Studie) {
    return (
      <StudyPanel
        s={s}
        reviewer={reviewer}
        meta={meta}
        onMetaChanged={lastMeta}
        override={overrides[s.pmid]}
        onSave={(summary) => {
          const o = saveOverride(s.pmid, summary);
          setOverrides((prev) => ({ ...prev, [s.pmid]: o }));
        }}
        onClose={() => setValgtPmid(null)}
      />
    );
  }
}

/* ---------- the study list row (Concept A card) ---------- */

function StudyRow({
  s,
  edited,
  selected,
  onOpen,
}: {
  s: Studie;
  edited: boolean;
  selected: boolean;
  onOpen: () => void;
}) {
  const verified = edited ? true : s.verified;
  const q = s.quality;
  const pct = q ? Math.max(0, Math.min(100, q.score)) : 0;
  const barColor =
    q?.label === "High"
      ? "linear-gradient(90deg,#0A7A8A,#3FD0C9)"
      : q?.label === "Moderate"
      ? "linear-gradient(90deg,#D9A21B,#E8C566)"
      : "linear-gradient(90deg,#9A2A2A,#C46A6A)";
  const qTitle = s.qualityReviewer
    ? `Rated by ${s.qualityReviewer} on ${formatDate(s.qualityReviewedAt)}${
        s.qualityNote ? ` · ${s.qualityNote}` : ""
      }`
    : s.qualityNote ?? undefined;

  return (
    <li
      onClick={onOpen}
      className={`grid cursor-pointer grid-cols-[52px_1fr] gap-4 rounded-[10px] border bg-white p-4 shadow-sm transition-all sm:grid-cols-[52px_1fr_150px] ${
        selected ? "border-[#0A7A8A] ring-1 ring-[#0A7A8A]" : "border-[#D6E6EE] hover:border-[#3FD0C9] hover:shadow-md"
      }`}
    >
      <div className="flex h-12 flex-col items-center justify-center rounded-[8px] border border-[#D6E6EE] bg-[#F4FBFC]">
        <span className="text-[14px] font-extrabold text-[#052A4E]">{s.ar || "…"}</span>
      </div>
      <div className="min-w-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="text-left text-[14px] font-bold leading-snug text-[#052A4E] hover:text-[#0A7A8A]"
        >
          {s.tittel}
        </button>
        <p className="mt-0.5 truncate text-[12px] text-zinc-500">
          {s.forfattere}
          {s.flereForfattere && " et al."}
          {s.tidsskrift && (
            <>
              {" · "}
              <span className="italic">{s.tidsskrift}</span>
            </>
          )}
        </p>
        {s.akerNote && <p className="mt-0.5 text-[11px] text-zinc-400">{s.akerNote}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {edited ? (
            <Pill tone="green">✓ Verified · edited</Pill>
          ) : verified ? (
            <Pill tone="green">✓ Verified by science</Pill>
          ) : (
            <Pill tone="amber">AI summary · unverified</Pill>
          )}
          {s.harFulltekst && <Pill tone="teal">Full text</Pill>}
          {s.kategori.map((k) => (
            <span key={k} className="text-[10.5px] font-semibold text-zinc-400">
              {k}
            </span>
          ))}
        </div>
      </div>
      <div className="col-span-2 flex items-center justify-between gap-4 sm:col-span-1 sm:flex-col sm:items-end sm:justify-center sm:gap-2">
        <div className="w-[130px]" title={qTitle}>
          <div className="mb-1 flex items-center justify-between text-[10.5px] text-zinc-500">
            <span>Quality</span>
            {q ? (
              <b className={q.label === "High" ? "text-[#1B7A3D]" : q.label === "Moderate" ? "text-[#8A5A0B]" : "text-[#9A2A2A]"}>
                {q.score}% {q.label}
              </b>
            ) : (
              <b className="font-semibold text-zinc-400">Not yet scored</b>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#E8F0F4]">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className={`rounded-[8px] px-4 py-2 text-[12px] font-bold transition-colors ${
            selected
              ? "bg-[#0A7A8A] text-white"
              : "border border-[#D6E6EE] bg-white text-[#0A7A8A] hover:bg-[#E1F4F3]"
          }`}
        >
          Read summary
        </button>
      </div>
    </li>
  );
}

/* ---------- the reading panel (Concept B) ---------- */

function StudyPanel({
  s,
  reviewer,
  meta,
  onMetaChanged,
  override,
  onSave,
  onClose,
}: {
  s: Studie;
  reviewer: string;
  meta: StudyMeta;
  onMetaChanged: () => Promise<void>;
  override?: Override;
  onSave: (summary: Summary) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [claimsOpen, setClaimsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  // Leaving a study closes any half-open edit state from the previous one.
  useEffect(() => {
    setEditing(false);
    setToolsOpen(false);
  }, [s.pmid]);

  const edited = !!override;
  const summary: Summary | null | undefined = override?.summary ?? s.summary;
  const verified = edited ? true : s.verified;
  const q = s.quality;
  const figures = STUDY_FIGURES[s.pmid]?.length ?? 0;
  const qTone = q?.label === "High" ? "green" : q?.label === "Moderate" ? "amber" : "red";
  const qTitle = s.qualityReviewer
    ? `Rated by ${s.qualityReviewer} on ${formatDate(s.qualityReviewedAt)}${
        s.qualityNote ? ` · ${s.qualityNote}` : ""
      }`
    : s.qualityNote ?? undefined;

  return (
    <div>
      <PanelHeader eyebrow="Plain language summary" onClose={onClose} title={s.tittel}>
        <p className="mt-1.5 text-[12.5px] text-zinc-500">
          {s.forfattere}
          {s.flereForfattere && " et al."}
          {s.tidsskrift && <> · {s.tidsskrift}</>}
          {s.dato && <> · {s.dato}</>}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {edited ? (
            <Pill tone="green">✓ Verified · edited</Pill>
          ) : verified ? (
            <Pill tone="green">✓ Verified by science</Pill>
          ) : (
            <Pill tone="amber">AI · unverified</Pill>
          )}
          {q && (
            <Pill tone={qTone as "green" | "amber" | "red"} title={qTitle}>
              Quality {q.score}% · {q.label}
            </Pill>
          )}
          {s.kategori.map((k) => (
            <Pill key={k} tone="teal">
              {k}
            </Pill>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-[12.5px] font-bold">
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[#0A7A8A] hover:underline">
            PubMed →
          </a>
          {s.doiUrl && (
            <a href={s.doiUrl} target="_blank" rel="noopener noreferrer" className="text-[#0A7A8A] hover:underline">
              DOI →
            </a>
          )}
          <button onClick={() => setClaimsOpen(true)} className="text-[#0A7A8A] hover:underline">
            Evidence{figures > 0 ? ` & figures (${figures})` : ""} →
          </button>
        </div>
      </PanelHeader>

      <div className="px-6 py-5">
        {!summary ? (
          <p className="rounded-[8px] border border-dashed border-[#C2D9E3] p-6 text-center text-[13px] text-zinc-400">
            No summary is available for this study yet.
          </p>
        ) : editing ? (
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
            {!verified && (
              <p className="mb-4 rounded-[6px] bg-[#FBEED6] px-3 py-2 text-[11.5px] font-medium text-[#8A5A0B]">
                ⚠︎ AI generated summary from the abstract. Not yet verified by a scientist.
              </p>
            )}
            <PanelSection label="Background & rationale" text={summary.background} />
            <PanelSection label="Design & participants" text={summary.design} />
            <PanelSection label="Key findings" text={summary.findings} />
            <PanelSection label="Limitations & quality" text={summary.limitations} />
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setClaimsOpen(true)}
                className="flex-1 rounded-[8px] bg-[#0A7A8A] px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-[#086472]"
              >
                View evidence & figures
              </button>
              <button
                onClick={() => setEditing(true)}
                className="flex-1 rounded-[8px] border border-[#D6E6EE] bg-white px-4 py-2.5 text-[13px] font-bold text-[#0A7A8A] transition-colors hover:bg-[#E1F4F3]"
              >
                ✎ Edit summary
              </button>
            </div>
          </>
        )}

        {meta.editable && !editing && (
          <div className="mt-4 rounded-[10px] border border-[#D6E6EE] bg-[#F2F7F9]">
            <button
              onClick={() => setToolsOpen((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-[12.5px] text-zinc-500">
                <b className="block text-[13px] text-[#052A4E]">Reviewer tools</b>
                Categories · scientific quality
                {s.qualityReviewer && (
                  <> · rated by {s.qualityReviewer} on {formatDate(s.qualityReviewedAt)}</>
                )}
              </span>
              <span className="text-[12px] font-bold text-[#0A7A8A]">{toolsOpen ? "Close ▴" : "Open ▾"}</span>
            </button>
            {toolsOpen && (
              <div className="border-t border-[#D6E6EE] px-4 py-3">
                <ReviewerTools s={s} meta={meta} reviewer={reviewer} onMetaChanged={onMetaChanged} />
              </div>
            )}
          </div>
        )}
      </div>

      {claimsOpen && <ClaimsModal s={s} reviewer={reviewer} onClose={() => setClaimsOpen(false)} />}
    </div>
  );
}

function PanelSection({ label, text }: { label: string; text: string }) {
  return (
    <div className="mb-4">
      <div className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-[#0A7A8A]">{label}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-zinc-700">{text}</p>
    </div>
  );
}

/* ---------- reviewer tools (same behavior as V1's, panel styled) ---------- */

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
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setRedigererKategorier((v) => !v);
            setRedigererKvalitet(false);
            setMelding(null);
          }}
          className="rounded-[6px] border border-[#B7D9DE] bg-white px-2.5 py-1 text-xs font-semibold text-[#0A7A8A] hover:bg-[#E1F4F3]"
        >
          ✎ Categories
        </button>
        <button
          onClick={() => {
            setRedigererKvalitet((v) => !v);
            setRedigererKategorier(false);
            setMelding(null);
          }}
          className="rounded-[6px] border border-[#B7D9DE] bg-white px-2.5 py-1 text-xs font-semibold text-[#0A7A8A] hover:bg-[#E1F4F3]"
        >
          {s.quality ? "✎ Quality" : "＋ Add quality"}
        </button>
        <span className="text-[11px] text-zinc-500">
          {s.kategori.length ? s.kategori.join(", ") : "No category"}
          {s.quality ? ` · Quality ${s.quality.score}% ${s.quality.label}` : " · No quality score"}
        </span>
      </div>

      {melding && (
        <p className="mb-2 rounded-[6px] bg-[#DFF3E4] px-3 py-1.5 text-[11px] font-semibold text-[#1B7A3D]">
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
    <div className="mb-3 rounded-[8px] border border-[#B7D9DE] bg-white p-3">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#0A7A8A]">
        Categories for this study
      </div>
      <div className="mb-2 grid gap-1 sm:grid-cols-2">
        {vitenskap.map((c) => (
          <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-[4px] px-1 py-0.5 hover:bg-[#F4FBFC]">
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
          className="rounded-[6px] bg-[#1B7A3D] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#166433] disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save categories"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-[6px] border border-[#D6E6EE] bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

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
  const egenVurdering = useRef(false);

  function endreScore(v: string) {
    setScore(v);
    const n = Number(v);
    if (!egenVurdering.current && Number.isFinite(n)) setLabel(suggestLabel(n));
  }

  async function lagre() {
    if (!reviewer.trim()) {
      setFeil("Add your name in the Reviewer field in the sidebar first.");
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
      setFeil("Add your name in the Reviewer field in the sidebar first.");
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
    <div className="mb-3 rounded-[8px] border border-[#B7D9DE] bg-white p-3">
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
            className="mt-1 block w-24 rounded-[6px] border border-[#B7D9DE] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#3FD0C9]"
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
            className="mt-1 block rounded-[6px] border border-[#B7D9DE] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#3FD0C9]"
          >
            <option value="High">High</option>
            <option value="Moderate">Moderate</option>
            <option value="Low">Low</option>
          </select>
        </label>
        <label className="min-w-[10rem] flex-1 text-[11px] font-semibold text-zinc-600">
          Note (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What the score is based on"
            className="mt-1 block w-full rounded-[6px] border border-[#B7D9DE] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#3FD0C9]"
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
          className="rounded-[6px] bg-[#1B7A3D] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#166433] disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save quality"}
        </button>
        {s.qualityReviewer && (
          <button
            onClick={() => void fjern()}
            disabled={busy}
            className="rounded-[6px] border border-[#E6C9C9] bg-white px-3 py-1.5 text-xs font-semibold text-[#9A2A2A] hover:bg-[#F9EFEF] disabled:opacity-40"
          >
            Clear score
          </button>
        )}
        <button
          onClick={onCancel}
          className="rounded-[6px] border border-[#D6E6EE] bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ---------- summary editor (same write-through as V1) ---------- */

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
      className="mt-1 min-h-[7rem] w-full resize-y overflow-hidden rounded-[6px] border border-[#B7D9DE] bg-white p-3 text-sm leading-relaxed text-zinc-700 outline-none focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
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
          <AutoTextarea value={draft[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onSave(draft)}
          className="rounded-[8px] bg-[#1B7A3D] px-4 py-2 text-sm font-bold text-white hover:bg-[#166433]"
        >
          Save summary
        </button>
        <button
          onClick={onCancel}
          className="rounded-[8px] border border-[#D6E6EE] bg-white px-4 py-2 text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
        >
          Cancel
        </button>
        <span className="text-[11px] text-zinc-400">Saved to the shared library (visible to everyone).</span>
      </div>
    </div>
  );
}
