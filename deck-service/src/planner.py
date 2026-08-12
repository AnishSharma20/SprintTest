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
    "picture_full":       "A full-bleed photo with a compact title — a strong visual break. `asset_id` required.",
    "two_columns":        "TWO parallel points side by side; each column = `heading` + a substantive `body` of 3 to 4 full sentences, written close to the [bracketed] body limit below (the panels are tall — fill them, do not leave short fragments). Prefer for comparisons / paired ideas.",
    "three_columns":      "THREE parallel points — a set of three benefits, steps, or pillars; each column `body` should be 3 to 4 full sentences, close to the [bracketed] limit, that fill the panel, not a single line.",
    "four_columns":       "FOUR parallel points; each column `body` should be 3 to 4 full sentences, close to the [bracketed] limit, that explain the point and fill the tall panel — never a single terse line that leaves the card mostly empty.",
    "ingredient":         "AKBM's SIGNATURE nutrient overview — the EXACT standard slide AKBM always uses (softgel + phospholipids/omega-3/choline/astaxanthin). Inserted VERBATIM with fixed, pre-approved copy: emit ONLY {\"layout\":\"ingredient\"} — do NOT write title/eyebrow/callouts (anything you write is ignored). Include in almost every product deck.",
    "key_points":         "Up to FOUR parallel key points, each on a card with a branded ICON in a circle and a banner across the top. Emit `title`, a one-line `banner` summary, and `items`: 3 to 4 objects, each `heading` (1 to 2 words), `body`, and an `icon` (a health benefit) OR `icon_generic` (a science/quality keyword). Write each card's `body` as 3 SHORT bullet points, each on its OWN line (a newline between them) — they render as the standard Superba bullets. Use close to the [bracketed] body limit across the bullets together, parallel phrasing, and make them concrete (the point plus its evidence or mechanism), never one long paragraph. Ideal for a benefits or 'why it works' overview.",
    "chart":              "A native, editable CHART of REAL numbers from the source (the strongest way to show a result). Emit `title` (an action title stating the ONE insight), an optional `caption` (a one-line reading of the result), `chart_type`, `categories` (2 to 8 axis labels) and `series` (1 to 4 objects with a `name` and `values` aligned to the categories). AXIS TITLES ARE MANDATORY: ALWAYS emit `x_axis` (the category dimension, e.g. 'Study group' or 'Week') AND `y_axis` (what is measured plus its units, e.g. 'CRP reduction (%)', 'Omega-3 index', 'IL-2 (pg/mL)'). Never leave an axis unlabeled. MATCH THE TYPE TO THE DATA: a TREND over time -> 'line'; comparing categories -> 'column' (or 'bar'); PART-TO-WHOLE shares of one total -> 'stacked_100' or 'doughnut'. Do NOT use a doughnut unless it is genuinely parts of one whole. Use ONLY figures explicitly stated in the source; never invent numbers.",
    "matrix":             "A 2x2 matrix for positioning / trade-offs — reach for it whenever the point has TWO clear dimensions (e.g. absorption vs multinutrient value, potency vs breadth). Emit `title`, `x_axis` and `y_axis` labels, and `quadrants`: EXACTLY 4 objects (order: top-left, top-right, bottom-left, bottom-right) each with a short `heading` and a one-line `body`.",
    "exec_summary":       "The executive summary — REQUIRED in every deck, as the SECOND slide, immediately after the cover. Fixed title ('Executive summary'), so do NOT emit `title` for it. Emit exactly 5 fields, one row each: `source`, `key_finding`, `supporting_findings`, `relevance`, `contents` — see the EXECUTIVE SUMMARY rule for what each holds and the word budget.",
    "comparison":         "A comparison TABLE. Emit `title`, `headers` (2 to 4 column labels, the first is the row-label column) and `rows` (each an object with `cells`: one string per column). Use for feature/option comparisons (e.g. krill oil vs fish oil), and ALWAYS prefer it over harvey balls when the rows carry EXACT VALUES (numbers, doses, durations, yes/no) — show the real figures rather than hiding them behind ratings.",
    "stat":               "HERO stats: 1 to 3 big headline figures (like '50+' / '135+'). Emit `title`, optional `caption`, and `stats`: 1 to 3 objects each with a short `value` (e.g. '65%', '2x'), a `label`, and an optional one-line `note`. Use ONLY figures from the source. Great for a punchy proof point.",
    "harvey_ball":        "A Harvey-ball rating grid for comparing 3 or more OPTIONS across several GENUINELY QUALITATIVE criteria by relative strength. Emit `title`, `options` (2 to 4 column headers) and `criteria`: 2 to 6 objects each with a `label` and `scores` (one integer 0 to 4 per option, 0 = empty, 4 = full). USE ONLY when EVERY criterion is a subjective/relative rating (e.g. evidence strength, risk of bias, breadth, sustainability). Do NOT use it for exact numbers (sample size, dose, duration, price) — those belong in a `comparison` table with the real values, since balls hide the actual figure. NEVER use a ball for a yes/no outcome (a partial fill misreads a binary). If any row is a hard number or a yes/no, choose `comparison` instead.",
    "funnel":             "A FUNNEL of 3 to 5 narrowing stages. Emit `title` and `stages`: each with a `heading` and an optional short `body`. Use for a conversion/selection funnel or a narrowing process.",
    "closing":            "The FINAL slide: a closing statement + contact. Emit `title` (a short closing line), optional `tagline`, and optional `contact` (email / website). Use once, as the last slide.",
    "kpi_dashboard":      "A KPI DASHBOARD: a grid of 3 to 6 headline metric tiles. Emit `title`, optional `caption`, and `metrics`: each a short `value` (e.g. '65%', '2x', '50+'), a `label`, and an optional one-line `note`. Use ONLY real figures from the source. Great for a results scoreboard (more tiles than `stat`, which is 1 to 3 hero numbers).",
    "roadmap":            "A ROADMAP of 2 to 5 sequential PHASES as interlocking chevrons. Emit `title` and `phases`: each with an optional `date` (a GENERIC forward planning period only, e.g. 'Q1' or '0 to 3 months' — never a calendar year or a specific past event date, that is `serpentine`'s job), a short `heading` (the phase name), and a `body` of the phase's activities. Use for a FORWARD-LOOKING plan/workstream (what happens next, in order), or for any sequence of 5 phases (past serpentine's 4-item cap). For 3 or 4 items that are a HISTORICAL/chronological narrative (real years or named past events, e.g. '2007', '2022'), that is `serpentine`, NOT roadmap, even though roadmap could technically hold the same fields — do not default to roadmap out of habit for a story that has an actual timeline shape.",
    "icon_grid":          "A GRID of 3 to 6 icon tiles (3 across). Emit `title`, an optional one-line `banner`, and `items`: 3 to 6 objects each with a short `heading`, a one-line `body`, and an `icon` (health benefit) OR `icon_generic` (science/quality keyword). All items share ONE icon source or none. Use for a set of parallel points, benefits, capabilities or reasons; prefer over key_points when you have 5 to 6 items.",
    "takeaways":          "A NUMBERED key-messages / takeaways list of 2 to 6 rows. Emit `title` and `items`: each a bold `heading` (the message, a full sentence) and an optional `body` (supporting detail). Renders as numbered rows with dividers. Use for a summary, 'what this means', or key-messages slide.",
    "from_to":            "A FROM/TO transformation: two panels with an arrow between. Emit `title`, `before` (`heading` + optional `body`, the current state) and `after` (`heading` + optional `body`, the target state). Use for a shift, before/after, or 'from X to Y' ambition.",
    "pillars":            "PILLARS under a roof: 2 to 5 tall columns capped by an optional roof `banner` (the overarching statement they support). Emit `title`, optional `banner`, and `items`: each a short `heading`, a `body`, and an `icon` OR `icon_generic` (all items share ONE icon source or none). Use for 'our approach rests on N pillars', a framework, or the components of a strategy.",
    "team":               "TEAM cards: 2 to 4 people, each with a `name`, a `role` and a short `bio`. Emit `title` and `items`. Use for a team, authors, contributors or an expert panel. Do NOT invent real people; only use names present in the source.",
    "metric_bars":        "METRIC BARS (bullet-chart rows): 2 to 6 rows, each a `label`, a `pct` (0 to 100, sets the bar length) and an optional `value` (the number to print, e.g. '-37%') and `note`. Emit `title`, optional `caption`. Use when several metrics share a comparable 0 to 100 scale (shares, completion, reduction) and the magnitude should be visible.",
    "cause_effect":       "CAUSE and EFFECT rows: 2 to 4 rows, each a `heading` (the cause/driver) and a `body` (the resulting effect), shown as cause panel then arrow then effect. Use for 'X drives Y' mechanisms, driver trees, or why-so reasoning.",
    "org_chart":          "ORG CHART: a top box (`center`) connected down to 2 to 4 child boxes. Emit `title`, `center` (the top unit/role) and `items`: each a `heading` and optional `body`. Use for reporting lines, a governance structure, or a workstream breakdown.",
    "decision_tree":      "DECISION TREE: a root question (`center`) on the left branching to 2 to 4 outcome boxes on the right. Emit `title`, `center` (the decision/question) and `items`: each a `heading` (the branch/condition) and optional `body` (the outcome). Use for a decision logic, triage, or 'if X then Y' routing.",
    "cycle":              "CYCLE: 3 to 6 labelled nodes arranged in a ring around an optional hub (`center`). Emit `title`, optional `center`, and `items`: each a short `heading` (2 to 3 words). Use for a repeating loop, continuous-improvement cycle, or process with no fixed end. Prefer `roadmap` or `serpentine` for a linear sequence.",
    "serpentine":         "SERPENTINE flow — the WAVY TIMELINE, and the REQUIRED layout (not just preferred) for a HISTORICAL/chronological sequence of 3 or 4 real dated events (calendar years or named past milestones, e.g. '2007', '2022'). Stages are threaded on an S-curve with numbered discs on the crests and each stage's text alternating above and below. Emit `title`, an optional `caption`, and `items`: 3 to 4 objects each with an optional `date` (e.g. '2007' or 'Q1 2026'), a short `heading`, a one-line `body`, and an `icon` OR `icon_generic`. When you give dates, the date replaces the icon chip (there is room for one), so a DATED sequence needs no icons. Do NOT reach for `roadmap` instead just because it could also hold the fields — a 3 to 4 item timeline of real events belongs here. Use `roadmap` only for a forward-looking plan or 5+ phases, and `from_to` for a single before/after.",
    "coverage_matrix":    "COVERAGE MATRIX: entities as rows, capabilities as columns, a tick where the entity covers that capability. Emit `title`, optional `caption`, `headers` (2 to 8 short column labels) and `items`: 2 to 5 rows each with a `label`, an optional one-line `body`, and `marks` (an array of true/false, ONE PER HEADER, in the same order). Use for BINARY yes/no coverage across several options — a portfolio-vs-need fit, feature coverage, which product serves which segment. ALWAYS prefer this over `harvey_ball` when the answer is yes/no rather than a degree, and over `comparison` when the cells would all just read 'Yes'/'No'.",
    "photo_stats":        "PHOTO STAT CARDS: 2 or 3 cards, each a photo above a panel carrying a label, ONE hero figure and a supporting line. Emit `title`, optional `caption`, and `items`: each a short `value` (the figure, e.g. '8.5B', '77%'), a `label` (the theme, e.g. 'Growing, ageing world'), an optional `note` (the one-line explanation) and an optional `asset_id` photo. Use ONLY figures from the source. Use for a high-impact market/context opener — three structural facts with imagery. Prefer `stat` when you have no photos and `kpi_dashboard` for 4 or more figures.",
    "numbered_cards":     "NUMBERED CARDS: 2 to 4 equal cards, each with a number badge, an optional icon, a bold `heading` and a `body`. Emit `title` and `items`: each a `heading` (a full short statement, e.g. 'Our portfolio is positioned to win'), a `body` of 1 to 2 sentences, and an `icon` OR `icon_generic` (all items share ONE icon source or none). Use for an argument in N numbered parts — 'three reasons why', a closing case. Prefer `takeaways` for 5+ points or when the rows are one-liners, and `numbered_cards` when each point needs a paragraph.",
    "implications":       "IMPLICATIONS table: numbered trend rows, each with the detail and a chevron into the 'so what'. Emit `title`, optional `headers` (EXACTLY 3 column labels, e.g. ['Mega trend','Overview','Market implications']), and `items`: 2 to 5 rows each with a `heading` (the trend name, short), a `body` (the explanation, 1 to 3 sentences) and an `implication` (what it means for us / the market). Use for a trends-to-consequences analysis — the strongest way to show 'here is what we observe AND what it means'.",
    "chart_takeaways":    "BUBBLE CHART + KEY TAKEAWAYS: a two-dimensional bubble plot on the left, a bulleted 'so what' column on the right. Emit `title`, `x_axis` and `y_axis` (BOTH MANDATORY — name the dimension and its units, e.g. 'CAGR 2025 to 2030 (%)' and 'Expected revenue 2030 (USD bn)'), `bubbles` (3 to 12 objects each with a short `label`, an `x`, a `y`, and a `size` that sets the bubble area), `takeaways` (2 to 5 bullet sentences reading the chart), optional `headers` (EXACTLY 2 column labels, e.g. ['Market size (USD bn)','Key takeaways']) and an optional `bottom_note` for sources. Use ONLY figures from the source. Use when items compare on TWO axes AND a size — a market landscape, a portfolio scan. Prefer `matrix` for a qualitative 2x2 with no real numbers, and `chart` for a single-dimension comparison.",
    "breakdown":          "BREAKDOWN of a total into shares: a hub circle carrying the total, connectors fanning out to one bar per component. Emit `title`, `total` (the headline figure, e.g. '$137M'), an optional `caption` under the hub (what the total measures), and `items`: 2 to 6 components each with a `label` and a `pct` (its share of the total). Shares should sum to about 100. Use for 'what makes up this number' — revenue by product, studies by area. Prefer a `chart` doughnut only when the parts are a clean part-to-whole with no labels to spell out.",
    "chart_bands":        "COLUMN CHART WITH PHASE BANDS: bars over a time axis, with labelled narrative bands underneath grouping the periods into eras. Emit `title`, optional `caption` and `y_axis`, `categories` (3 to 16 axis labels, e.g. years), `values` (one number per category), and `bands`: 1 to 4 objects each with a `label` (the era name, e.g. 'Road to $100M'), a `start` and an `end` (1-based category indices the band spans). Use ONLY real figures from the source. Use when a trend has a STORY in phases; prefer plain `chart` when there is no phase narrative.",
    "gantt":              "GANTT / project schedule: task bars against a time axis. Emit `title`, optional `caption`, `periods` (2 to 8 column labels along the time axis, e.g. ['Q1','Q2','Q3','Q4'] or ['Wk 1','Wk 2',...]), and `items`: 2 to 8 tasks each with a `label`, a `start` (1-based period index where the bar begins), an `end` (1-based period index where it ends; omit for a single-period task), an optional short `note` (printed on the bar), and an optional `milestone: true` (renders a diamond at `start` instead of a bar). Use for a project plan, study schedule, or delivery timeline where tasks have durations across periods. Prefer `roadmap` for a few sequential phases and `serpentine` for dated events without durations.",
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


