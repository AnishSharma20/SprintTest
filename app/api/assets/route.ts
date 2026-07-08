// POST /api/assets — record a generated asset and the approved claims it drew on.
//
// Writes one generated_assets row + one asset_claims row per claim, so a later query can answer
// "which decks/blogs/whitepapers used this claim" (retraction impact). Best-effort: returns
// { configured: false } instead of erroring when Supabase is not set up, so generation never breaks.

import { supabase } from "../../lib/supabase";

export async function POST(req: Request) {
  const sb = supabase();
  if (!sb) return Response.json({ ok: false, configured: false });

  try {
    const body = await req.json();
    const assetType: string = body.asset_type;
    const claimIds: string[] = Array.isArray(body.claim_ids) ? body.claim_ids : [];
    if (!["deck", "blog", "whitepaper"].includes(assetType))
      return Response.json({ error: "asset_type must be deck, blog or whitepaper." }, { status: 400 });

    const asset = await sb
      .from("generated_assets")
      .insert({ asset_type: assetType, title: body.title ?? null, created_by: body.created_by ?? null })
      .select("id")
      .single();
    if (asset.error) return Response.json({ error: asset.error.message }, { status: 500 });

    if (claimIds.length) {
      const rows = claimIds.map((id) => ({ asset_id: asset.data.id, claim_id: id }));
      const link = await sb.from("asset_claims").insert(rows);
      if (link.error) return Response.json({ error: link.error.message }, { status: 500 });
    }
    return Response.json({ ok: true, asset_id: asset.data.id, claims: claimIds.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
