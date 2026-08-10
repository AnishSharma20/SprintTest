"use client";

// Data Warehouse — a PREVIEW of connecting to AKBM's own evidence data warehouse, which they are
// building separately (their system: deep per-study backend data, real endpoints, agents querying
// it; ours: clarity in data/process/content generation). Their system does not exist yet, so this
// page cannot call it. Instead: a parameter builder styled as if it were querying their API, run
// against a MOCK dataset transcribed verbatim from the client's own solution design
// ("krill_oil_evidence_database_v4.xlsx", received 2026-08-10) — so the shape of a real response
// is already right when their API exists. Standalone: not wired into the Content Generator.

import { useMemo, useState } from "react";
import PageHero from "../PageHero";
import { Pill } from "../v2/ui";
import { CATEGORIES } from "../studies";
import {
  WAREHOUSE_STUDIES,
  WAREHOUSE_RESULTS,
  WAREHOUSE_OUTCOMES,
  WAREHOUSE_QUALITY_STUDIES,
  WAREHOUSE_QUALITY_CRITERIA,
  type WarehouseStudy,
} from "../data-warehouse-sample";

type SignificanceFilter = "any" | "Significant" | "Not Significant" | "Pending";

type Params = {
  studyType: "any" | "RCT" | "Protocol (fictive)";
  category: "any" | (typeof CATEGORIES)[number];
  keyword: string;
  outcomeMeasure: string; // "any" or an exact WarehouseResult.outcomeMeasure
  significance: SignificanceFilter;
  minQuality: number; // 0-100
  minN: number;
  includeFictive: boolean;
};

const DEFAULT_PARAMS: Params = {
  studyType: "any",
  category: "any",
  keyword: "",
  outcomeMeasure: "any",
  significance: "any",
  minQuality: 0,
  minN: 0,
  includeFictive: false,
};

function qualityTone(rating: string): "green" | "amber" | "red" | "gray" {
  if (rating === "High") return "green";
  if (rating === "Moderate") return "amber";
  if (rating === "Low") return "red";
  return "gray";
}

function significanceTone(sig: string): "green" | "amber" | "red" | "gray" {
  if (sig === "Significant") return "green";
  if (sig === "Pending") return "amber";
  if (sig.startsWith("Not Significant")) return "gray";
  return "gray";
}