# Layouts every deck depends on structurally: the cover, and the agenda slide the pipeline's
# safety net inserts. They can never be turned off from the About page.
_REQUIRED_LAYOUTS = {"title", "agenda"}


def sanitize_disabled(disabled_layouts) -> set[str]:
    """The user-managed off switch from the About page, made safe: only real layout keys,
    never the structurally required ones."""
    known = set(config.catalog())
    return {d for d in (disabled_layouts or ()) if d in known} - _REQUIRED_LAYOUTS


def _layout_guide(disabled: set[str], overridden: set[str] | None = None) -> str:
    limits = _limits_from_schema()
    overridden = overridden or set()
    lines = []
    for sem, usage in LAYOUT_USAGE.items():
        if sem in disabled:
            continue
        if sem in overridden:
            # The normal [field limits] read from the pristine schema no longer apply to an
            # overridden layout (its conditional was swapped to slots) — printing them would
            # contradict the TEAM REDESIGNED LAYOUTS block.
            lines.append(f"- {sem} — {usage}  [TEAM REDESIGNED: emit slots, "
                         f"see TEAM REDESIGNED LAYOUTS]")
            continue
        lim = limits.get(sem, "")
        lines.append(f"- {sem} — {usage}" + (f"  [{lim}]" if lim else ""))
    return "\n".join(lines)


