// /api/custom-studies/upload-url — mint a Supabase Storage signed upload URL so the browser can
// PUT the raw PDF bytes DIRECTLY to Storage, bypassing Vercel's serverless body ceiling — same
// reasoning as /api/custom-slides/upload-url. The file never transits this server; only a
// filename in, a signed URL out.

import { supabase, dbNotConfigured } from "../../../lib/supabase";

const BUCKET = "custom-studies";

export async function POST() {
  const sb = supabase();
  if (!sb) return dbNotConfigured();

  try {
    const path = `${crypto.randomUUID()}.pdf`;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error) return Response.json({ error: error.message }, { status: 500 });

    return Response.json({ path, token: data.token, signedUrl: data.signedUrl });
  } catch (e) {
    return Response.json({ error: "Could not prepare the upload: " + (e as Error).message }, { status: 500 });
  }
}
