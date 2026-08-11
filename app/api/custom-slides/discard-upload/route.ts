// /api/custom-slides/discard-upload — remove a just-uploaded Storage object that never became a
// saved slide (the user cancelled the pick step, or inspect/save failed partway). Paths are
// fresh random UUIDs minted per upload attempt (see upload-url/route.ts) and only ever get
// attached to a custom_slide_files row on a successful save, so nothing else can be referencing
// one here — a bare delete is always safe. Best-effort by design: the caller doesn't wait on or
// surface failures from this (an orphaned Storage object is a minor cleanup gap, not a bug).

import { supabase, dbNotConfigured } from "../../../lib/supabase";

const BUCKET = "custom-slides";

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  const { storage_path } = (await req.json().catch(() => ({}))) as { storage_path?: string };
  if (!storage_path) return Response.json({ ok: true });

  await sb.storage.from(BUCKET).remove([storage_path]);
  return Response.json({ ok: true });
}
