"""Stage 1 — content engine.

Calls Claude with the input text, the layout enum, the asset list, and the slide schema
as a (non-strict) tool definition, forcing a single `emit_plan` tool call so the output is
schema-shaped JSON rather than free text. The model chooses layouts, writes copy within
the schema's character limits, and picks photos by id — it never emits styling.

Hard validation + the self-correction retry live in validate.py / pipeline.py; this module
just produces (and, on request, revises) a plan.
"""
from __future__ import annotations

import json

import anthropic

from . import config

# ---- domain rules ported from the previous pipeline (hard-won, brand-critical) ----
CLAIM_RULES = """CLAIM FIDELITY (non-negotiable):
- Every number, effect and citation must be TRUE to the source. Reframing a true figure into a
  clearer equivalent is allowed when correct and not misleading (e.g. 4.9%->8.1% may be shown as
  "+3.2 points" or "+65% relative"). FALSE / unsupported / misleading claims are banned: never
  invent a threshold, never attach a number to the wrong metric, never pair an unrelated figure
  with a headline so they read as one claim.
- EFSA / regulatory: only state an approved claim when the source explicitly says so. Keep null or
  negative results honestly. Never invent a citation, journal, or year.
- Put heavy detail (effect sizes, CI, p-values, dose, study design, full citations) in speaker_notes,
  not on the slide."""

LAYOUT_USAGE = {
    "title":              "Deck COVER — use once, as the first slide. `title` is a SHORT, punchy claim (one line — well within the limit); let `subtitle` carry the qualifier/detail.",
    "section":            "Section divider that chunks the deck into parts. Just a `title` (the section name, short). No body.",
    "agenda":             "Agenda / contents. `title` should be the single word 'Agenda' (the box is very narrow); put the real content in `items` (one short line each).",
    "highlight":          "ONE big statement on an open slide (a 'breathing' beat). ONLY a `title`. Use for a pivotal claim or takeaway — never a list.",
    "title_only":         "Just a title over the branded background. Use rarely (a transitional beat).",
    "text":               "Workhorse explanation slide: `title` + a `body` block. Body can be a short paragraph or a few lines (use line breaks for bullets).",
    "text_with_picture":  "`title` + a short `heading` + `body` on one side, a supporting photo on the other. Set `asset_id`.",
    "picture_with_title": "A large photo with a title strip — high visual impact. `asset_id` required.",
    "picture_full":       "A full-bleed photo with a compact title — a strong visual break. `asset_id` required.",
    "two_columns":        "TWO parallel points side by side; each column = `heading` + `body`. Prefer for comparisons / paired ideas.",
    "three_columns":      "THREE parallel points — a set of three benefits, steps, or pillars.",
    "four_columns":       "FOUR short parallel points.",
    "ingredient":         "AKBM's SIGNATURE nutrient overview — the EXACT standard slide AKBM always uses (softgel + phospholipids/omega-3/choline/astaxanthin). Inserted VERBATIM with fixed, pre-approved copy: emit ONLY {\"layout\":\"ingredient\"} — do NOT write title/eyebrow/callouts (anything you write is ignored). Include in almost every product deck.",
}

TONE_GUIDANCE = {
    "salg":       "Audience = buyers. BENEFIT-FIRST: lead every section with what the product does for the customer; use the science as proof beneath the benefit. Confident, plain, concrete.",
    "balansert":  "Audience = informed but non-specialist. Balance benefit and evidence; explain the science in accessible terms and tie it to a benefit.",
    "vitenskap":  "Audience = scientific / regulatory. COMPREHENSIVE: cover each study, its design and its result (including nulls); precise, measured, well-cited. Still use action titles.",
}


def _limits_from_schema() -> dict[str, str]:
    """Compact per-layout field+limit summary, read from the schema's if/then blocks so
    the guide never drifts from what validation enforces."""
    out = {}
    for cond in config.schema()["properties"]["slides"]["items"].get("allOf", []):
        sem = cond["if"]["properties"]["layout"]["const"]
        props = cond["then"].get("properties", {})
        parts = []
        for f in ("title", "subtitle", "heading", "body"):
            if f in props and "maxLength" in props[f]:
                parts.append(f"{f}≤{props[f]['maxLength']}")
        if "items" in props:
            it = props["items"]
            parts.append(f"items≤{it.get('maxItems','?')}×{it['items'].get('maxLength','?')} chars")
        if "columns" in props:
            col = props["columns"]
            ci = col["items"]["properties"]
            parts.append(f"{col.get('minItems')} columns, each heading≤{ci['heading']['maxLength']} body≤{ci['body']['maxLength']}")
        if props.get("asset_id") is not None or "asset_id" in cond["then"].get("required", []):
            parts.append("asset_id (photo)")
        out[sem] = ", ".join(parts)
    return out


def _layout_guide() -> str:
    limits = _limits_from_schema()
    lines = []
    for sem, usage in LAYOUT_USAGE.items():
        lim = limits.get(sem, "")
        lines.append(f"- {sem} — {usage}" + (f"  [{lim}]" if lim else ""))
    return "\n".join(lines)


