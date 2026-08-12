// The editable layer on top of the study list.
//
// The list itself (PubMed metadata, summaries, the built in benefit categories and the curated
// quality scores) is still produced by app/studies.ts. What a reviewer can change from the UI —
// category names, which categories a study belongs to, its scientific quality/outcome, its
// Science team assessment, and whether it's removed from the page — lives in Supabase and is
// laid over the list here, on the client, so an edit is visible immediately without waiting out
// the 24 hour cache on the PubMed data.
//
// Everything degrades to the built in values when the database is not configured or the
// relevant migration has not been run yet.

import type { Studie } from "./studies";
import type { Category } from "./lib/claims-types";
import type { OutcomeDirection } from "./studies-data";

export type StudyQuality = {
  score: number;
  label: "High" | "Moderate" | "Low";
  outcomeDirection: OutcomeDirection | null;
  note: string | null;
  reviewed_by: string;
  reviewed_at: string;
};

export type StudyAssessment = {
  abstract: string | null;
  keyFindingsAssessment: string | null;
  updated_by: string;
  updated_at: string;
};

export type StudyRemoval = {
  reason: string | null;
  removed_by: string;
  removed_at: string;
};

export type StudyMeta = {
  /** Supabase is set up. */
  configured: boolean;
  /** Migration 0003 has been run, so categories and quality can be edited. */
  editable: boolean;
  /** Migration 0009 has been run, so assessment and removal can be edited. */
  editableV2: boolean;
  categories: Category[];
  /** pmid → category ids, only for studies a reviewer has moved. */
  studyCategories: Record<string, string[]>;
  quality: Record<string, StudyQuality>;
  assessment: Record<string, StudyAssessment>;
  removed: Record<string, StudyRemoval>;
};

export const EMPTY_META: StudyMeta = {
  configured: false,
  editable: false,
  editableV2: false,
  categories: [],
  studyCategories: {},
  quality: {},
  assessment: {},
  removed: {},
};

export async function loadStudyMeta(): Promise<StudyMeta> {
  try {
    const [cats, links, quality, assessment, removed] = await Promise.all([
      fetch("/api/categories").then((r) => r.json()),
      fetch("/api/study-categories").then((r) => r.json()),
      fetch("/api/study-quality").then((r) => r.json()),
      fetch("/api/study-assessment").then((r) => r.json()),
      fetch("/api/study-removed").then((r) => r.json()),
    ]);
    if (!cats.configured) return EMPTY_META;
    return {
      configured: true,
      editable: links.migrated !== false && quality.migrated !== false,
      editableV2: assessment.migrated !== false && removed.migrated !== false,
      categories: (cats.categories ?? []) as Category[],
      studyCategories: links.byPmid ?? {},
      quality: quality.byPmid ?? {},
      assessment: assessment.byPmid ?? {},
      removed: removed.byPmid ?? {},
    };
  } catch {
    return EMPTY_META;
  }
}

/** The categories a study belongs to right now, as ids (reviewer assignment wins). */
export function effectiveCategoryIds(s: Studie, meta: StudyMeta): string[] {
  const moved = meta.studyCategories[s.pmid];
  const ids = moved?.length ? moved : s.kategoriIds ?? [];
  if (!meta.configured) return ids;
  // Drop ids of categories that have since been deleted.
  const finnes = new Set(meta.categories.map((c) => c.id));
  return ids.filter((id) => finnes.has(id));
}

/** Lay the reviewer edits over the study list. Removed studies are annotated, not dropped —
 * each caller decides whether to filter them out (the Scientific Studies page keeps them
 * around, behind a toggle, so a reviewer can restore one; the content generator's picker
 * filters them out entirely). */
export function applyStudyMeta(studier: Studie[], meta: StudyMeta): Studie[] {
  if (!meta.configured) return studier;
  const navn = new Map(meta.categories.map((c) => [c.id, c.name]));
  return studier.map((s) => {
    const ids = effectiveCategoryIds(s, meta);
    const q = meta.quality[s.pmid];
    const a = meta.assessment[s.pmid];
    const r = meta.removed[s.pmid];
    return {
      ...s,
      kategoriIds: ids,
      kategori: ids.map((id) => navn.get(id)!),
      quality: q ? { score: q.score, label: q.label } : s.quality,
      qualityReviewer: q?.reviewed_by ?? null,
      qualityReviewedAt: q?.reviewed_at ?? null,
      qualityNote: q?.note ?? null,
      outcomeDirection: q ? q.outcomeDirection : s.outcomeDirection,
      abstract: a?.abstract ?? s.abstract ?? null,
      keyFindingsAssessment: a?.keyFindingsAssessment ?? s.keyFindingsAssessment ?? null,
      removed: !!r,
      removedReason: r?.reason ?? null,
      removedBy: r?.removed_by ?? null,
      removedAt: r?.removed_at ?? null,
    };
  });
}

/** "2026-08-07" from a timestamp, for the reviewer line under a quality score. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** The rating that goes with a score, as a starting point the reviewer can override. */
export function suggestLabel(score: number): "High" | "Moderate" | "Low" {
  if (score >= 75) return "High";
  if (score >= 45) return "Moderate";
  return "Low";
}

export const OUTCOME_LABEL: Record<OutcomeDirection, string> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
};