function leadingNumber(v: number | string): number {
  if (typeof v === "number") return v;
  const m = String(v).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function matchesSignificanceBucket(sig: string, wanted: SignificanceFilter): boolean {
  if (wanted === "any") return true;
  if (wanted === "Not Significant") return sig.startsWith("Not Significant");
  return sig === wanted;
}

export default function DataWarehousePage() {
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [sentParams, setSentParams] = useState<Params | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const outcomeMeasureOptions = useMemo(() => {
    const set = new Set(WAREHOUSE_RESULTS.map((r) => r.outcomeMeasure));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, []);

  function setField<K extends keyof Params>(key: K, value: Params[K]) {
    setParams((p) => ({ ...p, [key]: value }));
  }

  function runQuery() {
    setBusy(true);
    // A short simulated round trip — there is nothing to actually wait on, but an instant
    // response would undersell that this is meant to stand in for a real network call.
    window.setTimeout(() => {
      setSentParams(params);
      setBusy(false);
    }, 500);
  }

  const results = useMemo(() => {
    if (!sentParams) return [] as WarehouseStudy[];
    return WAREHOUSE_STUDIES.filter((s) => {
      if (!sentParams.includeFictive && s.fictive) return false;
      if (sentParams.studyType !== "any" && s.studyType !== sentParams.studyType) return false;
      if (sentParams.category !== "any" && !s.categories.includes(sentParams.category)) return false;
      if (sentParams.minN > 0 && leadingNumber(s.n) < sentParams.minN) return false;
      if (sentParams.minQuality > 0 && s.qualityScore < sentParams.minQuality) return false;

      if (sentParams.keyword.trim()) {
        const haystack = `${s.population} ${s.intervention} ${s.primaryOutcome} ${s.keyResult}`.toLowerCase();
        if (!haystack.includes(sentParams.keyword.trim().toLowerCase())) return false;
      }

      const studyResults = WAREHOUSE_RESULTS.filter((r) => r.study === s.reference);
      if (sentParams.outcomeMeasure !== "any" && !studyResults.some((r) => r.outcomeMeasure === sentParams.outcomeMeasure)) {
        return false;
      }
      if (sentParams.significance !== "any" && !studyResults.some((r) => matchesSignificanceBucket(r.significance, sentParams.significance))) {
        return false;
      }
      return true;
    });
  }, [sentParams]);

  return (
    <>
      <PageHero eyebrow="Preview · AKBM Data Warehouse" title="Data Warehouse">
        A preview of connecting to AKBM&apos;s own evidence data warehouse, currently in
        development on their side. Build a query the way it would be sent to their system, and see
        a response shaped exactly like their proposed schema.
      </PageHero>

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-8">
        {/* ----- disclaimer — this does not work yet, by design ----- */}
        <div className="rounded-[4px] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-bold uppercase tracking-[0.02em]">Preview only - not a live connection</p>
          <p className="mt-1 max-w-3xl">
            AKBM&apos;s own data warehouse solution is coming; this page is just a preview of how
            this website could connect to it once it exists.
          </p>
        </div>

        <p className="mt-4 text-xs text-zinc-500">
          Sample schema loaded: {WAREHOUSE_STUDIES.length} studies · {WAREHOUSE_RESULTS.length} endpoint-level
          results · {WAREHOUSE_QUALITY_CRITERIA.length} quality criteria per study.
        </p>

        {/* ----- parameter builder ----- */}
        <section className="mt-6 rounded-[4px] border border-[#C2D9E3] bg-white p-6">
          <h2 className="text-lg font-bold text-[#031B34]">Build a query</h2>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600">
            These are the parameters that would be sent to AKBM&apos;s data warehouse API once it
            exists.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-xs font-semibold text-[#06456B]">
              Study type
              <select
                value={params.studyType}
                onChange={(e) => setField("studyType", e.target.value as Params["studyType"])}
                className="mt-1 w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm font-normal outline-none focus:border-[#3FD0C9]"
              >
                <option value="any">Any</option>
                <option value="RCT">RCT</option>
                <option value="Protocol (fictive)">Protocol (fictive)</option>
              </select>
            </label>

            <label className="block text-xs font-semibold text-[#06456B]">
              Benefit category
              <select
                value={params.category}
                onChange={(e) => setField("category", e.target.value as Params["category"])}
                className="mt-1 w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm font-normal outline-none focus:border-[#3FD0C9]"
              >
                <option value="any">Any</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-semibold text-[#06456B]">
              Outcome measure
              <select
                value={params.outcomeMeasure}
                onChange={(e) => setField("outcomeMeasure", e.target.value)}
                className="mt-1 w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm font-normal outline-none focus:border-[#3FD0C9]"
              >
                <option value="any">Any</option>
                {outcomeMeasureOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-semibold text-[#06456B]">
              Significance
              <select
                value={params.significance}
                onChange={(e) => setField("significance", e.target.value as SignificanceFilter)}
                className="mt-1 w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm font-normal outline-none focus:border-[#3FD0C9]"
              >
                <option value="any">Any</option>
                <option value="Significant">Significant</option>
                <option value="Not Significant">Not significant</option>
                <option value="Pending">Pending</option>
              </select>
            </label>

            <label className="block text-xs font-semibold text-[#06456B]">
              Minimum quality score
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={params.minQuality}
                onChange={(e) => setField("minQuality", Number(e.target.value) || 0)}
                className="mt-1 w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm font-normal outline-none focus:border-[#3FD0C9]"
              />
            </label>

            <label className="block text-xs font-semibold text-[#06456B]">
              Minimum N (randomised)
              <input
                type="number"
                min={0}
                step={10}
                value={params.minN}
                onChange={(e) => setField("minN", Number(e.target.value) || 0)}
                className="mt-1 w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm font-normal outline-none focus:border-[#3FD0C9]"
              />
            </label>

            <label className="block text-xs font-semibold text-[#06456B]">
              Keyword (population, intervention, outcome)
              <input
                type="text"
                placeholder="e.g. knee, CRP, Superba"
                value={params.keyword}
                onChange={(e) => setField("keyword", e.target.value)}
                className="mt-1 w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm font-normal outline-none focus:border-[#3FD0C9]"
              />
            </label>
          </div>

          <label className="mt-4 flex items-center gap-2 text-xs font-semibold text-[#06456B]">
            <input
              type="checkbox"
              checked={params.includeFictive}
              onChange={(e) => setField("includeFictive", e.target.checked)}
            />
            Include the fictive protocol (Andersen et al. 2026 — marketing development only, not a
            real study)
          </label>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runQuery}
              disabled={busy}
              className="rounded-[4px] bg-[#031B34] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Querying (simulated)…" : "Send query"}
            </button>
            <button
              type="button"
              onClick={() => {
                setParams(DEFAULT_PARAMS);
                setSentParams(null);
              }}
              className="rounded-[4px] px-3 py-2 text-sm font-semibold text-zinc-500 hover:bg-zinc-100"
            >
              Reset
            </button>
          </div>

          {sentParams && (
            <details className="mt-4 rounded-[4px] border border-[#E3EDF2] bg-[#FBFBFD] p-3">
              <summary className="cursor-pointer text-xs font-semibold text-[#06456B]">
                Request parameters sent
              </summary>
              <pre className="mt-2 overflow-x-auto text-[11px] text-zinc-600">
                {JSON.stringify(sentParams, null, 2)}
              </pre>
            </details>
          )}
        </section>

        {/* ----- results ----- */}
        {sentParams && (
          <section className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold text-[#031B34]">
                {results.length} matching {results.length === 1 ? "study" : "studies"} (mocked response)
              </h2>
            </div>

            {results.length === 0 ? (
              <p className="mt-4 rounded-[4px] border border-dashed border-[#C2D9E3] bg-[#F7FAFC] p-4 text-sm text-zinc-500">
                No studies in the sample dataset match these parameters. Try loosening the quality
                score, N, or outcome filters.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {results.map((s) => {
                  const isOpen = expanded === s.reference;
                  const studyResults = WAREHOUSE_RESULTS.filter((r) => r.study === s.reference);
                  const outcome = WAREHOUSE_OUTCOMES.find((o) => o.study === s.reference);
                  const qualityRow = WAREHOUSE_QUALITY_STUDIES.includes(s.reference)
                    ? WAREHOUSE_QUALITY_CRITERIA.map((c) => ({ criterion: c.criterion, value: c.values[s.reference] }))
                    : [];

                  return (
                    <li key={s.reference} className="rounded-[4px] border border-[#C2D9E3] bg-white p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-[#031B34]">{s.reference}</span>
                            {s.fictive && (
                              <span className="rounded-[3px] bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700">
                                Fictive protocol
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-500">
                            {s.journal} · {s.year} · {s.studyType} · N={s.n}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {s.categories.map((c) => (
                              <span
                                key={c}
                                className="rounded-[3px] bg-[#EAF3F7] px-1.5 py-0.5 text-[10px] font-semibold text-[#06456B]"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        </div>
                        <Pill tone={qualityTone(s.qualityRating)} title={`Quality score ${s.qualityScore}%`}>
                          {s.qualityRating} quality
                        </Pill>
                      </div>

                      <div className="mt-3 grid gap-x-6 gap-y-1 text-sm text-[#031B34] sm:grid-cols-2">
                        <div>
                          <span className="font-semibold">Population: </span>
                          {s.population}
                        </div>
                        <div>
                          <span className="font-semibold">Intervention: </span>
                          {s.intervention} · {s.dose}
                        </div>
                        <div>
                          <span className="font-semibold">Duration: </span>
                          {s.duration}
                        </div>
                        <div>
                          <span className="font-semibold">Primary outcome: </span>
                          {s.primaryOutcome}
                        </div>
                      </div>
                      <p className="mt-2 text-sm italic text-zinc-600">{s.keyResult}</p>

                      {outcome && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          <Pill tone={significanceTone(outcome.directionOfEffect === "No effect" ? "Not Significant" : outcome.directionOfEffect.startsWith("Pending") ? "Pending" : "Significant")}>
                            {outcome.directionOfEffect}
                          </Pill>
                          <span className="text-zinc-500">{outcome.pValue}</span>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : s.reference)}
                        className="mt-3 text-xs font-semibold text-[#06456B] hover:underline"
                      >
                        {isOpen ? "Hide full record ▲" : "View full record (results + quality checklist) ▼"}
                      </button>

                      {isOpen && (
                        <div className="mt-4 space-y-4 border-t border-[#E3EDF2] pt-4">
                          <div>
                            <div className="text-xs font-bold uppercase tracking-[0.08em] text-[#6E6E73]">
                              Results database ({studyResults.length} endpoints)
                            </div>
                            <div className="mt-2 overflow-x-auto">
                              <table className="w-full min-w-[560px] text-left text-xs">
                                <thead>
                                  <tr className="text-zinc-500">
                                    <th className="py-1 pr-3 font-semibold">Outcome</th>
                                    <th className="py-1 pr-3 font-semibold">Timepoint</th>
                                    <th className="py-1 pr-3 font-semibold">Krill oil</th>
                                    <th className="py-1 pr-3 font-semibold">Placebo</th>
                                    <th className="py-1 pr-3 font-semibold">Statistics</th>
                                    <th className="py-1 font-semibold">Significance</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {studyResults.map((r, i) => (
                                    <tr key={i} className="border-t border-[#F0F4F7] align-top">
                                      <td className="py-1.5 pr-3">{r.outcomeMeasure}</td>
                                      <td className="py-1.5 pr-3 text-zinc-500">{r.timepoint}</td>
                                      <td className="py-1.5 pr-3">{r.krillOilResult}</td>
                                      <td className="py-1.5 pr-3 text-zinc-500">{r.placeboResult}</td>
                                      <td className="py-1.5 pr-3 text-zinc-500">{r.statisticalResult}</td>
                                      <td className="py-1.5">
                                        <Pill tone={significanceTone(r.significance)}>{r.significance}</Pill>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          {qualityRow.length > 0 && (
                            <div>
                              <div className="text-xs font-bold uppercase tracking-[0.08em] text-[#6E6E73]">
                                Quality assessment
                              </div>
                              <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                                {qualityRow.map((q) => (
                                  <li key={q.criterion} className="flex justify-between gap-2 border-b border-[#F0F4F7] py-1">
                                    <span className="text-zinc-600">{q.criterion}</span>
                                    <span className="font-semibold text-[#031B34]">{String(q.value)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div className="text-xs text-zinc-500">
                            <span className="font-semibold text-[#06456B]">Limitations / notes: </span>
                            {s.limitations}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </main>
    </>
  );
}
