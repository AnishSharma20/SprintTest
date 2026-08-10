"use client";

// Scientific Studies V2 — sidebar explorer for browsing, reading panel for the summary.
// Restyled 2026-08-10 to the "floating & focused" design the client picked from three
// mockups: calm near-white page, text-only sidebar with the red Superba benefit icons,
// floating white cards, status as words instead of badge pills. See app/v2/ui.tsx.
//
// Functionally equivalent to app/wiki.tsx (which is untouched, V1 keeps working): same study
// meta overlay, summary edit with write through, claims modal, category/quality reviewer tools.
// The duplication is deliberate — collapse it only if V2 is adopted as the replacement.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Studie } from "../wiki";
import type { Summary } from "../studies-data";
import { loadOverrides, saveOverride, type Override } from "../summary-overrides";
import CategoryManager from "../category-manager";
import DiagramsModal from "../v2/diagrams-modal";
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
  SideReviewer,
} from "../v2/ui";
import { benefitIcon } from "../v2/benefit-icons";

const REVIEWER_KEY = "claimsReviewerName:v1";
const STUDY_FIGURES = studyFiguresRaw as Record<string, unknown[]>;

const QUALITY_DEF =
  "Scientific quality = how rigorously the study was designed and run. A methodological score across 8 criteria " +
  "(randomization, blinding, allocation concealment, intention to treat analysis, dropout reporting, " +
  "etc.), rated High / Moderate / Low. It reflects how much to trust the study's methods, NOT whether the " +
  "result was positive. Shown for the verified key trials only.";

type SortBy = "date" | "quality";

/** The quality label as a calm colored word (no bars, no badges). */
function QualityWord({ s }: { s: Studie }) {
  const q = s.quality;
  if (!q) return <span className="text-[#AEAEB2]">Not yet scored</span>;
  const color =
    q.label === "High" ? "text-[#2E7D4F]" : q.label === "Moderate" ? "text-[#B4884A]" : "text-[#B3403A]";
  const title = s.qualityReviewer
    ? `Rated by ${s.qualityReviewer} on ${formatDate(s.qualityReviewedAt)}${
        s.qualityNote ? ` · ${s.qualityNote}` : ""
      }`
    : s.qualityNote ?? undefined;
  return (
    <span className="text-[#AEAEB2]" title={title}>
      Quality{" "}
      <b className={`font-semibold ${color}`}>
        {q.score}% {q.label}
      </b>
    </span>
  );
}

