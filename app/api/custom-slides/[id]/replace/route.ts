// /api/custom-slides/[id]/replace — swap the underlying .pptx a team-slide entry points at,
// keeping its id/name/description/mode untouched. This is how an edited slide (downloaded via
// /api/custom-slides/[id]/export, edited in PowerPoint, re-uploaded to Storage via the existing
// /api/custom-slides/upload-url signed URL) gets saved back over the same library card instead
// of becoming a brand new one.
//
//   POST { storage_path, filename, preview_b64, slide_index?, author? } → { slide }

import { supabase, dbNotConfigured } from "../../../../lib/supabase";

const BUCKET = "custom-slides";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;

  try {
    const { storage_path, filename, preview_b64, slide_index, author } = (await req.json()) as {
      storage_path?: string;
      filename?: string;
      preview_b64?: string;
      slide_index?: number;
      author?: string;
    };
    if (!storage_path) return Response.json({ error: "The replacement file is missing." }, { status: 400 });

    const existing = await sb.from("custom_slides").select("id, file_id").eq("id", id).maybeSingle();
    if (existing.error) return Response.json({ error: existing.error.message }, { status: 500 });
    if (!existing.data) return Response.json({ error: "Slide not found." }, { status: 404 });
    const oldFileId = existing.data.file_id;

    const by = (author ?? "").trim() || null;
    const fileId = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    const file = await sb.from("custom_slide_files").insert({
      id: fileId,
      filename: (filename ?? "slide.pptx").slice(0, 120),
      storage_path,
      created_by: by,
    });
    if (file.error) return Response.json({ error: file.error.message }, { status: 500 });

    const upd = await sb
      .from("custom_slides")
      .update({
        file_id: fileId,
        slide_index: Number.isInteger(slide_index) ? slide_index : 0,
        preview_b64: preview_b64 ?? null,
        updated_by: by,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, file_id, slide_index, name, description, mode, preview_b64, updated_by, updated_at")
      .single();
    if (upd.error) {
      await sb.from("custom_slide_files").delete().eq("id", fileId); // don't orphan the new blob
      return Response.json({ error: upd.error.message }, { status: 500 });
    }

    // Garbage-collect the old file now that nothing points at it any more (same rule as DELETE).
    if (oldFileId && oldFileId !== fileId) {
      const rest = await sb.from("custom_slides").select("id").eq("file_id", oldFileId).limit(1);
      if (!rest.error && rest.data.length === 0) {
        const oldFile = await sb.from("custom_slide_files").select("storage_path").eq("id", oldFileId).maybeSingle();
        await sb.from("custom_slide_files").delete().eq("id", oldFileId);
        if (oldFile.data?.storage_path) {
          const rm = await sb.storage.from(BUCKET).remove([oldFile.data.storage_path]);
          if (rm.error) console.warn(`custom-slides: could not remove ${oldFile.data.storage_path}: ${rm.error.message}`);
        }
      }
    }

    return Response.json({ slide: upd.data });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
