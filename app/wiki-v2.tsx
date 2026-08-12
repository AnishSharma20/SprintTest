"use client";

// Scientific Studies — sidebar explorer for browsing, reading panel for the summary.
// Restyled 2026-08-10 to the "floating & focused" design the client picked from three
// mockups: calm near-white page, text-only sidebar with the red Superba benefit icons,
// floating white cards, status as words instead of badge pills. See app/v2/ui.tsx.
//
// "View diagrams" opens ONLY the charts/tables extracted from the study's PDF (app/v2/diagrams-
// modal.tsx); "Open study in PDF" links straight to the real paper (app/study-pdfs.json) when
// AKBM supplied one, falling back to its DOI/PubMed page; quality filtering is granular
// (High/Moderate/Low/Unscored + an "All scores" master toggle); the category/quality editor is
// labelled "Categorize & score".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Studie } from "./studies";
import type { Summary, OutcomeDirection } from "./studies-data";
import type { Category } from "./lib/claims-types";
import { loadOverrides, saveOverride, type Override } from "./summary-overrides";
import CategoryManager from "./category-manager";
import DiagramsModal from "./v2/diagrams-modal";
import studyPdfsRaw from "./study-pdfs.json";
import {
  applyStudyMeta,
  formatDate,
  loadStudyMeta,
  suggestLabel,
  EMPTY_META,
  OUTCOME_LABEL,
  type StudyMeta,
} from "./study-meta";
import {
  V2Shell,
  SideSection,
  SideItem,
  SideCheck,
  SearchBox,
  PanelHeader,
  SideReviewer,
  Pill,
} from "./v2/ui";
import { benefitIcon } from "./v2/benefit-icons";
import AddFindingModal from "./add-finding-modal";
import AddStudyModal from "./add-study-modal";
import { useCurrentUser } from "./lib/use-current-user";

const STUDY_PDFS = studyPdfsRaw as Record<string, { file: string; sizeKB: number }>;

/** The real paper's PDF when AKBM supplied it, else its DOI page, else its PubMed record. */
function studyPdfHref(s: Studie): string {
  if (s.customPdfUrl) return s.customPdfUrl; // the PDF this study was added with — always the real thing
  const local = STUDY_PDFS[s.pmid];
  return local ? `/study-pdfs/${local.file}` : s.doiUrl ?? s.url;
}

const QUALITY_DEF =
  "Research quality = how rigorously the study was designed and run. A methodological score across 8 " +
  "criteria (randomization, blinding, allocation concealment, intention to treat analysis, dropout " +
  "reporting, etc.), rated High / Moderate / Low. It reflects how much to trust the study's METHODS, " +
  "not which way its result pointed — see Outcome for that. A rigorous trial can still land on a null " +
  "or negative result (e.g. KARAOKE/Laslett 2024). Shown for the verified key trials only.";

const OUTCOME_DEF =
  "Outcome = which way the study's own result pointed for krill oil: positive (a benefit shown), " +
  "neutral (mixed or inconclusive) or negative (no significant effect, or unfavorable). Independent " +
  "of research quality above — a well run trial can still come out negative.";

type SortBy = "date" | "quality";

/** The research quality label as a calm colored word (no bars, no badges). */
function QualityWord({ s }: { s: Studie }) {
  const q = s.quality;
  if (!q) return <span className="font-semibold text-[#B4884A]">Not yet scored</span>;
  const color =
    q.label === "High" ? "text-[#2E7D4F]" : q.label === "Moderate" ? "text-[#B4884A]" : "text-[#B3403A]";
  const title = s.qualityReviewer
    ? `Rated by ${s.qualityReviewer} on ${formatDate(s.qualityReviewedAt)}${
        s.qualityNote ? ` · ${s.qualityNote}` : ""
      }`
    : s.qualityNote ?? undefined;
  return (
    <span className="text-[#AEAEB2]" title={title}>
      Research quality{" "}
      <b className={`font-semibold ${color}`}>
        {q.score}% {q.label}
      </b>
    </span>
  );
}

/** Which way the study's own result pointed — deliberately separate from QualityWord above so
 * the two are never read as one thing (see QUALITY_DEF/OUTCOME_DEF). */
