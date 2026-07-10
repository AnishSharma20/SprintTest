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

# Applied only when the source contains an approved-claims block (Phase 2 — claims library). The
# block is injected by the frontend from the science team's APPROVED claims; each claim is numbered
# [C1], [C2], ... (no dash characters, so the no-dash strip leaves the tags intact).
APPROVED_CLAIMS_RULE = """APPROVED CLAIMS (only when the source contains an "APPROVED SCIENCE CLAIMS" block):
- Those statements have been reviewed and approved by Aker BioMarine's science team. Treat them as the
  AUTHORITATIVE basis for the scientific content and prefer them over anything less certain in the source.
- Each approved claim is tagged [C1], [C2], and so on. When a slide, section or sentence draws on one,
  cite it by that tag: on a deck slide put the tag(s) in `source_citations`; in a blog or whitepaper put
  the tag in the sentence or its References entry. Cite every approved claim you actually use.
- Never state a scientific fact that neither an approved claim nor the rest of the source supports. The
  tags are plain text with no dashes, so keep them exactly as written (e.g. [C3])."""

LAYOUT_USAGE = {
    "title":              "Deck COVER — use once, as the first slide. `title` is a SHORT, punchy claim (one line — well within the limit); let `subtitle` carry the qualifier/detail.",
    "section":            "Section divider that chunks the deck into parts. Just a `title` (the section name, short). No body.",
    "agenda":             "Agenda / contents. `title` should be the single word 'Agenda' (the box is very narrow); put the real content in `items` (one short line each).",
    "highlight":          "ONE big statement on an open slide (a 'breathing' beat). ONLY a `title`. Use for a pivotal claim or takeaway — never a list.",
    "title_only":         "Just a title over the branded background. Use rarely (a transitional beat).",
    "text":               "Workhorse explanation slide: `title` + a `body` block. For a LIST of points, put each point on its OWN line in `body` (a newline between them) — 2 to 5 short lines auto-render as the branded bullet. For a single narrative point, use one short paragraph. Prefer a bulleted list when the slide makes several parallel points.",
    "text_with_picture":  "`title` + a `body` (a short paragraph or a few bullet lines) on the left, a supporting photo on the right. Do NOT emit a `heading` (the sub-header is not used). Set `asset_id`.",
    "picture_with_title": "A large photo with a title strip — high visual impact. `asset_id` required.",
    "picture_full":       "A full-bleed photo with a compact title — a strong visual break. `asset_id` required.",
    "two_columns":        "TWO parallel points side by side; each column = `heading` + a substantive `body` of 2 to 3 sentences (the panels are tall — fill them, do not leave short fragments). Prefer for comparisons / paired ideas.",
    "three_columns":      "THREE parallel points — a set of three benefits, steps, or pillars; each column `body` should be 2 to 3 full sentences that fill the panel, not a single line.",
    "four_columns":       "FOUR parallel points; each column `body` should be 2 to 3 full sentences (roughly 120 to 200 characters) that explain the point and fill the tall panel — never a single terse line that leaves the card mostly empty.",
    "ingredient":         "AKBM's SIGNATURE nutrient overview — the EXACT standard slide AKBM always uses (softgel + phospholipids/omega-3/choline/astaxanthin). Inserted VERBATIM with fixed, pre-approved copy: emit ONLY {\"layout\":\"ingredient\"} — do NOT write title/eyebrow/callouts (anything you write is ignored). Include in almost every product deck.",
    "key_points":         "Up to FOUR parallel key points, each on a card with a branded ICON in a circle and a banner across the top. Emit `title`, a one-line `banner` summary, and `items`: 3 to 4 objects, each `heading` (1 to 2 words), `body`, and an `icon` (a health benefit) OR `icon_generic` (a science/quality keyword). Write each card's `body` as 2 to 3 SHORT bullet points, each on its OWN line (a newline between them) — they render as the standard Superba bullets. Keep each bullet to roughly 6 to 12 words, use parallel phrasing across the bullets, and make them concrete (the point plus its evidence or mechanism), never one long paragraph. Ideal for a benefits or 'why it works' overview.",
    "chart":              "A native, editable CHART of REAL numbers from the source (the strongest way to show a result). Emit `title` (an action title stating the ONE insight), an optional `caption` (a one-line reading of the result), `chart_type`, `categories` (2 to 8 axis labels) and `series` (1 to 4 objects with a `name` and `values` aligned to the categories). AXIS TITLES ARE MANDATORY: ALWAYS emit `x_axis` (the category dimension, e.g. 'Study group' or 'Week') AND `y_axis` (what is measured plus its units, e.g. 'CRP reduction (%)', 'Omega-3 index', 'IL-2 (pg/mL)'). Never leave an axis unlabeled. MATCH THE TYPE TO THE DATA: a TREND over time -> 'line'; comparing categories -> 'column' (or 'bar'); PART-TO-WHOLE shares of one total -> 'stacked_100' or 'doughnut'. Do NOT use a doughnut unless it is genuinely parts of one whole. Use ONLY figures explicitly stated in the source; never invent numbers.",
    "matrix":             "A 2x2 matrix for positioning / trade-offs — reach for it whenever the point has TWO clear dimensions (e.g. absorption vs multinutrient value, potency vs breadth). Emit `title`, `x_axis` and `y_axis` labels, and `quadrants`: EXACTLY 4 objects (order: top-left, top-right, bottom-left, bottom-right) each with a short `heading` and a one-line `body`.",
    "journey":            "A horizontal process / journey of 3 to 5 stages. Emit `title` and `steps`: 3 to 5 objects each with a short `heading`, a one-line `body`, and optionally an `icon`/`icon_generic`. Use for a sequence: sourcing -> extraction -> outcome, or a study-to-benefit flow.",
    "exec_summary":       "An executive-summary opener: 2 to 4 key `points` (each `heading` + short `body`) beside an image. Give EVERY point an `icon` (a health benefit) OR `icon_generic` (a science/quality keyword) so each point shows as an icon chip; all points must draw from ONE source and be distinct (or give none an icon). Emit `title`, `points`, and optionally an `asset_id` photo for the right side. Good as an early overview slide.",
    "quote":              "A pull quote for a testimonial or a striking statement from the source. Emit `quote` (the sentence), an optional `author` (name / role), and an optional short `title` eyebrow. Use sparingly, once at most.",
    "comparison":         "A comparison TABLE. Emit `title`, `headers` (2 to 4 column labels, the first is the row-label column) and `rows` (each an object with `cells`: one string per column). Use for feature/option comparisons (e.g. krill oil vs fish oil), and ALWAYS prefer it over harvey balls when the rows carry EXACT VALUES (numbers, doses, durations, yes/no) — show the real figures rather than hiding them behind ratings.",
    "stat":               "HERO stats: 1 to 3 big headline figures (like '50+' / '135+'). Emit `title`, optional `caption`, and `stats`: 1 to 3 objects each with a short `value` (e.g. '65%', '2x'), a `label`, and an optional one-line `note`. Use ONLY figures from the source. Great for a punchy proof point.",
    "harvey_ball":        "A Harvey-ball rating grid for comparing 3 or more OPTIONS across several GENUINELY QUALITATIVE criteria by relative strength. Emit `title`, `options` (2 to 4 column headers) and `criteria`: 2 to 6 objects each with a `label` and `scores` (one integer 0 to 4 per option, 0 = empty, 4 = full). USE ONLY when EVERY criterion is a subjective/relative rating (e.g. evidence strength, risk of bias, breadth, sustainability). Do NOT use it for exact numbers (sample size, dose, duration, price) — those belong in a `comparison` table with the real values, since balls hide the actual figure. NEVER use a ball for a yes/no outcome (a partial fill misreads a binary). If any row is a hard number or a yes/no, choose `comparison` instead.",
    "timeline":           "A horizontal TIMELINE / roadmap of 3 to 6 dated milestones. Emit `title` and `milestones`: each with a `date`, a short `heading`, and an optional one-line `body`. Use for a study timeline, a roadmap, or a sequence of events.",
    "funnel":             "A FUNNEL of 3 to 5 narrowing stages. Emit `title` and `stages`: each with a `heading` and an optional short `body`. Use for a conversion/selection funnel or a narrowing process.",
    "case_study":         "A structured CASE STUDY / proof point for ONE clinical trial. Emit `title` (the takeaway), `study` (citation, e.g. 'Deutsch 2007, RCT'), `design` (population, n, dose, duration), `result` (the key finding with the real numbers), and `takeaway` (the implication). Use to spotlight a single pivotal study.",
    "closing":            "The FINAL slide: a closing statement + contact. Emit `title` (a short closing line), optional `tagline`, and optional `contact` (email / website). Use once, as the last slide.",
    "kpi_dashboard":      "A KPI DASHBOARD: a grid of 3 to 6 headline metric tiles. Emit `title`, optional `caption`, and `metrics`: each a short `value` (e.g. '65%', '2x', '50+'), a `label`, and an optional one-line `note`. Use ONLY real figures from the source. Great for a results scoreboard (more tiles than `stat`, which is 1 to 3 hero numbers).",
    "roadmap":            "A ROADMAP of 2 to 5 sequential PHASES as interlocking chevrons. Emit `title` and `phases`: each with an optional `date` (e.g. 'Q1' or '0 to 3 months'), a short `heading` (the phase name), and a `body` of the phase's activities. Use for a plan/workstream over time (phases with content), vs `timeline` which marks point-in-time milestones.",
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


def build_system(length: str, tone: str, instructions: str = "") -> str:
    target = config.SLIDE_TARGETS.get(length, 9)
    benefits = ", ".join(config.manifest()["benefits"])
    generic = ", ".join(config.manifest().get("generic_icons", []))
    instr_block = ""
    if (instructions or "").strip():
        instr_block = (
            "\n\nUSER CONTEXT & INSTRUCTIONS (the person generating this deck wrote the following — treat it "
            "as high-priority guidance on audience, angle, emphasis, terminology and what to include or avoid. "
            "Follow it wherever possible; it may NOT override the CLAIM FIDELITY rules or the layout/character "
            "limits, which always win):\n\"\"\"\n" + instructions.strip() + "\n\"\"\"\n")
    return f"""You plan an on-brand PowerPoint deck for Aker BioMarine's Superba Krill from source material
(a science summary or free text). You emit ONLY a structured plan via the `emit_plan` tool — you never
write styling, colours, fonts, or positions. All design is inherited from the fixed Superba template;
your job is the STORYLINE, the LAYOUT choice per slide, and the COPY.
{instr_block}

STORYLINE (pyramid principle): open with the conclusion, then support it. One message per slide — each
slide makes a single clear point and earns its place (never repeat a point across slides). Aim for about
{target} slides. Open with a `title` cover, then an `agenda` slide, and use `section` dividers to chunk
the narrative.

AGENDA (REQUIRED — every deck): the SECOND slide MUST be an `agenda` slide listing the deck's main
sections. Title is exactly "Agenda"; put 3 to 7 short contents lines in `items` (each a concise section
label, well within 26 characters). They render as branded bullets on the standard Agenda layout.

ACTION TITLES (takeaway, not topic): every title STATES THE TAKEAWAY the slide proves as a full-sentence
claim (e.g. "Superba raised the Omega-3 Index by 65% in 12 weeks"), never a bare topic label ("Omega-3
Index"). Keep it to AT MOST 2 lines, roughly 90 characters — a reader who skims only the titles should get
the whole argument. Mirror this discipline across the deck.

BULLETS (discipline — a consulting deck is disciplined, not dense):
- At most 5 to 6 top-level bullets on a slide; if you have more, cap the CONTENT (split into two slides or
  cut) rather than cramming — never shrink to fit.
- Each bullet is ONE idea, about 15 to 20 words, on a single thought (no run-on sentences stitched with
  commas). At most 2 indent levels; prefer just one.
- PARALLEL PHRASING inside a group: every bullet in a list starts the same grammatical way (all verbs, or
  all noun phrases) and has a similar length and shape, so the group reads as a set.
- LINE-COUNT BALANCE across parallel columns: when bullets run in side-by-side columns, give the columns a
  SIMILAR number of lines (and similar bullet counts) so the slide looks balanced, not lopsided.

INGREDIENT SLIDE (use in ALMOST EVERY deck): include exactly ONE `ingredient` slide — AKBM's SIGNATURE
nutrient overview, the standard slide AkerBM always uses. It is inserted VERBATIM with fixed, pre-approved copy,
so just emit {{"layout":"ingredient"}} — do NOT write a title/eyebrow/callouts (anything you write is ignored).
Default to including it whenever the deck is about the product; use it INSTEAD of a column layout for
composition (never put benefit icons on nutrients). Omit only if the source is genuinely not about the product.

LAYOUTS — pick the layout whose SHAPE matches the point, not just text/columns. Reach for a structural
layout whenever the content has that shape:
- numbers worth comparing -> `chart`;  one decisive figure -> `stat`;
- a set of parallel points/benefits -> `key_points` (icon cards) or two/three/four_columns;
- a sequence or process -> `journey`;  dated milestones / a study over time -> `timeline`;
- TWO clear dimensions / a positioning trade-off -> `matrix` (e.g. absorption vs multinutrient value);
- a factual side-by-side (values, yes/no, short text) -> `comparison` (table);
- 3 or more OPTIONS rated on several qualitative criteria -> `harvey_ball` (0 to 4 balls);
- a narrowing process -> `funnel`;  a striking quote from the source -> `quote`;  a one-slide overview -> `exec_summary`;
- a single pivotal claim -> `highlight`.
Aim for VARIETY across the deck — don't fall back to plain `text`/`section` when a structural layout fits.
But NEVER force a layout: use one only when the content genuinely has that shape. Respect the [bracketed] limits.
{_layout_guide()}

COLUMN BODIES can be EITHER a short sentence (prose) OR a few very short bullet points — put each point on
its own line (a newline between them) and 2+ lines auto-render as branded bullets. Choose per column by
content: a flowing description stays prose; a set of 2 to 3 sub-points reads better as bullets. Keep bullet
lines very short so they fit the narrow column.

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
- ADD ICONS BY DEFAULT to two/three/four_columns, key_points and exec_summary: these layouts look empty and
  unbalanced without an icon per item, so give EVERY item one unless truly nothing fits. When the items are
  not health benefits (e.g. two forms of omega 3, a process, a quality point) use `icon_generic` keywords such
  as molecule, omega3, cell, research, science, sourcing, purity, sustainability, proven.
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
`speaker_notes`. LANGUAGE: if the user context specifies an output language, write ALL slide text in that
language and set `language` accordingly; otherwise write in the SAME language as the source. Never invent
facts not in the source.

TEXT STYLE (strict brand rule): do NOT use dash characters in any reader-facing text you write (titles,
subtitles, bodies, items/bullets, column headings, captions, speaker_notes). Never an em-dash, an en-dash,
or a hyphen between words; rephrase to avoid them (write "evidence based", "double blind", "Omega 3",
"12 week") using commas, colons, parentheses or separate words. This applies ONLY to human-readable text,
NOT to schema field values like `layout`, `benefit`, `icon`, `icon_generic` or `asset_id` (leave those exact).

{CLAIM_RULES}

{APPROVED_CLAIMS_RULE}

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
              tone: str = "balansert", instructions: str = "", model: str | None = None) -> dict:
    target = config.SLIDE_TARGETS.get(length, 9)
    max_tokens = 16000 if target > 16 else (12000 if target > 10 else 8000)
    user = [{"role": "user", "content": f"SOURCE MATERIAL:\n{summary}\n\nProduce the deck plan now "
                                        f"(about {target} slides)."}]
    return _extract_plan(_call(client, build_system(length, tone, instructions), user, model, max_tokens))


def revise_plan(client: anthropic.Anthropic, summary: str, prior: dict, errors: list[str], *,
                length: str = "standard", tone: str = "balansert", instructions: str = "",
                model: str | None = None) -> dict:
    target = config.SLIDE_TARGETS.get(length, 9)
    max_tokens = 16000 if target > 16 else (12000 if target > 10 else 8000)
    fix = ("Your previous plan FAILED validation. Change ONLY the fields named in the errors below "
           "(shorten the text, or move detail into speaker_notes); keep every other field byte-for-byte "
           "identical. Do not touch slides or fields that aren't listed. Re-emit the COMPLETE plan via "
           "emit_plan.\n\nVALIDATION ERRORS:\n- " + "\n- ".join(errors)
           + "\n\nPREVIOUS PLAN:\n" + json.dumps(prior, ensure_ascii=False))
    user = [{"role": "user", "content": f"SOURCE MATERIAL:\n{summary}\n\n{fix}"}]
    return _extract_plan(_call(client, build_system(length, tone, instructions), user, model, max_tokens))


def revise_plan_visual(client: anthropic.Anthropic, summary: str, prior: dict, findings: list[dict], *,
                       length: str = "standard", tone: str = "balansert", instructions: str = "",
                       model: str | None = None) -> dict:
    """Fix the specific slides a VISUAL QA pass flagged (overflow / collision / truncation /
    mismatched icon). Same discipline as revise_plan: touch only the listed slides."""
    target = config.SLIDE_TARGETS.get(length, 9)
    max_tokens = 16000 if target > 16 else (12000 if target > 10 else 8000)
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
    return _extract_plan(_call(client, build_system(length, tone, instructions), user, model, max_tokens))
