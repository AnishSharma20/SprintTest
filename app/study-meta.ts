// The editable layer on top of the study list.
//
// The list itself (PubMed metadata, summaries, the built in benefit categories and the curated
// quality scores) is still produced by app/studies.ts. What a reviewer can change from the UI —
// category names, which categories a study belongs to, and its scientific quality — lives in
// Supabase and is laid over the list here, on the client, so an edit is visible immediately
// without waiting out the 24 hour cache on the PubMed data.
//
// Everything degrades to the built in values when the database is not configured or migration
// 0003 has not been run yet.

import type { Studie } from "./studies";
import type { Category } from "./lib/claims-types";

export type StudyQuality = {
  score: number;
  label: "High" | "Moderate" | "Low";
  note: string | null;
  reviewed_by: string;
  reviewed_at: string;
};

export type StudyMeta = {
  /** Supabase is set up. */
  configured: boolean;
  /** Migration 0003 has been run, so categories and quality can be edited. */
  editable: boolean;
  categories: Category[];
  /** pmid → category ids, only for studies a reviewer has moved. */
  studyCategories: Record<string, string[]>;
  quality: Record<string, StudyQuality>;
};

export const EMPTY_META: StudyMeta = {
  configured: false,
  editable: false,
  categories: [],
  studyCategories: {},
  quality: {},
};

export async function loadStudyMeta(): Promise<StudyMeta> {
  try {
    const [cats, links, quality] = await Promise.all([
      fetch("/api/categories").then((r) => r.json()),
      fetch("/api/study-categories").then((r) => r.json()),
      fetch("/api/study-quality").then((r) => r.json()),
    ]);
    if (!cats.configured) return EMPTY_META;
    return {
      configured: true,
      editable: links.migrated !== false && quality.migrated !== false,
      categories: (cats.categories ?? []) as Category[],
      studyCategories: links.byPmid ?? {},
      quality: quality.byPmid ?? {},
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

/** Lay the reviewer edits over the study list. */
export function applyStudyMeta(studier: Studie[], meta: StudyMeta): Studie[] {
  if (!meta.configured) return studier;
  const navn = new Map(meta.categories.map((c) => [c.id, c.name]));
  return studier.map((s) => {
    const ids = effectiveCategoryIds(s, meta);
    const q = meta.quality[s.pmid];
    return {
      ...s,
      kategoriIds: ids,
      kategori: ids.map((id) => navn.get(id)!),
      quality: q ? { score: q.score, label: q.label } : s.quality,
      qualityReviewer: q?.reviewed_by ?? null,
      qualityReviewedAt: q?.reviewed_at ?? null,
      qualityNote: q?.note ?? null,
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