def sanitize_overrides(layout_overrides, disabled: set[str] | None = None) -> list[dict]:
    """The About page's layout design overrides, made safe: only real layout keys, never the
    fixed-role ones (their deterministic nets write normal fields), never a disabled layout
    (off wins over overridden), only entries that carry slots, first wins on a duplicate."""
    from .overrides import OVERRIDE_EXCLUDED
    known = set(config.catalog())
    disabled = disabled or set()
    out, seen = [], set()
    for o in layout_overrides or []:
        key = o.get("layout") if isinstance(o, dict) else None
        if (not key or key not in known or key in OVERRIDE_EXCLUDED
                or key in disabled or key in seen or not o.get("slots")):
            continue
        seen.add(key)
        out.append(o)
    return out


def apply_layout_overrides(schema: dict, layout_overrides: list[dict]) -> None:
    """Swap each overridden layout's schema conditional from its normal fields to the
    override's measured text slots — the model then MUST emit {"layout", "slots": {...}} for
    that key (a normal-field plan fails validation and lands in the structural repair bucket).
    Mutates in place; callers deep-copy first (config.schema() is cached). Shared by
    _tool_schema and validate._schema_with_extras so guidance and enforcement can't drift."""
    if not layout_overrides:
        return
    by_key = {o["layout"]: o for o in layout_overrides}
    items = schema["properties"]["slides"]["items"]
    # The slide object is additionalProperties:false — without a top-level `slots` property
    # every slot plan is rejected outright, whatever the conditionals say.
    items["properties"]["slots"] = {
        "type": "object",
        "description": "Per-slot text for a TEAM REDESIGNED layout (see the system prompt)."}
    for cond in items.get("allOf", []):
        key = cond.get("if", {}).get("properties", {}).get("layout", {}).get("const")
        ov = by_key.get(key)
        if not ov:
            continue
        slot_props = {}
        for s in ov.get("slots") or []:
            sid = s.get("slot_id")
            if not sid:
                continue
            hint = str(s.get("original_text") or "").replace("\n", " / ")[:80]
            slot_props[sid] = {
                "type": "string", "maxLength": int(s.get("char_budget") or 200),
                "description": (f'Fresh text for the box that currently says "{hint}" '
                                f'(~{s.get("lines_estimate") or 1} line(s)); play the same '
                                f"role with this deck's content.")}
        cond["then"] = {"required": ["layout", "slots"],
                        "properties": {"slots": {
                            "type": "object", "additionalProperties": False,
                            "required": sorted(slot_props),
                            "properties": slot_props}}}


def _override_guide(layout_overrides) -> str:
    """Prompt block for TEAM REDESIGNED layouts — the design is spliced verbatim, the model
    writes fresh text per slot. Original text is echoed (truncated) as the role hint."""
    if not layout_overrides:
        return ""
    lines = []
    for ov in layout_overrides:
        slots = ov.get("slots") or []
        lines.append(f"- {ov['layout']} — {len(slots)} text slot(s):")
        for s in slots:
            hint = str(s.get("original_text") or "").replace("\n", " / ")[:80]
            lines.append(f'  · {s.get("slot_id")} [<={s.get("char_budget")} chars, '
                         f'~{s.get("lines_estimate") or 1} line(s)] currently: "{hint}"')
    return (
        "\n\nTEAM REDESIGNED LAYOUTS: the team replaced the DESIGN of these layouts with their "
        "own finished slide, which is spliced in verbatim — YOU write fresh text for its text "
        'boxes. When you pick one of these keys, emit ONLY {"layout": "<key>", "slots": '
        '{"<slot_id>": "..."}, "speaker_notes": "..."} — the layout\'s normal fields (title/'
        "body/items/columns...) are IGNORED for these keys. For each slot, write text that "
        "plays the same ROLE as its current text (a one word label stays a short label, a "
        "headline stays a headline), using THIS deck's own content, within the [bracketed] "
        "budget. These layouts still count toward variety and can be reused like any other "
        "layout.\n" + "\n".join(lines))


def auto_custom_slides(custom_slides) -> list[dict]:
    """The team-uploaded verbatim slides the PLANNER may place ({mode:'auto'} only — 'always'
    slides are appended deterministically by the renderer and never offered to the model)."""
    return [c for c in (custom_slides or []) if c.get("mode") == "auto" and c.get("key")]


