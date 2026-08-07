// The bridge between the two places categories live.
//
// A study's built in benefit categories are written as NAMES in app/studies.ts
// (ARCHIVE_CATEGORIES), while findings reference a category by ID (the `categories` table,
// seeded by supabase/migrations/0002_align_benefit_categories.sql). Categories can now be
// renamed from the UI, so a name is no longer a stable key: everything is matched on the id
// below, and the name shown in the UI is always read back from the table.
//
// These ids MUST stay in step with migration 0002. A category added from the UI gets a
// slugified id instead and only ever exists in the table.

export const CANONICAL_CATEGORY_IDS: Record<string, string> = {
  "Wellness & Immune Support": "wellness_immune",
  "Heart Support": "heart",
  "Liver Support": "liver",
  "Joint Support": "joints",
  "Healthy Aging Support": "healthy_aging",
  "Brain & Dry Eye Support": "brain_eye",
  "PMS Support": "pms",
  "Skin Support": "skin",
  "Sports Performance Support": "sports_performance",
  "Weight Loss Support": "weight_loss",
};

/** Built in category names to their stable ids (unknown names are dropped). */
export function canonicalIds(names: string[]): string[] {
  return [...new Set(names.map((n) => CANONICAL_CATEGORY_IDS[n]).filter(Boolean))];
}

/** Id for a category created from the UI, in the style of the seeded ones. */
export function slugifyCategory(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug || "category";
}