def _asset_guide() -> str:
    lines = []
    for a in config.selectable_photos():
        lines.append(f"- {a['id']} ({a.get('bg_fit','')}) — {a['description']}")
    return "\n".join(lines)


def build_system(length: str, tone: str) -> str:
    target = config.SLIDE_TARGETS.get(length, 9)
    benefits = ", ".join(config.manifest()["benefits"])
    generic = ", ".join(config.manifest().get("generic_icons", []))
    return f"""You plan an on-brand PowerPoint deck for Aker BioMarine's Superba Krill from source material
(a science summary or free text). You emit ONLY a structured plan via the `emit_plan` tool — you never
write styling, colours, fonts, or positions. All design is inherited from the fixed Superba template;
your job is the STORYLINE, the LAYOUT choice per slide, and the COPY.

STORYLINE (pyramid principle): open with the conclusion, then support it. One message per slide — each
slide makes a single clear point and earns its place (never repeat a point across slides). Aim for about
{target} slides. Open with a `title` cover and use `section` dividers to chunk the narrative.

ACTION TITLES: every title is a full-sentence claim the slide proves (e.g. "Superba raised the Omega-3
Index by 65% in 12 weeks"), not a topic label ("Omega-3 Index"). Mirror this across the deck.

INGREDIENT SLIDE (use in ALMOST EVERY deck): include exactly ONE `ingredient` slide — AKBM's SIGNATURE
nutrient overview, the standard slide AkerBM always uses. It is inserted VERBATIM with fixed, pre-approved copy,
so just emit {{"layout":"ingredient"}} — do NOT write a title/eyebrow/callouts (anything you write is ignored).
Default to including it whenever the deck is about the product; use it INSTEAD of a column layout for
composition (never put benefit icons on nutrients). Omit only if the source is genuinely not about the product.

LAYOUTS — choose the one that fits each slide's content. PREFER two_columns / three_columns /
four_columns for parallel content (comparisons, benefit sets, steps). Use highlight for a single pivotal
claim. Respect the character limits shown in [brackets] and enforced by the schema — write to fit.
{_layout_guide()}

COLUMN HEADINGS are tiny one-line labels — keep each to 1–2 words, comfortably within the limit, and make the
columns' headings clearly DISTINCT. Never give two columns headings that share their opening words (NOT "What
the barrier does" + "What the barrier needs" — they collapse to the same label; use "Structure" + "Upkeep").
Put the explanation in the column body, not the heading.

PHOTOS (optional, only for text_with_picture / picture_with_title / picture_full): choose an `asset_id`
whose subject fits the slide, and match its bg_fit to the slide `background` (a 'light' photo suits a
light slide). Do NOT force a photo where it doesn't add meaning.
{_asset_guide()}

BACKGROUND & RHYTHM: most slides default to the dark deep-sea master; set `background`:"light" on some
slides for rhythm (light works well for airy statement/picture slides). Alternate — never many identical
slides in a row.

ICONS — clean brand-red line-art from TWO sources; a slide uses ONLY ONE source. Every rule below is ENFORCED
by the renderer, so follow them exactly or the icons are silently dropped.
(A) BRANDED BENEFIT ICONS — one per HEALTH BENEFIT ({benefits}). Set a column's `icon`, or a slide's top-level
    `benefit`, to the benefit it depicts. MATCH THE TOPIC EXACTLY: heart→heart, liver→liver,
    brain/memory/focus/mood→cognitive, joints→joint, muscle/strength/recovery→muscle, skin→skin,
    eyes/vision→eye, women's-health/menstrual/cycle→pms, exercise/sport/performance→sports, overall
    wellbeing→whole_body, uptake/bioavailability→absorption. Never attach an icon whose meaning differs from
    the words (no heart icon on a liver point).
(B) GENERIC FALLBACK ICONS — a neutral line-art set for topics with NO branded benefit icon. Set a column's
    `icon_generic` to the closest keyword from: {generic}. Use for science / composition / sourcing / quality
    slides (e.g. science, research, molecule, omega3, sustainability, ocean, sourcing, purity, quality, safety,
    growth, proven, process).
RULES (column layouts):
- ALL-OR-NOTHING + ONE SOURCE. Either give EVERY column a branded `icon`, OR give EVERY column an
  `icon_generic`, OR give no column any icon. NEVER mix the two fields on one slide and NEVER fill only some
  columns — a partial or mixed set is dropped entirely, so it's wasted effort.
- PREFER branded benefit icons when every column is a distinct health benefit. If even one column is not a
  benefit but the set still deserves icons, use `icon_generic` on ALL columns instead (there are generic
  heart / brain / joint / muscle / eye keywords to cover any benefit columns in that same generic set).
- Each icon is distinct — never repeat one on a slide.
- Set slide-level `benefit` on a highlight / section / text_with_picture slide about ONE benefit (e.g. a skin
  statement → benefit:"skin"); the icon is placed automatically.
- Nutrients / ingredients / composition → use the `ingredient` layout, never icons. If in doubt, leave off.

TONE: {TONE_GUIDANCE.get(tone, TONE_GUIDANCE['balansert'])}

CITATIONS: where the source cites studies, carry them into `source_citations` and the detail into
`speaker_notes`. LANGUAGE: write the deck in the SAME language as the source (Norwegian in -> Norwegian
out; set `language` accordingly). Never invent facts not in the source.

{CLAIM_RULES}

Emit the plan now via emit_plan."""