def _custom_slide_guide(custom_slides) -> str:
    """Prompt block offering the team's own slides as verbatim layouts. Each is a FIXED, finished
    slide (spliced in unchanged), so the model only decides WHERE it belongs — it writes nothing."""
    autos = auto_custom_slides(custom_slides)
    if not autos:
        return ""
    lines = []
    for c in autos:
        desc = (c.get("description") or "").strip() or "a finished team slide"
        lines.append(f'- {c["key"]} — "{c.get("name", "Team slide")}": {desc}')
    return (
        "\n\nTEAM SLIDES (finished, pre-approved slides the team added to this tool — inserted "
        "VERBATIM): when one of these genuinely fits the storyline, include it by emitting ONLY "
        f'{{"layout":"<its key>"}} at that point — never write a title/body for it (anything you '
        "write is ignored), and use each AT MOST once. Include one only where its content belongs; "
        "never force one in.\n" + "\n".join(lines))


def _asset_guide(custom_photos=None, disabled_photos: set[str] | None = None) -> str:
    disabled_photos = disabled_photos or set()
    lines = []
    for a in config.selectable_photos():
        if a["id"] in disabled_photos:
            continue
        lines.append(f"- {a['id']} ({a.get('bg_fit','')}) — {a['description']}")
    for p in custom_photos or []:
        desc = (p.get("description") or "").strip() or p.get("name") or "a team photo"
        lines.append(f"- {p['key']} (any) — TEAM PHOTO: {desc}")
    return "\n".join(lines)


def custom_photo_ids(custom_photos) -> list[str]:
    """The asset ids of the team's uploaded photos, for extending the schema's asset_id enums."""
    return [p["key"] for p in (custom_photos or []) if p.get("key")]


def sanitize_disabled_photos(disabled_photos) -> set[str]:
    """The About page's photo off switches, made safe: only real built-in photo ids."""
    known = {a["id"] for a in config.selectable_photos()}
    return {d for d in (disabled_photos or ()) if d in known}


def _max_tokens(target: int) -> int:
    """Output budget scaled to the deck size. Bumped alongside the larger slide targets and the
    fuller per-slide text density (TEXT DENSITY below) — the old 8000/12000/16000 ceilings were
    sized for shorter decks with shorter copy, and would start truncating a 15 to 19 slide deck
    that actually fills its boxes."""
    return 20000 if target > 16 else (14000 if target > 10 else 10000)