export default function WikiV2({ studier: grunnStudier }: { studier: Studie[] }) {
  const [sok, setSok] = useState("");
  const [valgtKategori, setValgtKategori] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("quality");
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
      const lbl = s.quality?.label;
      const treffKval =
        lbl === "High" ? qualHigh : lbl === "Moderate" ? qualModerate : qualLowUnscored;
      return treffSok && treffKat && treffKval;
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
  }, [studier, sok, valgtKategori, sortBy, qualHigh, qualModerate, qualLowUnscored]);

  const valgt = useMemo(
    () => (valgtPmid ? studier.find((s) => s.pmid === valgtPmid) ?? null : null),
    [studier, valgtPmid]
  );

  const kategoriNavn = valgtKategori
    ? kategorier.find((k) => k.id === valgtKategori)?.navn ?? "Studies"
    : "All studies";

  const sidebar = (
    <div className="pb-6">
      <SideSection title="Benefit areas">
        {kategorier.map((k) => (
          <SideItem
            key={k.id}
            active={valgtKategori === k.id}
            onClick={() => velgKategori(k.id)}
            count={k.antall}
            icon={benefitIcon(k.navn)}
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
            className="mt-2 py-[5px] text-left text-[13px] font-semibold text-[#0A7A8A] hover:underline"
          >
            Manage categories
          </button>
        )}
      </SideSection>
      <SideSection title="Quality">
        <div className="pl-1">
          <SideCheck checked={qualHigh} onChange={setQualHigh}>
            High quality
          </SideCheck>
          <SideCheck checked={qualModerate} onChange={setQualModerate}>
            Moderate
          </SideCheck>
          <SideCheck checked={qualLowUnscored} onChange={setQualLowUnscored}>
            Low or unscored
          </SideCheck>
        </div>
      </SideSection>
      <SideReviewer value={reviewer} onChange={onReviewerChange} hint="Recorded on approvals and quality scores." />
    </div>
  );

  return (
    <V2Shell sidebar={sidebar} panel={valgt ? panelFor(valgt) : null} onClosePanel={() => setValgtPmid(null)}>
      <div className="px-6 pb-16 pt-10 sm:px-10">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div>
            <h1 className="text-[28px] font-bold tracking-[-0.022em] text-[#1D1D1F] sm:text-[32px]">
              {valgtKategori ? kategoriNavn : "All studies"}
            </h1>
            <p className="mt-2 max-w-[540px] text-[15px] text-[#6E6E73]">
              Aker BioMarine affiliated research from PubMed, summarized in plain language.
            </p>
          </div>
          <div className="w-full sm:w-[300px]">
            <SearchBox value={sok} onChange={setSok} placeholder="Search studies" />
          </div>
        </div>

        {/* On small screens the sidebar is hidden, so the categories surface as pills here. */}
        <div className="mt-5 flex gap-2 overflow-x-auto pb-1 lg:hidden">
          {kategorier.map((k) => (
            <button
              key={k.id}
              onClick={() => velgKategori(k.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${
                valgtKategori === k.id ? "bg-[#1D1D1F] text-white" : "bg-[#EFEFF1] text-[#1D1D1F]"
              }`}
            >
              {k.navn} · {k.antall}
            </button>
          ))}
          <button
            onClick={() => velgKategori(null)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${
              valgtKategori === null ? "bg-[#1D1D1F] text-white" : "bg-[#EFEFF1] text-[#1D1D1F]"
            }`}
          >
            All · {studier.length}
          </button>
        </div>

        <div className="mt-7 flex items-baseline gap-6 border-b border-[#E8E8ED] pb-3.5 text-[13.5px] text-[#6E6E73]">
          <span>Sort by</span>
          <button
            onClick={() => setSortBy("quality")}
            className={`group relative -mb-[15px] pb-[13px] ${
              sortBy === "quality"
                ? "border-b-2 border-[#1D1D1F] font-semibold text-[#1D1D1F]"
                : "hover:text-[#1D1D1F]"
            }`}
          >
            Quality
            <span className="pointer-events-none absolute left-0 top-full z-20 mt-2 w-72 rounded-[10px] bg-[#1D1D1F] px-3.5 py-2.5 text-left text-[11.5px] font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
              {QUALITY_DEF}
            </span>
          </button>
          <button
            onClick={() => setSortBy("date")}
            className={`-mb-[15px] pb-[13px] ${
              sortBy === "date"
                ? "border-b-2 border-[#1D1D1F] font-semibold text-[#1D1D1F]"
                : "hover:text-[#1D1D1F]"
            }`}
          >
            Newest
          </button>
          <span className="ml-auto text-[12.5px] text-[#AEAEB2]">
            {filtrert.length} of {studier.length} studies
          </span>
        </div>

        {filtrert.length === 0 ? (
          <p className="mt-10 text-center text-[14px] text-[#AEAEB2]">
            {studier.length === 0
              ? "Couldn't load studies right now. Try reloading the page."
              : "No studies match your search and filters."}
          </p>
        ) : (
          <ul>
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

/* ---------- the study list row (floating card) ---------- */

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

  return (
    <li
      onClick={onOpen}
      className={`mt-4 flex cursor-pointer items-start gap-6 rounded-[20px] bg-white p-6 transition-shadow sm:p-7 ${
        selected
          ? "shadow-[0_0_0_2px_#1D1D1F,0_2px_10px_rgba(29,29,31,.05)]"
          : "shadow-[0_2px_10px_rgba(29,29,31,.05)] hover:shadow-[0_6px_24px_rgba(29,29,31,.1)]"
      }`}
    >
      <div className="hidden w-[64px] shrink-0 flex-col items-center rounded-[14px] bg-[#FBFBFD] py-2.5 sm:flex">
        <span className="text-[17px] font-bold tabular-nums text-[#1D1D1F]">{s.ar || "…"}</span>
        <span className="text-[10.5px] uppercase tracking-[0.05em] text-[#AEAEB2]">Study</span>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-[16.5px] font-semibold leading-[1.4] tracking-[-0.012em] text-[#1D1D1F]">
          {s.tittel}
        </h3>
        <p className="mt-1.5 text-[13.5px] text-[#6E6E73]">
          {s.forfattere}
          {s.flereForfattere && " et al."}
          {s.tidsskrift && (
            <>
              {" · "}
              <span className="text-[#AEAEB2]">{s.tidsskrift}</span>
            </>
          )}
          <span className="sm:hidden"> · {s.ar}</span>
        </p>
        {s.akerNote && <p className="mt-1 text-[12.5px] text-[#AEAEB2]">{s.akerNote}</p>}
        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          {edited ? (
            <span className="font-semibold text-[#0A7A8A]">✓ Verified · edited</span>
          ) : verified ? (
            <span className="font-semibold text-[#0A7A8A]">✓ Verified by science</span>
          ) : (
            <span className="text-[#AEAEB2]">
              AI summary, awaiting review{s.harFulltekst ? " · full text" : ""}
            </span>
          )}
          <QualityWord s={s} />
          <span className="flex-1" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className={`whitespace-nowrap rounded-full px-5 py-2 text-[13px] font-semibold transition-colors ${
              selected
                ? "bg-[#1D1D1F] text-white"
                : "text-[#1D1D1F] shadow-[inset_0_0_0_1px_#D9D9DE] hover:bg-[#F5F5F7]"
            }`}
          >
            Read summary
          </button>
        </div>
      </div>
    </li>
  );
}

/* ---------- the reading panel ---------- */

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
  const [diagramsOpen, setDiagramsOpen] = useState(false);
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
  const qTitle = s.qualityReviewer
    ? `Rated by ${s.qualityReviewer} on ${formatDate(s.qualityReviewedAt)}${
        s.qualityNote ? ` · ${s.qualityNote}` : ""
      }`
    : s.qualityNote ?? undefined;

  const crumbBits = [
    ...s.kategori,
    edited ? "Verified · edited" : verified ? "Verified by science" : "AI summary, awaiting review",
    ...(q ? [`${q.score}% ${q.label} quality`] : []),
    ...(s.dato ? [s.dato] : []),
  ];

  return (
    <div>
      <PanelHeader eyebrow="Plain language summary" onClose={onClose} title={s.tittel}>
        <p className="mt-2 text-[13px] text-[#6E6E73]">
          {s.forfattere}
          {s.flereForfattere && " et al."}
          {s.tidsskrift && <> · {s.tidsskrift}</>}
        </p>
        <p className="mt-1.5 text-[12px] text-[#AEAEB2]" title={qTitle}>
          {crumbBits.join(" · ")}
        </p>
        <div className="mt-4 flex flex-wrap items-baseline gap-5 text-[13.5px] font-semibold">
          {/* The original PDFs are not stored in the tool, so this resolves via the DOI to the
              publisher's page (where the PDF lives), falling back to the PubMed record. */}
          <a
            href={s.doiUrl ?? s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#0A7A8A] hover:underline"
          >
            Open study in PDF
          </a>
          {figures > 0 && (
            <span className="font-normal text-[#AEAEB2]">
              {figures} diagram{figures === 1 ? "" : "s"} from the paper
            </span>
          )}
        </div>
      </PanelHeader>

      <div className="px-7 py-6">
        {!summary ? (
          <p className="py-6 text-center text-[13.5px] text-[#AEAEB2]">
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
              <p className="mb-5 rounded-[12px] border border-[#F2E3BC] bg-[#FFF8E9] px-4 py-2.5 text-[12.5px] text-[#8A6A2B]">
                AI generated summary from the abstract. Not yet verified by a scientist.
              </p>
            )}
            <PanelSection label="Background" text={summary.background} />
            <PanelSection label="Design" text={summary.design} />
            <PanelSection label="Key findings" text={summary.findings} />
            <PanelSection label="Limitations" text={summary.limitations} />
            <div className="mt-7 flex flex-wrap gap-2.5">
              <button
                onClick={() => setDiagramsOpen(true)}
                className="rounded-[12px] bg-[#1D1D1F] px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#3A3A3C]"
              >
                View diagrams
              </button>
              <button
                onClick={() => setEditing(true)}
                className="rounded-[12px] bg-[#EFEFF1] px-5 py-2.5 text-[13.5px] font-semibold text-[#1D1D1F] transition-colors hover:bg-[#E4E4E7]"
              >
                Edit summary
              </button>
              {meta.editable && (
                <button
                  onClick={() => setToolsOpen((v) => !v)}
                  className="rounded-[12px] bg-[#EFEFF1] px-5 py-2.5 text-[13.5px] font-semibold text-[#1D1D1F] transition-colors hover:bg-[#E4E4E7]"
                >
                  Reviewer tools
                </button>
              )}
            </div>
          </>
        )}

        {/* A study with no summary still needs the reviewer entry point. */}
        {!summary && meta.editable && !toolsOpen && (
          <div className="mt-2 text-center">
            <button
              onClick={() => setToolsOpen(true)}
              className="rounded-[12px] bg-[#EFEFF1] px-5 py-2.5 text-[13.5px] font-semibold text-[#1D1D1F]"
            >
              Reviewer tools
            </button>
          </div>
        )}

        {meta.editable && toolsOpen && !editing && (
          <div className="mt-5 rounded-[16px] border border-[#E8E8ED] bg-[#FBFBFD] p-5">
            <h3 className="text-[14.5px] font-bold text-[#1D1D1F]">Reviewer tools</h3>
            <p className="mt-0.5 text-[12px] text-[#AEAEB2]">
              Every change is recorded with your name and the date.
              {s.qualityReviewer && (
                <> Quality rated by {s.qualityReviewer} on {formatDate(s.qualityReviewedAt)}.</>
              )}
            </p>
            <div className="mt-3">
              <ReviewerTools s={s} meta={meta} reviewer={reviewer} onMetaChanged={onMetaChanged} />
            </div>
          </div>
        )}
      </div>

      {diagramsOpen && <DiagramsModal pmid={s.pmid} title={s.tittel} onClose={() => setDiagramsOpen(false)} />}
    </div>
  );
}

function PanelSection({ label, text }: { label: string; text: string }) {
  return (
    <div className="mb-5">
      <div className="mb-1.5 text-[12.5px] font-semibold text-[#AEAEB2]">{label}</div>
      <p className="text-[14.5px] leading-[1.65] text-[#2C2C2E]">{text}</p>
    </div>
  );
}

/* ---------- reviewer tools (same behavior as V1's, calm styling) ---------- */

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
          className="rounded-[10px] border border-[#D9D9DE] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"
        >
          Categories
        </button>
        <button
          onClick={() => {
            setRedigererKvalitet((v) => !v);
            setRedigererKategorier(false);
            setMelding(null);
          }}
          className="rounded-[10px] border border-[#D9D9DE] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"
        >
          {s.quality ? "Quality" : "Add quality"}
        </button>
        <span className="text-[11.5px] text-[#AEAEB2]">
          {s.kategori.length ? s.kategori.join(", ") : "No category"}
          {s.quality ? ` · ${s.quality.score}% ${s.quality.label}` : " · no quality score"}
        </span>
      </div>

      {melding && (
        <p className="mb-2 rounded-[10px] bg-[#E9F4EC] px-3 py-2 text-[12px] font-semibold text-[#2E7D4F]">
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
    <div className="mb-3 mt-3">
      <div className="mb-2 text-[12.5px] font-semibold text-[#AEAEB2]">
        Benefit areas for this study · findings move with it
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {vitenskap.map((c) => {
          const on = valgte.has(c.id);
          return (
            <button
              key={c.id}
              onClick={() => veksle(c.id)}
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
      <p className="mt-2 text-[11.5px] text-[#AEAEB2]">
        Findings filed under an area you remove are re-filed under the area you add.
      </p>
      {feil && <p className="mt-2 text-[12px] font-semibold text-[#B3403A]">{feil}</p>}
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => void lagre()}
          disabled={busy}
          className="rounded-[10px] bg-[#1D1D1F] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#3A3A3C] disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save categories"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-[10px] border border-[#D9D9DE] bg-white px-4 py-2 text-[12.5px] font-semibold text-[#6E6E73] hover:bg-[#F5F5F7]"
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
    <div className="mb-3 mt-3">
      <div className="mb-2 text-[12.5px] font-semibold text-[#AEAEB2]">
        Scientific quality · how rigorously the study was designed and run
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[11.5px] font-semibold text-[#6E6E73]">
          Score, 0 to 100
          <input
            type="number"
            min={0}
            max={100}
            value={score}
            onChange={(e) => endreScore(e.target.value)}
            className="mt-1 block w-24 rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-2 text-[13.5px] font-normal outline-none focus:border-[#C7C7CC]"
          />
        </label>
        <label className="text-[11.5px] font-semibold text-[#6E6E73]">
          Rating
          <select
            value={label}
            onChange={(e) => {
              egenVurdering.current = true;
              setLabel(e.target.value as "High" | "Moderate" | "Low");
            }}
            className="mt-1 block rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-2 text-[13.5px] font-normal outline-none focus:border-[#C7C7CC]"
          >
            <option value="High">High</option>
            <option value="Moderate">Moderate</option>
            <option value="Low">Low</option>
          </select>
        </label>
        <label className="min-w-[10rem] flex-1 text-[11.5px] font-semibold text-[#6E6E73]">
          Note, optional
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What the score is based on"
            className="mt-1 block w-full rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-2 text-[13.5px] font-normal outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
          />
        </label>
      </div>
      <p className="mt-2 text-[11.5px] text-[#AEAEB2]">
        Saved as {reviewer || "…"} on {formatDate(new Date().toISOString())}. The name and date are
        stored with the score.
      </p>
      {feil && <p className="mt-2 text-[12px] font-semibold text-[#B3403A]">{feil}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => void lagre()}
          disabled={busy}
          className="rounded-[10px] bg-[#1D1D1F] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#3A3A3C] disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save quality"}
        </button>
        {s.qualityReviewer && (
          <button
            onClick={() => void fjern()}
            disabled={busy}
            className="rounded-[10px] border border-[#E6C9C9] bg-white px-4 py-2 text-[12.5px] font-semibold text-[#B3403A] hover:bg-[#FBF3F3] disabled:opacity-40"
          >
            Clear score
          </button>
        )}
        <button
          onClick={onCancel}
          className="rounded-[10px] border border-[#D9D9DE] bg-white px-4 py-2 text-[12.5px] font-semibold text-[#6E6E73] hover:bg-[#F5F5F7]"
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
      className="mt-1.5 min-h-[7rem] w-full resize-y overflow-hidden rounded-[12px] border border-[#E8E8ED] bg-white p-3.5 text-[14px] leading-relaxed text-[#2C2C2E] shadow-[0_1px_2px_rgba(29,29,31,.03)] outline-none focus:border-[#C7C7CC]"
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
    { key: "background", label: "Background" },
    { key: "design", label: "Design" },
    { key: "findings", label: "Key findings" },
    { key: "limitations", label: "Limitations" },
  ];
  return (
    <div>
      <p className="mb-4 rounded-[12px] border border-[#F2E3BC] bg-[#FFF8E9] px-4 py-2.5 text-[12.5px] text-[#8A6A2B]">
        You are editing this summary. Saving marks it as human reviewed and shares it with the whole team.
      </p>
      <div className="space-y-4">
        {fields.map((f) => (
          <div key={f.key}>
            <div className="text-[12.5px] font-semibold text-[#AEAEB2]">{f.label}</div>
            <AutoTextarea value={draft[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <button
          onClick={() => onSave(draft)}
          className="rounded-[12px] bg-[#1D1D1F] px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-[#3A3A3C]"
        >
          Save summary
        </button>
        <button
          onClick={onCancel}
          className="rounded-[12px] bg-[#EFEFF1] px-5 py-2.5 text-[13.5px] font-semibold text-[#1D1D1F] hover:bg-[#E4E4E7]"
        >
          Cancel
        </button>
        <span className="text-[11.5px] text-[#AEAEB2]">Saved to the shared library, visible to everyone.</span>
      </div>
    </div>
  );
}