function OutcomeWord({ s }: { s: Studie }) {
  const o = s.outcomeDirection;
  if (!o) return <span className="font-semibold text-[#AEAEB2]">Outcome not set</span>;
  const color = o === "positive" ? "text-[#2E7D4F]" : o === "negative" ? "text-[#B3403A]" : "text-[#B4884A]";
  return (
    <span className="text-[#AEAEB2]">
      Outcome <b className={`font-semibold ${color}`}>{OUTCOME_LABEL[o]}</b>
    </span>
  );
}

export default function WikiV2({ studier: grunnStudier }: { studier: Studie[] }) {
  const [sok, setSok] = useState("");
  const [valgtKategori, setValgtKategori] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("quality");
  const [qualHigh, setQualHigh] = useState(true);
  const [qualModerate, setQualModerate] = useState(true);
  const [qualLow, setQualLow] = useState(true);
  const [qualUnscored, setQualUnscored] = useState(true);
  const qualAll = qualHigh && qualModerate && qualLow && qualUnscored;
  const setQualAll = (v: boolean) => {
    setQualHigh(v);
    setQualModerate(v);
    setQualLow(v);
    setQualUnscored(v);
  };
  const [verVerified, setVerVerified] = useState(true);
  const [verUnverified, setVerUnverified] = useState(true);
  const verAll = verVerified && verUnverified;
  const setVerAll = (v: boolean) => {
    setVerVerified(v);
    setVerUnverified(v);
  };
  const [outPositive, setOutPositive] = useState(true);
  const [outNeutral, setOutNeutral] = useState(true);
  const [outNegative, setOutNegative] = useState(true);
  const [outUnset, setOutUnset] = useState(true);
  const outAll = outPositive && outNeutral && outNegative && outUnset;
  const setOutAll = (v: boolean) => {
    setOutPositive(v);
    setOutNeutral(v);
    setOutNegative(v);
    setOutUnset(v);
  };
  const [showRemoved, setShowRemoved] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const { name: reviewer } = useCurrentUser();
  const [meta, setMeta] = useState<StudyMeta>(EMPTY_META);
  const [administrerer, setAdministrerer] = useState(false);
  const [addingStudy, setAddingStudy] = useState(false);
  const router = useRouter();
  const [valgtPmid, setValgtPmid] = useState<string | null>(null);

  const lastMeta = useCallback(async () => setMeta(await loadStudyMeta()), []);
  useEffect(() => {
    void lastMeta();
  }, [lastMeta]);

  const studier = useMemo(() => applyStudyMeta(grunnStudier, meta), [grunnStudier, meta]);
  const removedCount = useMemo(() => studier.filter((s) => s.removed).length, [studier]);
  // Removed studies stay reachable (so a reviewer can restore one) but are excluded from the
  // default view, category counts and search — same treatment as "Turned off" layouts/photos
  // elsewhere in the app.
  const zichtbareStudier = useMemo(
    () => (showRemoved ? studier : studier.filter((s) => !s.removed)),
    [studier, showRemoved]
  );

  useEffect(() => {
    // Deep link: /?pmid=... opens that study's reading panel directly
    // (the Findings Library evidence chain links here).
    const pmid = new URLSearchParams(window.location.search).get("pmid");
    if (pmid) setValgtPmid(pmid);
  }, []);

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
    zichtbareStudier.forEach((s) =>
      (s.kategoriIds ?? []).forEach((id, i) => {
        const e = m.get(id) ?? { navn: navn.get(id) ?? s.kategori[i] ?? id, antall: 0 };
        e.antall += 1;
        m.set(id, e);
      })
    );
    return [...m.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.antall - a.antall || a.navn.localeCompare(b.navn));
  }, [zichtbareStudier, meta.categories]);

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
    const list = zichtbareStudier.filter((s) => {
      const treffSok =
        !q ||
        s.tittel.toLowerCase().includes(q) ||
        s.tidsskrift.toLowerCase().includes(q) ||
        s.forfattere.toLowerCase().includes(q);
      const treffKat = !valgtKategori || (s.kategoriIds ?? []).includes(valgtKategori);
      const lbl = s.quality?.label;
      const treffKval =
        lbl === "High" ? qualHigh : lbl === "Moderate" ? qualModerate : lbl === "Low" ? qualLow : qualUnscored;
      const erVerifisert = !!overrides[s.pmid] || s.verified;
      const treffVer = erVerifisert ? verVerified : verUnverified;
      const o = s.outcomeDirection;
      const treffUt = o === "positive" ? outPositive : o === "negative" ? outNegative : o === "neutral" ? outNeutral : outUnset;
      return treffSok && treffKat && treffKval && treffVer && treffUt;
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
  }, [
    zichtbareStudier,
    sok,
    valgtKategori,
    sortBy,
    qualHigh,
    qualModerate,
    qualLow,
    qualUnscored,
    verVerified,
    verUnverified,
    outPositive,
    outNeutral,
    outNegative,
    outUnset,
    overrides,
  ]);

  const valgt = useMemo(
    () => (valgtPmid ? studier.find((s) => s.pmid === valgtPmid) ?? null : null),
    [studier, valgtPmid]
  );

  const kategoriNavn = valgtKategori
    ? kategorier.find((k) => k.id === valgtKategori)?.navn ?? "Category"
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
        <SideItem active={valgtKategori === null} onClick={() => velgKategori(null)} count={zichtbareStudier.length}>
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
        <SideCheck checked={qualAll} onChange={setQualAll}>
          All scores
        </SideCheck>
        <div className="pl-1">
          <SideCheck checked={qualHigh} onChange={setQualHigh}>
            High quality
          </SideCheck>
          <SideCheck checked={qualModerate} onChange={setQualModerate}>
            Moderate
          </SideCheck>
          <SideCheck checked={qualLow} onChange={setQualLow}>
            Low
          </SideCheck>
          <SideCheck checked={qualUnscored} onChange={setQualUnscored}>
            Unscored
          </SideCheck>
        </div>
      </SideSection>
      <SideSection title="Verification">
        <SideCheck checked={verAll} onChange={setVerAll}>
          All studies
        </SideCheck>
        <div className="pl-1">
          <SideCheck checked={verVerified} onChange={setVerVerified}>
            Verified by science
          </SideCheck>
          <SideCheck checked={verUnverified} onChange={setVerUnverified}>
            Unverified AI summaries
          </SideCheck>
        </div>
      </SideSection>
      <SideSection title="Outcome">
        <SideCheck checked={outAll} onChange={setOutAll}>
          All outcomes
        </SideCheck>
        <div className="pl-1">
          <SideCheck checked={outPositive} onChange={setOutPositive}>
            Positive
          </SideCheck>
          <SideCheck checked={outNeutral} onChange={setOutNeutral}>
            Neutral
          </SideCheck>
          <SideCheck checked={outNegative} onChange={setOutNegative}>
            Negative
          </SideCheck>
          <SideCheck checked={outUnset} onChange={setOutUnset}>
            Not set
          </SideCheck>
        </div>
      </SideSection>
      {removedCount > 0 && (
        <SideSection title="Status">
          <SideCheck checked={showRemoved} onChange={setShowRemoved}>
            Show {removedCount} removed stud{removedCount === 1 ? "y" : "ies"}
          </SideCheck>
        </SideSection>
      )}
      <SideReviewer value={reviewer} hint="Recorded on approvals and quality scores." />
    </div>
  );

  return (
    <V2Shell sidebar={sidebar} panel={valgt ? panelFor(valgt) : null} onClosePanel={() => setValgtPmid(null)}>
      <div className="px-6 pb-16 pt-10 sm:px-10">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div>
            <h1 className="text-[28px] font-bold tracking-[-0.022em] text-[#1D1D1F] sm:text-[32px]">
              {valgtKategori ? `${kategoriNavn} Studies` : kategoriNavn}
            </h1>
            <p className="mt-2 max-w-[540px] text-[15px] text-[#6E6E73]">
              Aker BioMarine affiliated research from AKBM's internal Science Archive, summarized in plain language.
            </p>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-3 sm:w-[300px]">
            {meta.editableV2 && (
              <button
                onClick={() => setAddingStudy(true)}
                className="self-end rounded-full bg-[#1D1D1F] px-5 py-2.5 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#3A3A3C]"
              >
                + Add study
              </button>
            )}
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

      {addingStudy && (
        <AddStudyModal
          categories={meta.categories}
          onClose={() => setAddingStudy(false)}
          onCreated={() => {
            setAddingStudy(false);
            router.refresh();
          }}
        />
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
            <span className="font-semibold text-[#B4884A]">
              AI summary, awaiting review{s.harFulltekst ? " · full text" : ""}
            </span>
          )}
          <QualityWord s={s} />
          <OutcomeWord s={s} />
          {s.removed && <Pill tone="red">Removed</Pill>}
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
            View study
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
  const [addingFinding, setAddingFinding] = useState(false);

  // Leaving a study closes any half-open edit state from the previous one.
  useEffect(() => {
    setEditing(false);
    setToolsOpen(false);
    setAddingFinding(false);
  }, [s.pmid]);

  const edited = !!override;
  const summary: Summary | null | undefined = override?.summary ?? s.summary;
  const verified = edited ? true : s.verified;

  return (
    <div>
      <PanelHeader eyebrow="Plain language summary" onClose={onClose} title={s.tittel}>
        <p className="mt-2 text-[13px] text-[#6E6E73]">
          {s.forfattere}
          {s.flereForfattere && " et al."}
          {s.tidsskrift && <> · {s.tidsskrift}</>}
        </p>
        <a
          href={studyPdfHref(s)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-block text-[13.5px] font-semibold text-[#0A7A8A] hover:underline"
        >
          Open study in PDF
        </a>
      </PanelHeader>

      <div className="px-7 py-6">
        {/* Shown regardless of whether an AI/curated summary exists below — a study added
            through "Add study" never has one, only this. */}
        {(s.abstract || s.keyFindingsAssessment) && !editing && (
          <div className="mb-5 rounded-[14px] border border-[#D8E9EA] bg-[#F4FAFB] p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#0A7A8A]">
              Science team assessment
            </p>
            {s.abstract && <PanelSection label="Abstract" text={s.abstract} />}
            {s.keyFindingsAssessment && (
              <PanelSection label="Key findings assessment" text={s.keyFindingsAssessment} />
            )}
          </div>
        )}

        {!summary ? (
          <p className="py-6 text-center text-[13.5px] text-[#AEAEB2]">
            No AI or curated summary is available for this study.
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
          </>
        )}

        {!editing && (
          <div className="mt-7 flex flex-wrap gap-2.5">
            {summary && (
              <>
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
              </>
            )}
            {!s.removed && (
              <button
                onClick={() => setAddingFinding(true)}
                className="rounded-[12px] bg-[#EFEFF1] px-5 py-2.5 text-[13.5px] font-semibold text-[#1D1D1F] transition-colors hover:bg-[#E4E4E7]"
              >
                Add finding
              </button>
            )}
            {meta.editable && (
              <button
                onClick={() => setToolsOpen((v) => !v)}
                className="rounded-[12px] bg-[#EFEFF1] px-5 py-2.5 text-[13.5px] font-semibold text-[#1D1D1F] transition-colors hover:bg-[#E4E4E7]"
              >
                Categorize & score
              </button>
            )}
          </div>
        )}

        {meta.editable && toolsOpen && !editing && (
          <div className="mt-5 rounded-[16px] border border-[#E8E8ED] bg-[#FBFBFD] p-5">
            <h3 className="text-[14.5px] font-bold text-[#1D1D1F]">Categorize & score</h3>
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
      {addingFinding && (
        <AddFindingModal
          study={s}
          categories={meta.categories}
          onClose={() => setAddingFinding(false)}
          onCreated={() => setAddingFinding(false)}
        />
      )}
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
  const [redigererAssessment, setRedigererAssessment] = useState(false);
  const [fjerner, setFjerner] = useState(false);
  const [melding, setMelding] = useState<string | null>(null);

  if (!meta.editable) return null;

  function closeAllBut(which: "categories" | "quality" | "assessment" | "remove" | null) {
    setRedigererKategorier(which === "categories");
    setRedigererKvalitet(which === "quality");
    setRedigererAssessment(which === "assessment");
    setFjerner(which === "remove");
    setMelding(null);
  }

  async function etterEndring(tekst: string) {
    setMelding(tekst);
    closeAllBut(null);
    await onMetaChanged();
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => closeAllBut(redigererKategorier ? null : "categories")}
          className="rounded-[10px] border border-[#D9D9DE] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"
        >
          Categories
        </button>
        <button
          onClick={() => closeAllBut(redigererKvalitet ? null : "quality")}
          className="rounded-[10px] border border-[#D9D9DE] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"
        >
          {s.quality ? "Quality" : "Add quality"}
        </button>
        {meta.editableV2 && (
          <button
            onClick={() => closeAllBut(redigererAssessment ? null : "assessment")}
            className="rounded-[10px] border border-[#D9D9DE] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#1D1D1F] hover:bg-[#F5F5F7]"
          >
            {s.abstract || s.keyFindingsAssessment ? "Assessment" : "Add assessment"}
          </button>
        )}
        <span className="text-[11.5px] text-[#AEAEB2]">
          {s.kategori.length ? s.kategori.join(", ") : "No category"}
          {s.quality ? ` · ${s.quality.score}% ${s.quality.label}` : " · no quality score"}
          {s.outcomeDirection ? ` · ${OUTCOME_LABEL[s.outcomeDirection]} outcome` : ""}
        </span>
        {meta.editableV2 && (
          <button
            onClick={() => closeAllBut(fjerner ? null : "remove")}
            className="ml-auto text-[12px] font-semibold text-[#B3403A] hover:underline"
          >
            {s.removed ? "Restore study" : "Remove study…"}
          </button>
        )}
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
          onCancel={() => closeAllBut(null)}
          onSaved={etterEndring}
        />
      )}

      {redigererKvalitet && (
        <QualityEditor
          s={s}
          reviewer={reviewer}
          onCancel={() => closeAllBut(null)}
          onSaved={etterEndring}
        />
      )}

      {redigererAssessment && (
        <AssessmentEditor
          s={s}
          reviewer={reviewer}
          onCancel={() => closeAllBut(null)}
          onSaved={etterEndring}
        />
      )}

      {fjerner && (
        <RemoveStudyEditor
          s={s}
          reviewer={reviewer}
          onCancel={() => closeAllBut(null)}
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
  const [outcomeDirection, setOutcomeDirection] = useState<OutcomeDirection | "">(s.outcomeDirection ?? "");
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
      setFeil("Still confirming your sign in — try again in a moment.");
      return;
    }
    setBusy(true);
    setFeil(null);
    try {
      const res = await fetch("/api/study-quality", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pmid: s.pmid,
          score: Number(score),
          label,
          outcomeDirection: outcomeDirection || null,
          note,
          reviewer,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeil(data.error || "Could not save the score.");
        return;
      }
      await onSaved(
        `Research quality saved as ${score}% ${label}${
          outcomeDirection ? `; outcome ${OUTCOME_LABEL[outcomeDirection]}` : ""
        }.`
      );
    } catch (e) {
      setFeil((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function fjern() {
    if (!reviewer.trim()) {
      setFeil("Still confirming your sign in — try again in a moment.");
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
        Research quality · how rigorously the study was designed and run
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

      <div className="mt-3 text-[12.5px] font-semibold text-[#AEAEB2]">
        Outcome · which way the study's own result pointed for krill oil (independent of quality above)
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

      <p className="mt-3 text-[11.5px] text-[#AEAEB2]">
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

function AssessmentEditor({
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
  const [abstract, setAbstract] = useState(s.abstract ?? "");
  const [keyFindingsAssessment, setKeyFindingsAssessment] = useState(s.keyFindingsAssessment ?? "");
  const [busy, setBusy] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);

  async function lagre() {
    if (!reviewer.trim()) {
      setFeil("Still confirming your sign in — try again in a moment.");
      return;
    }
    if (!abstract.trim() && !keyFindingsAssessment.trim()) {
      setFeil("Add an abstract or a key findings assessment.");
      return;
    }
    setBusy(true);
    setFeil(null);
    try {
      const res = await fetch("/api/study-assessment", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pmid: s.pmid, abstract, keyFindingsAssessment, reviewer }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeil(data.error || "Could not save.");
        return;
      }
      await onSaved("Science team assessment saved.");
    } catch (e) {
      setFeil((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 mt-3">
      <div className="mb-2 text-[12.5px] font-semibold text-[#AEAEB2]">
        Science team assessment · your own abstract and evaluation, separate from the summary above
      </div>
      <label className="mb-1 block text-[11.5px] font-semibold text-[#6E6E73]">Abstract</label>
      <AutoTextarea value={abstract} onChange={setAbstract} />
      <label className="mb-1 mt-3 block text-[11.5px] font-semibold text-[#6E6E73]">
        Key findings assessment
      </label>
      <AutoTextarea value={keyFindingsAssessment} onChange={setKeyFindingsAssessment} />
      <p className="mt-2 text-[11.5px] text-[#AEAEB2]">
        Saved as {reviewer || "…"} on {formatDate(new Date().toISOString())}.
      </p>
      {feil && <p className="mt-2 text-[12px] font-semibold text-[#B3403A]">{feil}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => void lagre()}
          disabled={busy}
          className="rounded-[10px] bg-[#1D1D1F] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#3A3A3C] disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save assessment"}
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

function RemoveStudyEditor({
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
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);

  async function fjern() {
    if (!reviewer.trim()) {
      setFeil("Still confirming your sign in — try again in a moment.");
      return;
    }
    setBusy(true);
    setFeil(null);
    try {
      const res = await fetch("/api/study-removed", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pmid: s.pmid, reason, reviewer }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeil(data.error || "Could not remove the study.");
        return;
      }
      await onSaved("Study removed from this page.");
    } catch (e) {
      setFeil((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function gjenopprett() {
    if (!reviewer.trim()) {
      setFeil("Still confirming your sign in — try again in a moment.");
      return;
    }
    setBusy(true);
    setFeil(null);
    try {
      const res = await fetch(`/api/study-removed?pmid=${encodeURIComponent(s.pmid)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setFeil(data.error || "Could not restore the study.");
        return;
      }
      await onSaved("Study restored.");
    } catch (e) {
      setFeil((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (s.removed) {
    return (
      <div className="mb-3 mt-3 rounded-[12px] border border-[#E6C9C9] bg-[#FBF3F3] p-4">
        <p className="text-[12.5px] text-[#8A3530]">
          Removed by {s.removedBy} on {formatDate(s.removedAt)}
          {s.removedReason && <> · “{s.removedReason}”</>}. It stays off the Scientific Studies page and
          the content generator's study picker until restored.
        </p>
        {feil && <p className="mt-2 text-[12px] font-semibold text-[#B3403A]">{feil}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => void gjenopprett()}
            disabled={busy}
            className="rounded-[10px] bg-[#1D1D1F] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#3A3A3C] disabled:opacity-40"
          >
            {busy ? "Restoring…" : "Restore study"}
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

  return (
    <div className="mb-3 mt-3 rounded-[12px] border border-[#E6C9C9] bg-[#FBF3F3] p-4">
      <p className="text-[12.5px] text-[#8A3530]">
        Removing hides this study from the Scientific Studies page and the content generator's
        study picker. Any findings already grounded in it are kept, not deleted. This is reversible
        — a removed study can be restored later.
      </p>
      <label className="mb-1 mt-3 block text-[11.5px] font-semibold text-[#6E6E73]">
        Reason, optional
      </label>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why is this study being removed?"
        className="w-full rounded-[10px] border border-[#E8E8ED] bg-white px-3 py-2 text-[13.5px] outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
      />
      {feil && <p className="mt-2 text-[12px] font-semibold text-[#B3403A]">{feil}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => void fjern()}
          disabled={busy}
          className="rounded-[10px] bg-[#B3403A] px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-[#9A322D] disabled:opacity-40"
        >
          {busy ? "Removing…" : "Confirm remove"}
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