def photo_minimum(total: int, photo_level: str) -> int:
    """The deck-wide photo floor, scaled by the About page's 'Photos' density level. ONE formula
    shared by the prompt and validate._coverage_warnings, so the initial prompt asks for exactly
    what the post-hoc check enforces."""
    if photo_level == "less":
        return max(1, total // 8)
    if photo_level == "more":
        return max(3, total // 3)
    return max(2, total // 4)


def build_system(length: str, tone: str, instructions: str = "", custom_rules: str = "",
                 disabled_layouts=None, custom_slides=None, custom_photos=None,
                 preferred_layouts=None, design=None, disabled_photos=None,
                 preferred_photos=None, layout_overrides=None) -> str:
    target = config.SLIDE_TARGETS.get(length, 9)
    disabled = sanitize_disabled(disabled_layouts)
    overridden = {o["layout"] for o in (layout_overrides or []) if isinstance(o, dict) and o.get("layout")}
    disabled_photos_set = sanitize_disabled_photos(disabled_photos)
    design = design or {}
    photo_level = design.get("photo_level", "default")
    icon_level = design.get("icon_level", "default")
    # Same formulas as validate._coverage_warnings, so the initial prompt asks for exactly what
    # the post-hoc check enforces — the retry should rarely need to fire over these two.
    synth_min = max(3, target // 2)
    photo_min = photo_minimum(target, photo_level)
    benefits = ", ".join(config.manifest()["benefits"])
    generic = ", ".join(config.manifest().get("generic_icons", []))
    instr_block = ""
    if (instructions or "").strip():
        instr_block = (
            "\n\nUSER CONTEXT & INSTRUCTIONS (the person generating this deck wrote the following — treat it "
            "as high-priority guidance on audience, angle, emphasis, terminology and what to include or avoid. "
            "Follow it wherever possible; it may NOT override the CLAIM FIDELITY rules or the layout/character "
            "limits, which always win):\n\"\"\"\n" + instructions.strip() + "\n\"\"\"\n")
    # Standing rules the team wrote on the tool's About page, applied to EVERY generation (unlike
    # the per-run instructions above). Same priority ceiling: claim fidelity and limits still win.
    rules_block = ""
    if (custom_rules or "").strip():
        rules_block = (
            "\n\nTEAM RULES (standing rules Aker BioMarine's team configured in this tool — they apply to "
            "every deck. Follow each one wherever the source material allows; they may NOT override the "
            "CLAIM FIDELITY rules or the layout/character limits, which always win):\n\"\"\"\n"
            + custom_rules.strip() + "\n\"\"\"\n")
    # The About page can turn layouts off; a disabled layout is dropped from the guide AND from the
    # emit_plan schema enum, so the model could not emit it even if it tried. The extra prompt line
    # keeps the model from wasting a retry discovering that.
    disabled_note = ""
    if disabled:
        disabled_note = ("\nDISABLED LAYOUTS: the team has turned OFF these layouts, so they are NOT "
                         "available in this deck: " + ", ".join(sorted(disabled)) + ".")
    ingredient_block = "" if "ingredient" in disabled else f"""
INGREDIENT SLIDE (use in ALMOST EVERY deck): include exactly ONE `ingredient` slide — AKBM's SIGNATURE
nutrient overview, the standard slide AkerBM always uses. It is inserted VERBATIM with fixed, pre-approved copy,
so just emit {{"layout":"ingredient"}} — do NOT write a title/eyebrow/callouts (anything you write is ignored).
Default to including it whenever the deck is about the product; use it INSTEAD of a column layout for
composition (never put benefit icons on nutrients). Omit only if the source is genuinely not about the product.
"""
    # The executive-summary requirement travels with the layout: when the About page turns
    # exec_summary off, the deck simply doesn't get one (and validate skips its nudge too).
    exec_block = "" if "exec_summary" in disabled else """
EXECUTIVE SUMMARY (REQUIRED — every deck): the SECOND slide, immediately after the cover (before
the agenda), MUST be an `exec_summary` slide. Its title is FIXED to "Executive summary" — do NOT
emit a `title` for it (anything you write there is ignored). Emit exactly these 5 fields, each ONE
row: a bolded lead-in label (drawn automatically from the field name) followed by 1 to 2 full
sentences:
- `source`: which study or studies the deck is generated from — author(s), year, journal, study
  type (e.g. "Randomized controlled trial, n=105, published in Frontiers in Nutrition 2025").
- `key_finding`: the single most important result, with the actual endpoint and number (e.g.
  "WOMAC pain score fell 14% more than placebo at 6 months").
- `supporting_findings`: one sentence covering the secondary results the deck also presents.
- `relevance`: why this matters commercially for Superba Krill — the so what for sales/marketing.
- `contents`: what the deck covers, one line (e.g. "12 slides: study design, primary and
  secondary endpoints, mechanism, positioning").
RULES: full sentences, no orphan bullet fragments. Every claim here must already appear in the
source material or the deck's own slides — invent NOTHING new at the summary level. Prefer a real
number over an adjective ("14% reduction", never "a significant improvement"). Keep the five
fields TOGETHER under about 80 words total — if the true content does not fit that tightly, it is
not a summary: cut to the essential number and sentence per row; the full detail still lives on
the deck's own slides and in their speaker_notes.
"""
    # "House favourite" stars from the About page: a soft preference among equally fitting
    # layouts — never a licence to force a shape onto content that doesn't have it.
    preferred = [p for p in (preferred_layouts or []) if p in LAYOUT_USAGE and p not in disabled]
    preferred_block = ""
    if preferred:
        preferred_block = (
            "\nHOUSE FAVOURITE LAYOUTS: the team starred these as the house style — when several layouts "
            "fit a point EQUALLY well, pick a starred one first: " + ", ".join(preferred) + ". The shape "
            "of the content still wins: never force a favourite onto a point whose shape doesn't match.")
    # Same "house favourite" idea, applied to individual photos rather than layouts.
    known_photo_ids = {a["id"] for a in config.selectable_photos()} | set(custom_photo_ids(custom_photos))
    preferred_photos_valid = [p for p in (preferred_photos or [])
                              if p in known_photo_ids and p not in disabled_photos_set]
    preferred_photos_line = ""
    if preferred_photos_valid:
        preferred_photos_line = ("\nHOUSE FAVOURITE PHOTOS: the team starred these as preferred picks — when "
                                 "choosing an asset_id and several photos fit a slide EQUALLY well, prefer a "
                                 "starred one first: " + ", ".join(preferred_photos_valid) + ".")
    # Photo density level from the About page. The paragraph wording and the enforced minimum
    # move together; validate._coverage_warnings uses the same photo_minimum() formula.
    if photo_level == "less":
        photos_block = f"""PHOTOS (use sparingly — the team turned photo density DOWN): the photo library below is available,
but this deck should stay text and data led. Set `asset_id` only where an image genuinely strengthens the
point (at least {photo_min} slide{'s' if photo_min != 1 else ''} across the deck, e.g. the cover or one breather beat); otherwise leave
photos off. `text_with_picture` and `picture_full` require an asset_id by schema, so reach for those
layouts only when you actually want their photo.
{_asset_guide(custom_photos, disabled_photos_set)}"""
    else:
        more_line = ("\nThe team asked for a PHOTO RICH deck: place photos generously, on every slide where "
                     "one fits." if photo_level == "more" else "")
        photos_block = f"""PHOTOS (REQUIRED, not aspirational): we have a real, high-quality photo library (krill in the wild, Antarctic
ocean/ice, product close-ups, lab and sourcing shots, the team) — USE IT. This {target}-slide deck MUST set
`asset_id` on AT LEAST {photo_min} slides total, not just the odd one: `text_with_picture` and `picture_full`
(asset_id required by their schema) are built for it, and `exec_summary` / `photo_stats` also take an optional
`asset_id` — set one there rather than leaving it off by default. A deck with zero or one photo is under-using
the library; a cover, a mid-deck breather, and a closing beat are all good spots to place one. Choose an
`asset_id` whose subject fits the slide, and match its bg_fit to the slide `background` (a 'light' photo suits
a light slide). Only skip a photo on a given slide when truly nothing in the library fits that specific
point — the {photo_min}-slide minimum still applies across the rest of the deck.{more_line}
{_asset_guide(custom_photos, disabled_photos_set)}"""
    photos_block += preferred_photos_line
    if custom_photos:
        photos_block += ("\nTEAM PHOTOS: entries marked TEAM PHOTO above were uploaded by the team with that "
                         "description as your guidance — prefer one whenever its description matches the "
                         "slide's point better than a library photo.")
    # Icon density level. "none" is ALSO enforced deterministically (the renderer refuses to
    # resolve any icon), so the prompt line just saves the model wasted effort.
    if icon_level == "none":
        icons_block = """ICONS: the team turned brand icons OFF for generated decks. NEVER set a column `icon`, an
`icon_generic`, or a slide-level `benefit` icon field — any you set are dropped by the renderer. Express
hierarchy through headings and text alone."""
    elif icon_level == "less":
        icons_block = f"""ICONS (use sparingly — the team turned icon density DOWN): brand icons exist in two sources, branded
benefit icons ({benefits}) via a column's `icon` or a slide's `benefit`, and generic keywords ({generic})
via `icon_generic`. Add icons ONLY when a slide clearly benefits (e.g. a benefits overview where each
item IS a distinct health benefit) — never by default. The renderer's rules still apply: one source per
slide, all columns or none, exact topic match (no heart icon on a liver point). When in doubt, leave
icons off; a clean text slide is the preferred look here."""
    else:
        icons_block = f"""ICONS — clean brand-red line-art from TWO sources; a slide uses ONLY ONE source. Every rule below is ENFORCED
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
- PREFER a DIFFERENT icon per item when the items are genuinely different topics — but when every item is a
  sub-facet of ONE single benefit or theme (e.g. three cognitive test types from one study, all "cognitive"),
  REPEAT that one icon across every item rather than leaving icons off the slide. A repeated icon still
  passes the all-or-nothing/one-source rule; a slide with no icon at all is the worse outcome here.
- Set slide-level `benefit` on a highlight / section / text_with_picture slide about ONE benefit (e.g. a skin
  statement → benefit:"skin"); the icon is placed automatically.
- Nutrients / ingredients / composition → use the `ingredient` layout, never icons. If in doubt, leave off."""

    return f"""You plan an on-brand PowerPoint deck for Aker BioMarine's Superba Krill from source material
(a science summary or free text). You emit ONLY a structured plan via the `emit_plan` tool — you never
write styling, colours, fonts, or positions. All design is inherited from the fixed Superba template;
your job is the STORYLINE, the LAYOUT choice per slide, and the COPY.
{instr_block}{rules_block}

STORYLINE (pyramid principle): open with the conclusion, then support it. One message per slide — each
slide makes a single clear point and earns its place (never repeat a point across slides). Aim for about
{target} slides. Open with a `title` cover, then the executive summary, then an `agenda` slide, and use
`section` dividers to chunk the narrative.
{exec_block}
AGENDA (REQUIRED — every deck): the slide right after the executive summary (or right after the cover, if
the executive summary is turned off) MUST be an `agenda` slide listing the deck's main sections. Title is
exactly "Agenda"; put 3 to 7 short contents lines in `items` (each a concise section label, well within 26
characters). They render as branded bullets on the standard Agenda layout.

SPEAKER NOTES (REQUIRED — every slide): give EVERY slide a `speaker_notes` field with a presenter-ready
script of 3 to 6 spoken sentences: an opening line that states the slide's takeaway, a walk through the
slide's content in the order a presenter would point at it, the heavy detail that backs it up (effect
sizes, CI, p values, dose, study design, full citations — this is where that detail lives, never on the
slide), and a one-line bridge into the next slide. Write them in the SAME language as the slide text, as
speech a presenter can read aloud (no headings, no markup). Structural beats need notes too: on the cover
a welcome plus the deck's core message, on the executive summary a spoken version of its 5 rows, on the
agenda how the presentation will run, on a section divider what the coming section will show. The ONLY
exceptions are verbatim slides (`ingredient` and team slides), which stay exactly {{"layout":"<key>"}}.

CONTEXT BEFORE EVIDENCE (match AKBM's own decks): do not leap from the agenda straight into the first
specific data point. Spend the NEXT 1 to 2 slides setting the scene first — the underlying trend, need or
problem this deck responds to (a market or consumer shift, a category challenge, why this matters now) —
the way AKBM's own presentations open before turning to Superba specific proof. Good layouts for this beat:
`serpentine`, `photo_stats`, `numbered_cards`, `stat`, `chart`, `implications`, `highlight`, or a `text`
slide. Only after this scene setting should the deck turn to the first slide of product specific evidence.
Keep full ACTION TITLE discipline even here — a real claim about the landscape (e.g. "Omega 3 deficiency
now affects most adults"), never a bare topic label ("Omega 3 status").

ACTION TITLES (takeaway, not topic): every title STATES THE TAKEAWAY the slide proves as a full-sentence
claim (e.g. "Superba raised the Omega-3 Index by 65% in 12 weeks"), never a bare topic label ("Omega-3
Index"). Titles render LARGE (32pt) — keep it to AT MOST 2 lines, roughly 50 characters, tight enough to
usually fit on ONE line — a reader who skims only the titles should get the whole argument. Mirror this
discipline across the deck.

TEXT DENSITY (write substantially, not sparsely): every body/detail field has a real character budget for
its box — the [bracketed] limit printed next to each layout below is that budget, measured from the actual
template geometry. Write to CLOSE TO that budget, not a small fraction of it: bring real supporting
substance (a number, a mechanism, a comparison, a consequence), never a bare single clause when the box has
room for three. AKBM's own decks read as dense and information rich; a slide whose text stops at a small
fraction of its available room reads as thin next to them. This applies everywhere text has room to
grow — column bodies, card bodies, item bodies — not only the `text` layout.

BULLETS (discipline — a consulting deck is disciplined, not dense in COUNT, even though it is dense in
TEXT per bullet — see TEXT DENSITY above):
- At most 5 to 6 top-level bullets on a slide; if you have more, cap the CONTENT (split into two slides or
  cut) rather than cramming — never shrink to fit.
- Each bullet is ONE idea, about 20 to 28 words, on a single thought (no run-on sentences stitched with
  commas) — long enough to carry real substance, not a terse fragment. At most 2 indent levels; prefer just
  one.
- PARALLEL PHRASING inside a group: every bullet in a list starts the same grammatical way (all verbs, or
  all noun phrases) and has a similar length and shape, so the group reads as a set.
- LINE-COUNT BALANCE across parallel columns: when bullets run in side-by-side columns, give the columns a
  SIMILAR number of lines (and similar bullet counts) so the slide looks balanced, not lopsided.

{ingredient_block}
LAYOUTS — pick the layout whose SHAPE matches the point, not just text/columns. Reach for a structural
layout whenever the content has that shape:
- numbers worth comparing -> `chart`;  one decisive figure -> `stat`;
- a set of parallel points/benefits -> `key_points` (icon cards) or two/three/four_columns;
- a sequence or process, or a dated sequence of up to 4 events -> `serpentine` (the wavy timeline);
- EXACTLY TWO comparable groups, arms or conditions (e.g. a subgroup finding by sex, by genotype, a
  before/after, an intervention vs control) -> `from_to`, `two_columns` or `comparison` — NEVER a
  layout built for 3 or more parallel items (`serpentine` needs 3 to 4, `icon_grid` needs 3 to 6,
  `numbered_cards`/`pillars`/`org_chart`/`decision_tree`/`cause_effect` need 2 minimum but read as
  thin and mismatched at exactly 2; reach for one of those only once you truly have 3 or more).
- TWO clear dimensions / a positioning trade-off -> `matrix` (e.g. absorption vs multinutrient value);
- a factual side-by-side (values, yes/no, short text) -> `comparison` (table);
- 3 or more OPTIONS rated on several qualitative criteria -> `harvey_ball` (0 to 4 balls);
- a narrowing process -> `funnel`;  a one-slide overview -> `exec_summary`;
- a single pivotal claim -> `highlight`.
GO BEYOND THE FAMILIAR FEW (REQUIRED, not aspirational): the catalog has 31 code-built layouts, not just
`text`/`two_columns`/`key_points` — reach for the fuller set — `pillars`, `numbered_cards`, `icon_grid`,
`cause_effect`, `cycle`, `roadmap`, `gantt`, `org_chart`, `decision_tree`, `breakdown`, `coverage_matrix`,
`from_to`, `implications`, `metric_bars`, `chart_bands`, `chart_takeaways`, `team`, `takeaways`,
`kpi_dashboard` — before settling for a plain column slide. This {target}-slide deck MUST use AT LEAST {synth_min}
DIFFERENT layouts across its content slides (everything except the cover, agenda, section
dividers, highlight beats and closing) — repeating the same 2 to 3 favourites throughout is a rejected plan,
not a stylistic choice. NEVER force a layout: use one only when the content genuinely has that shape, but
when several fit equally well, prefer whichever one you have used LESS so far in this deck. Respect the
[bracketed] limits.
{_layout_guide(disabled, overridden)}{disabled_note}{preferred_block}{_custom_slide_guide(custom_slides)}{_override_guide(layout_overrides)}

COLUMN BODIES can be EITHER a short sentence (prose) OR a few very short bullet points — put each point on
its own line (a newline between them) and 2+ lines auto-render as branded bullets. Choose per column by
content: a flowing description stays prose; a set of 2 to 3 sub-points reads better as bullets. Keep bullet
lines very short so they fit the narrow column.

COLUMN HEADINGS are tiny one-line labels — keep each to 1–2 words, comfortably within the limit, and make the
columns' headings clearly DISTINCT. Never give two columns headings that share their opening words (NOT "What
the barrier does" + "What the barrier needs" — they collapse to the same label; use "Structure" + "Upkeep").
Put the explanation in the column body, not the heading.

{photos_block}

BACKGROUND & RHYTHM: most slides default to the dark deep-sea master; set `background`:"light" on some
slides for rhythm (light works well for airy statement/picture slides). Alternate — never many identical
slides in a row.

{icons_block}

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


def _tool_schema(disabled: set[str] | None = None, extra_layouts: list[str] | None = None,
                 extra_photo_ids: list[str] | None = None,
                 disabled_photo_ids: set[str] | None = None,
                 layout_overrides: list[dict] | None = None) -> dict:
    s = {k: v for k, v in config.schema().items() if k not in ("$schema", "title")}
    if disabled or extra_layouts or extra_photo_ids or disabled_photo_ids or layout_overrides:
        # Hard enforcement of the About page's switches: a disabled layout is removed from the
        # forced-tool enum, so the model cannot emit it at all (the prompt only explains why);
        # the team's own 'auto' slides are added as pickable verbatim layout keys; the team's
        # photos join every asset_id enum; a disabled BUILT-IN photo is removed from every
        # asset_id enum the same way a disabled layout is removed from the layout enum; and an
        # overridden layout's conditional is swapped to its text slots. Deep copy first —
        # config.schema() is cached.
        import copy
        s = copy.deepcopy(s)
        enum = s["properties"]["slides"]["items"]["properties"]["layout"]["enum"]
        enum = [e for e in enum if e not in (disabled or ())]
        enum += [k for k in (extra_layouts or []) if k not in enum]
        s["properties"]["slides"]["items"]["properties"]["layout"]["enum"] = enum
        if extra_photo_ids:
            extend_asset_enums(s, extra_photo_ids)
        if disabled_photo_ids:
            remove_from_asset_enums(s, disabled_photo_ids)
        if layout_overrides:
            apply_layout_overrides(s, layout_overrides)
    return s


def extend_asset_enums(node, extra_ids: list[str]) -> None:
    """Walk a (sub)schema and append the team's photo ids to EVERY `asset_id` enum — the schema
    enum-constrains asset_id in several per-layout conditionals (top level, photo_stats items,
    exec_summary...), and validate.py reuses this so the two can never drift. Mutates in place."""
    if isinstance(node, dict):
        aid = node.get("asset_id")
        if isinstance(aid, dict) and isinstance(aid.get("enum"), list):
            aid["enum"] = aid["enum"] + [i for i in extra_ids if i not in aid["enum"]]
        for v in node.values():
            extend_asset_enums(v, extra_ids)
    elif isinstance(node, list):
        for v in node:
            extend_asset_enums(v, extra_ids)


def remove_from_asset_enums(node, remove_ids: set[str]) -> None:
    """The inverse of extend_asset_enums: strip disabled built-in photo ids from EVERY
    `asset_id` enum, so the model cannot emit one the About page turned off. Mutates in place."""
    if isinstance(node, dict):
        aid = node.get("asset_id")
        if isinstance(aid, dict) and isinstance(aid.get("enum"), list):
            aid["enum"] = [i for i in aid["enum"] if i not in remove_ids]
        for v in node.values():
            remove_from_asset_enums(v, remove_ids)
    elif isinstance(node, list):
        for v in node:
            remove_from_asset_enums(v, remove_ids)


def _extract_plan(msg) -> dict:
    for block in msg.content:
        if block.type == "tool_use" and isinstance(block.input, dict) and block.input.get("slides"):
            return block.input
    raise ValueError(f"Planner returned no plan (no emit_plan tool call with slides; "
                     f"stop_reason={getattr(msg, 'stop_reason', '?')}).")


def _call(client, system, user, model, max_tokens, disabled: set[str] | None = None,
          extra_layouts: list[str] | None = None, extra_photo_ids: list[str] | None = None,
          disabled_photo_ids: set[str] | None = None,
          layout_overrides: list[dict] | None = None):
    def once(budget):
        return client.messages.create(
            model=model or config.MODEL, max_tokens=budget, system=system,
            tools=[{"name": "emit_plan", "description": "Emit the full deck plan as structured JSON.",
                    "input_schema": _tool_schema(disabled, extra_layouts, extra_photo_ids,
                                                 disabled_photo_ids, layout_overrides)}],
            tool_choice={"type": "tool", "name": "emit_plan"},
            messages=user,
        )
    msg = once(max_tokens)
    # A plan cut off mid-tool-call arrives without usable input (no slides) — seen in practice
    # when a photo-rich or team-slide-rich prompt makes the plan run longer than the length
    # tier's budget. One retry with real headroom beats failing the user's whole deck.
    if msg.stop_reason == "max_tokens":
        msg = once(int(max_tokens * 1.6))
    return msg


def plan_deck(client: anthropic.Anthropic, summary: str, *, length: str = "standard",
              tone: str = "balansert", instructions: str = "", custom_rules: str = "",
              disabled_layouts=None, custom_slides=None, custom_photos=None,
              preferred_layouts=None, design=None, disabled_photos=None,
              preferred_photos=None, layout_overrides=None, model: str | None = None) -> dict:
    target = config.SLIDE_TARGETS.get(length, 9)
    max_tokens = _max_tokens(target)
    disabled = sanitize_disabled(disabled_layouts)
    disabled_photo_ids = sanitize_disabled_photos(disabled_photos)
    extra = [c["key"] for c in auto_custom_slides(custom_slides)]
    photo_ids = custom_photo_ids(custom_photos)
    user = [{"role": "user", "content": f"SOURCE MATERIAL:\n{summary}\n\nProduce the deck plan now "
                                        f"(about {target} slides)."}]
    return _extract_plan(_call(client, build_system(length, tone, instructions, custom_rules,
                                                    disabled, custom_slides, custom_photos,
                                                    preferred_layouts, design, disabled_photos,
                                                    preferred_photos, layout_overrides), user, model,
                               max_tokens, disabled, extra, photo_ids, disabled_photo_ids,
                               layout_overrides))


def revise_plan(client: anthropic.Anthropic, summary: str, prior: dict, errors: list[str], *,
                length: str = "standard", tone: str = "balansert", instructions: str = "",
                custom_rules: str = "", disabled_layouts=None, custom_slides=None,
                custom_photos=None, preferred_layouts=None, design=None,
                disabled_photos=None, preferred_photos=None, layout_overrides=None,
                model: str | None = None) -> dict:
    target = config.SLIDE_TARGETS.get(length, 9)
    max_tokens = _max_tokens(target)
    # Three different kinds of feedback need three different repair instructions. Schema errors name
    # an exact field to shorten — a narrow, surgical fix. VARIETY:/PHOTOS: are deck-wide coverage
    # counts with no named field, and fixing them REQUIRES picking which slides to change layout
    # on or add asset_id to — the opposite of "touch only what's named". TEXT: names fields that are
    # too SHORT, the opposite direction from a schema error, and its fix (add substance) is the
    # opposite of the coverage instruction's "keep content the same, just recast layout" — so it
    # cannot share either bucket's wording without contradicting itself.
    # A schema error's FIX depends on its DIRECTION. "shorten it by at least N" always means cut text.
    # But "'items' is a required property" or an array "is too short" mean the opposite — a field is
    # MISSING or UNDER-filled — and telling the model to "shorten the text, keep everything else
    # identical" for those is not just unhelpful, it's the wrong direction entirely: nothing about
    # that instruction says a field can be ADDED. That mismatch is exactly why a structural error
    # like this survived the one retry and reached the user as a hard failure (seen in practice: a
    # 2-arm subgroup finding forced into `serpentine`, which needs 3 to 4 items).
    shorten_errors = [e for e in errors if "shorten it by at least" in e]
    structural_errors = [e for e in errors
                         if "is a required property" in e or "is too short" in e]
    other_schema_errors = [e for e in errors
                           if not e.startswith(("VARIETY:", "PHOTOS:", "TEXT:", "NOTES:", "SUMMARY:",
                                                "EXEC_LENGTH:"))
                           and e not in shorten_errors and e not in structural_errors]
    coverage_errors = [e for e in errors if e.startswith(("VARIETY:", "PHOTOS:"))]
    text_errors = [e for e in errors if e.startswith("TEXT:")]
    notes_errors = [e for e in errors if e.startswith("NOTES:")]
    summary_errors = [e for e in errors if e.startswith("SUMMARY:")]
    exec_length_errors = [e for e in errors if e.startswith("EXEC_LENGTH:")]

    parts = ["Your previous plan needs revision before it can ship. Re-emit the COMPLETE plan via emit_plan."]
    if shorten_errors:
        parts.append("SCHEMA ERRORS (too long) — change ONLY the fields named below (shorten the text, or "
                      "move detail into speaker_notes); keep every other field byte-for-byte identical; do "
                      "not touch slides or fields that aren't listed:\n- " + "\n- ".join(shorten_errors))
    if structural_errors:
        parts.append("SCHEMA ERRORS (missing or too few) — the fields below are MISSING a required value, "
                      "or an array has fewer items than that layout needs. For each: either ADD the missing "
                      "field or the additional item(s) using REAL content from the source (never invent one "
                      "to hit a count), OR, if the source genuinely does not have enough distinct parallel "
                      "items for that layout's shape, change JUST that slide's `layout` to one that fits how "
                      "many items you actually have (for example exactly two comparable groups/arms fits "
                      "`from_to`, `two_columns` or `comparison`, not a 3-or-more layout like `serpentine`, "
                      "`icon_grid` or `numbered_cards`). Do not touch slides or fields that aren't "
                      "listed:\n- " + "\n- ".join(structural_errors))
    if other_schema_errors:
        parts.append("OTHER SCHEMA ERRORS — fix exactly the problem described for each field below (an "
                      "invalid value, an unavailable background, etc.); keep every other field byte-for-byte "
                      "identical; do not touch slides or fields that aren't listed:\n- "
                      + "\n- ".join(other_schema_errors))
    if coverage_errors:
        parts.append("COVERAGE FEEDBACK — these are deck-wide, not a single field. You MAY change the "
                      "`layout` of some content slides to a better-fitting structural layout, and/or add "
                      "`asset_id` to slides that don't have one, to satisfy the counts below. Keep the "
                      "underlying CONTENT and MESSAGE of each slide the same, just recast its layout or add "
                      "a photo — do not add new slides or remove existing ones:\n- " + "\n- ".join(coverage_errors))
    if text_errors:
        parts.append("TEXT DENSITY FEEDBACK — the fields named below are running short of the room their box "
                      "actually has. EXPAND them (and any similarly thin field elsewhere) toward their "
                      "bracketed limit with genuine supporting substance — a number, a mechanism, a "
                      "comparison, a consequence — never by padding with filler or repeating the same point "
                      "in other words. This changes the WORDING of those fields, not the deck's structure: "
                      "keep every slide's layout, order and core claim the same:\n- " + "\n- ".join(text_errors))
    if notes_errors:
        parts.append("SPEAKER NOTES FEEDBACK — the slides below are missing their `speaker_notes`. ADD a "
                      "presenter-ready script to each (3 to 6 spoken sentences in the slide's own "
                      "language: the takeaway, a walk through the content, the supporting detail, a "
                      "bridge to the next slide) exactly as the SPEAKER NOTES rule describes. This adds "
                      "one field to those slides; keep every other field byte-for-byte "
                      "identical:\n- " + "\n- ".join(notes_errors))
    if summary_errors:
        parts.append("EXECUTIVE SUMMARY FEEDBACK — the deck is missing its executive summary. INSERT one "
                      "`exec_summary` slide as the SECOND slide, immediately after the cover (before the "
                      "agenda), with its 5 required fields (source, key_finding, supporting_findings, "
                      "relevance, contents) as the EXECUTIVE SUMMARY rule describes. Keep every existing "
                      "slide unchanged and in order:\n- " + "\n- ".join(summary_errors))
    if exec_length_errors:
        parts.append("EXECUTIVE SUMMARY LENGTH FEEDBACK — the executive summary is running long. TIGHTEN "
                      "its 5 fields (source, key_finding, supporting_findings, relevance, contents) toward "
                      "the roughly 80-word total target: keep the one essential number and sentence per "
                      "row, cut everything else (the full detail already lives on the deck's own slides "
                      "and in speaker_notes). Keep every other slide byte-for-byte "
                      "identical:\n- " + "\n- ".join(exec_length_errors))
    fix = "\n\n".join(parts) + "\n\nPREVIOUS PLAN:\n" + json.dumps(prior, ensure_ascii=False)
    user = [{"role": "user", "content": f"SOURCE MATERIAL:\n{summary}\n\n{fix}"}]
    disabled = sanitize_disabled(disabled_layouts)
    disabled_photo_ids = sanitize_disabled_photos(disabled_photos)
    extra = [c["key"] for c in auto_custom_slides(custom_slides)]
    return _extract_plan(_call(client, build_system(length, tone, instructions, custom_rules,
                                                    disabled, custom_slides, custom_photos,
                                                    preferred_layouts, design, disabled_photos,
                                                    preferred_photos, layout_overrides), user, model,
                               max_tokens, disabled, extra, custom_photo_ids(custom_photos),
                               disabled_photo_ids, layout_overrides))


def revise_plan_visual(client: anthropic.Anthropic, summary: str, prior: dict, findings: list[dict], *,
                       length: str = "standard", tone: str = "balansert", instructions: str = "",
                       custom_rules: str = "", disabled_layouts=None, custom_slides=None,
                       custom_photos=None, preferred_layouts=None, design=None,
                       disabled_photos=None, preferred_photos=None, layout_overrides=None,
                       model: str | None = None) -> dict:
    """Fix the specific slides a VISUAL QA pass flagged (overflow / collision / truncation /
    mismatched icon). Same discipline as revise_plan: touch only the listed slides."""
    target = config.SLIDE_TARGETS.get(length, 9)
    max_tokens = _max_tokens(target)
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
    disabled = sanitize_disabled(disabled_layouts)
    disabled_photo_ids = sanitize_disabled_photos(disabled_photos)
    extra = [c["key"] for c in auto_custom_slides(custom_slides)]
    return _extract_plan(_call(client, build_system(length, tone, instructions, custom_rules,
                                                    disabled, custom_slides, custom_photos,
                                                    preferred_layouts, design, disabled_photos,
                                                    preferred_photos, layout_overrides), user, model,
                               max_tokens, disabled, extra, custom_photo_ids(custom_photos),
                               disabled_photo_ids, layout_overrides))
