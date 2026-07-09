// /api/claims/[id] — review actions on a single claim.
//
// PATCH body: { action, actor, comment?, text?, category_id? }
//   approve  → status approved (guard: a category claim needs all aggregated paper claims approved)
//   reject   → status rejected; a comment (rejection reason) is REQUIRED;
//              any category claims aggregating this one drop back to pending_review
//   reopen   → rejected/superseded back to pending_review
//   edit     → never mutates an approved text: inserts a NEW version (supersedes → old id,
//              status pending_review, quotes copied), marks the old claim superseded
//   comment  → append a discussion comment
//
// Every status change is written to claim_events (audit trail).

import { supabase, dbNotConfigured } from "../../../lib/supabase";
import { logEvent } from "../../../lib/claims-db";

const CLAIM_SELECT = "*, claim_quotes(*), claim_comments(*), studies(pmid, title)";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = supabase();
  if (!sb) return dbNotConfigured();
  const { id } = await params;

  try {
    const body = await req.json();
    const action: string = body.action;
    const actor: string = (body.actor || "unknown").trim() || "unknown";

    const current = await sb.from("claims").select("*").eq("id", id).single();
    if (current.error) return Response.json({ error: "Claim not found." }, { status: 404 });
    const claim = current.data;

    if (action === "comment") {
      const text = (body.comment || "").trim();
      if (!text) return Response.json({ error: "Comment text is required." }, { status: 400 });
      const ins = await sb
        .from("claim_comments")
        .insert({ claim_id: id, author: actor, body: text, kind: "comment" });
      if (ins.error) return Response.json({ error: ins.error.message }, { status: 500 });
      return reload(sb, id);
    }

    if (action === "approve") {
      if (claim.scope === "category") {
        const links = await sb
          .from("claim_links")
          .select("child_claim_id, claims!child_claim_id(status)")
          .eq("parent_claim_id", id)
          .eq("relation", "aggregates");
        if (links.error) return Response.json({ error: links.error.message }, { status: 500 });
        const unapproved = (links.data ?? []).filter(
          (l) => (l.claims as unknown as { status: string } | null)?.status !== "approved"
        );
        if (unapproved.length > 0)
          return Response.json(
            { error: "This category claim aggregates paper claims that are not approved yet." },
            { status: 409 }
          );
      }
      // A marketing claim ("what we can say about the product") must have at least one piece
      // of backing evidence before it can be approved — no unsubstantiated marketing claims.
      if (claim.claim_type === "marketing") {
        const backing = await sb
          .from("claim_links")
          .select("child_claim_id")
          .eq("parent_claim_id", id)
          .eq("relation", "backed_by");
        if ((backing.data ?? []).length === 0)
          return Response.json(
            { error: "A marketing claim needs at least one piece of backing evidence before it can be approved." },
            { status: 409 }
          );
      }
      const upd = await sb
        .from("claims")
        .update({ status: "approved", approved_by: actor, approved_at: new Date().toISOString() })
        .eq("id", id);
      if (upd.error) return Response.json({ error: upd.error.message }, { status: 500 });
      await logEvent(sb, id, actor, claim.status, "approved");
      return reload(sb, id);
    }

    if (action === "reject") {
      const reason = (body.comment || "").trim();
      if (!reason)
        return Response.json({ error: "A rejection reason is required." }, { status: 400 });
      const upd = await sb.from("claims").update({ status: "rejected" }).eq("id", id);
      if (upd.error) return Response.json({ error: upd.error.message }, { status: 500 });
      await sb.from("claim_comments").insert({ claim_id: id, author: actor, body: reason, kind: "rejection_reason" });
      await logEvent(sb, id, actor, claim.status, "rejected", reason);

      // Cascade guard: parents aggregating this claim can no longer stand approved.
      const parents = await sb
        .from("claim_links")
        .select("parent_claim_id")
        .eq("child_claim_id", id)
        .eq("relation", "aggregates");
      for (const p of parents.data ?? []) {
        const parent = await sb.from("claims").select("status").eq("id", p.parent_claim_id).single();
        if (parent.data?.status === "approved") {
          await sb.from("claims").update({ status: "pending_review" }).eq("id", p.parent_claim_id);
          await logEvent(sb, p.parent_claim_id, "system", "approved", "pending_review",
            "An aggregated paper claim was rejected");
        }
      }
      return reload(sb, id);
    }

    if (action === "reopen") {
      const upd = await sb.from("claims").update({ status: "pending_review" }).eq("id", id);
      if (upd.error) return Response.json({ error: upd.error.message }, { status: 500 });
      await logEvent(sb, id, actor, claim.status, "pending_review", "Reopened for review");
      return reload(sb, id);
    }

    if (action === "edit") {
      const text = (body.text || "").trim();
      if (!text) return Response.json({ error: "Claim text is required." }, { status: 400 });

      const inserted = await sb
        .from("claims")
        .insert({
          scope: claim.scope,
          claim_type: claim.claim_type,
          category_id: body.category_id || claim.category_id,
          study_id: claim.study_id,
          text,
          status: "pending_review",
          origin: "human",
          created_by: actor,
          version: claim.version + 1,
          supersedes: claim.id,
        })
        .select("id")
        .single();
      if (inserted.error) return Response.json({ error: inserted.error.message }, { status: 500 });

      // Carry the grounding quotes over to the new version.
      const quotes = await sb.from("claim_quotes").select("quote, location, verified, verified_at").eq("claim_id", id);
      if ((quotes.data ?? []).length > 0) {
        await sb.from("claim_quotes").insert(
          quotes.data!.map((q) => ({ ...q, claim_id: inserted.data.id }))
        );
      }

      await sb.from("claims").update({ status: "superseded" }).eq("id", id);
      await logEvent(sb, id, actor, claim.status, "superseded", `Edited; new version ${inserted.data.id}`);
      await logEvent(sb, inserted.data.id, actor, null, "pending_review", `Edit of ${claim.id} (v${claim.version})`);
      return reload(sb, inserted.data.id);
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

async function reload(sb: NonNullable<ReturnType<typeof supabase>>, id: string) {
  const res = await sb.from("claims").select(CLAIM_SELECT).eq("id", id).single();
  if (res.error) return Response.json({ error: res.error.message }, { status: 500 });
  return Response.json({ claim: res.data });
}
