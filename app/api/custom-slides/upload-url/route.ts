// /api/custom-slides/upload-url — mint a Supabase Storage signed upload URL so the browser can
// PUT the raw .pptx bytes DIRECTLY to Storage, bypassing Vercel's serverless body ceiling for
// the save step too (the file itself never transits through this server — only a filename in,
// a signed URL out). Storage's own limit is far above anything a real slide deck hits.
//
// The signed URL is single-use, scoped to exactly this one object path, and expires (Supabase's
// default) in 2 hours — safe to hand to the browser outright, unlike the service role key that
// minted it.

import { supabase, dbNotConfigured } from "../../../lib/supabase";

const BUCKET = "custom-slides";

export async function POST() {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  const path = `${crypto.randomUUID()}.pptx`;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ path, token: data.token, signedUrl: data.signedUrl });
}
