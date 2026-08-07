// /api/categories — the category list, with usage counts, plus creating a new category.
//
//   GET  /api/categories   { configured, categories: [{ ...category, claim_count, study_count }] }
//   POST /api/categories   { name, parent }  → create (id is slugified from the name)
//
// `study_count` counts only studies that have been MOVED here from the UI (rows in
// study_categories). The built in assignment lives in app/studies.ts, which the server does not
// read, so the category manager adds the built in studies to this number on the client.

import { supabase, dbNotConfigured } from "../../lib/supabase";
import { slugifyCategory } from "../../lib/category-ids";

export async function GET() {
  const sb = supabase();
  if (!sb) return Response.json({ configured: false, categories: [] });

  const cats = await sb.from("categories").select("*").order("sort_order");
  if (cats.error) return Response.json({ error: cats.error.message }, { status: 500 });

  const claims = await sb.from("claims").select("category_id, status").neq("status", "superseded");
  if (claims.error) return Response.json({ error: claims.error.message }, { status: 500 });

  // The override table only exists once migration 0003 has been run; treat it as empty until then
  // so the page still renders (with category management disabled) on an un-migrated database.
  const links = await sb.from("study_categories").select("pmid, category_id");

  const claimCount = new Map<string, number>();
  for (const c of claims.data) claimCount.set(c.category_id, (claimCount.get(c.category_id) ?? 0) + 1);
  const studyCount = new Map<string, number>();
  for (const l of links.data ?? []) studyCount.set(l.category_id, (studyCount.get(l.category_id) ?? 0) + 1);

  return Response.json({
    configured: true,
    migrated: !links.error,
    categories: cats.data.map((c) => ({
      ...c,
      claim_count: claimCount.get(c.id) ?? 0,
      study_count: studyCount.get(c.id) ?? 0,
    })),
  });
}

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const { name, parent = "science" } = (await req.json()) as { name?: string; parent?: string };
    const navn = (name ?? "").trim();
    if (!navn) return Response.json({ error: "A category name is required." }, { status: 400 });
    if (parent !== "science" && parent !== "marketing")
      return Response.json({ error: "Parent must be science or marketing." }, { status: 400 });

    const existing = await sb.from("categories").select("id, name, sort_order");
    if (existing.error) return Response.json({ error: existing.error.message }, { status: 500 });
    if (existing.data.some((c) => c.name.toLowerCase() === navn.toLowerCase()))
      return Response.json({ error: `There is already a category called "${navn}".` }, { status: 409 });

    // Slug ids can collide (an id is only 40 chars, and a category can be deleted and re-added
    // under a name that slugifies the same way), so number the duplicates.
    const taken = new Set(existing.data.map((c) => c.id));
    const base = slugifyCategory(navn);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;

    const sortOrder = Math.max(0, ...existing.data.map((c) => c.sort_order ?? 0)) + 1;
    const inserted = await sb
      .from("categories")
      .insert({ id, parent, name: navn, sort_order: sortOrder })
      .select("*")
      .single();
    if (inserted.error) return Response.json({ error: inserted.error.message }, { status: 500 });

    return Response.json({ category: inserted.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