def _tool_schema() -> dict:
    s = {k: v for k, v in config.schema().items() if k not in ("$schema", "title")}
    return s


def _extract_plan(msg) -> dict:
    for block in msg.content:
        if block.type == "tool_use" and isinstance(block.input, dict) and block.input.get("slides"):
            return block.input
    raise ValueError("Planner returned no plan (no emit_plan tool call with slides).")


def _call(client, system, user, model, max_tokens):
    return client.messages.create(
        model=model or config.MODEL, max_tokens=max_tokens, system=system,
        tools=[{"name": "emit_plan", "description": "Emit the full deck plan as structured JSON.",
                "input_schema": _tool_schema()}],
        tool_choice={"type": "tool", "name": "emit_plan"},
        messages=user,
    )


def plan_deck(client: anthropic.Anthropic, summary: str, *, length: str = "standard",
              tone: str = "balansert", model: str | None = None) -> dict:
    target = config.SLIDE_TARGETS.get(length, 9)
    max_tokens = 12000 if target > 10 else 8000
    user = [{"role": "user", "content": f"SOURCE MATERIAL:\n{summary}\n\nProduce the deck plan now "
                                        f"(about {target} slides)."}]
    return _extract_plan(_call(client, build_system(length, tone), user, model, max_tokens))


def revise_plan(client: anthropic.Anthropic, summary: str, prior: dict, errors: list[str], *,
                length: str = "standard", tone: str = "balansert", model: str | None = None) -> dict:
    target = config.SLIDE_TARGETS.get(length, 9)
    max_tokens = 12000 if target > 10 else 8000
    fix = ("Your previous plan FAILED validation. Change ONLY the fields named in the errors below "
           "(shorten the text, or move detail into speaker_notes); keep every other field byte-for-byte "
           "identical. Do not touch slides or fields that aren't listed. Re-emit the COMPLETE plan via "
           "emit_plan.\n\nVALIDATION ERRORS:\n- " + "\n- ".join(errors)
           + "\n\nPREVIOUS PLAN:\n" + json.dumps(prior, ensure_ascii=False))
    user = [{"role": "user", "content": f"SOURCE MATERIAL:\n{summary}\n\n{fix}"}]
    return _extract_plan(_call(client, build_system(length, tone), user, model, max_tokens))


def revise_plan_visual(client: anthropic.Anthropic, summary: str, prior: dict, findings: list[dict], *,
                       length: str = "standard", tone: str = "balansert", model: str | None = None) -> dict:
    """Fix the specific slides a VISUAL QA pass flagged (overflow / collision / truncation /
    mismatched icon). Same discipline as revise_plan: touch only the listed slides."""
    target = config.SLIDE_TARGETS.get(length, 9)
    max_tokens = 12000 if target > 10 else 8000
    lines = []
    for f in findings:
        i = f.get("slide", 0)
        title = "?"
        if isinstance(i, int) and 1 <= i <= len(prior.get("slides", [])):
            s = prior["slides"][i - 1]
            title = s.get("title") or s.get("layout") or "?"
        issues = ", ".join(f.get("issues") or []) or "visual issue"
        lines.append(f'Slide {i} ("{title}") [{issues}]: {f.get("fix", "").strip()}')
    fix = ("A visual QA review of your RENDERED deck found the slide-level problems below. Fix ONLY "
           "these slides by editing their fields — shorten an overlong title/heading/body so it can't "
           "overflow or wrap into a collision, make a truncated label a short whole phrase, and for an "
           "icon that doesn't match its text either switch it to the correct icon or drop icons from "
           "that slide. Keep every OTHER slide and field byte-for-byte identical, and obey all the "
           "layout/icon/limit rules. Remember the icon fields are two SEPARATE vocabularies: a column's "
           "`icon` must be a benefit name and `icon_generic` must be a generic keyword from the lists "
           "above — never put a benefit name in `icon_generic`, keep every icon on a slide from the "
           "same one set, and if no valid icon fits, leave the slide's icons off. Re-emit the COMPLETE "
           "plan via emit_plan.\n\nVISUAL QA FINDINGS:\n- " + "\n- ".join(lines)
           + "\n\nPREVIOUS PLAN:\n" + json.dumps(prior, ensure_ascii=False))
    user = [{"role": "user", "content": f"SOURCE MATERIAL:\n{summary}\n\n{fix}"}]
    return _extract_plan(_call(client, build_system(length, tone), user, model, max_tokens))
