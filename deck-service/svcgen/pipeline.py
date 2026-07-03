"""Superba hybrid SVG deck pipeline (production entrypoint for deck-service).

HERO slides (cover/section/ending) = frozen AKBM-signature templates, copy filled.
BODY slides (stat/evidence/benefit/content/two_col) = generated SVG against a fixed
house style, with the vision quality gate + retry.
CHART slides = deterministic clustered-column render from planner data.

generate(client, summary_text, base_name, length, tone) -> dict(pptx, filename,
wording_md, slide_count). Self-contained: bundled templates + assets, native
SVG->PPTX via the vendored svg_to_pptx (no cairosvg). The gate degrades to a no-op
if resvg is unavailable on the host.
"""
from __future__ import annotations

import os
import re
import shutil
import sys
import tempfile
import pathlib

import anthropic

from . import quality_gate as qg
from . import template_fill as tf
from . import chart_render as cr

PKG = pathlib.Path(__file__).resolve().parent
ASSETS = PKG / "assets"
VENDOR = PKG.parent / "vendor"

MODEL = os.environ.get("SVCGEN_MODEL", "claude-sonnet-4-6")
MAX_SLIDE_ATTEMPTS = int(os.environ.get("SVCGEN_MAX_ATTEMPTS", "3"))

HERO_FIELDS = {"cover": ["TITLE", "SUBTITLE"], "section": ["KICKER", "SECTION_TITLE"],
               "ending": ["CTA_TITLE", "CONTACT", "DISCLAIMER"]}
# Photo library the planner picks from per hero slide. EXTENSIBLE: as AKBM sends real
# photos, drop the file in assets/ and add one line here — the planner's photo enum AND
# its prompt list are both generated from this dict, so nothing else needs editing.
PHOTOS = {
    "capsules":     {"file": "photo_capsules.jpg",      "desc": "red krill-oil softgel capsules scattered (product hero)"},
    "capsules_duo": {"file": "capsules_two_clean.png",  "desc": "two clean red softgels on white (crisp product close-up)"},
    "lifestyle":    {"file": "photo_lifestyle.jpg",     "desc": "active woman outdoors checking her watch (everyday wellness, heart)"},
    "iceberg":      {"file": "iceberg_antarctic.jpeg",  "desc": "Antarctic iceberg over cold ocean (krill origin, sustainability, deep sea)"},
    "deep_sea":     {"file": "deep_sea_light_rays.png", "desc": "underwater deep-sea light rays (origin, science, calm)"},
    "skin":         {"file": "skin_woman_face.jpeg",    "desc": "woman with glowing skin touching her face (skin / beauty benefit)"},
    "ingredients":  {"file": "ingredients_flatlay.png", "desc": "natural ingredients flat-lay: citrus, herbs, oil (natural, clean label)"},
    "krill_macro":  {"file": "krill_macro_teal.png",    "desc": "a single krill macro on teal water (nature, science)"},
}
PHOTO_DEFAULT = {"cover": "capsules", "section": "lifestyle"}
_PHOTO_LIST = "\n".join(f"    {k} — {v['desc']}" for k, v in PHOTOS.items())


def _photo_file(key: str, template: str) -> str:
    """Resolve a planner photo key to a bundled filename, with a per-template fallback."""
    entry = PHOTOS.get(key) or PHOTOS[PHOTO_DEFAULT[template]]
    return entry["file"]

CLAIM_RULES = """CLAIM FIDELITY (non-negotiable):
- Every number, effect and citation must be TRUE to the summary. Reframing a true figure into a clearer
  equivalent is ALLOWED and encouraged when correct and not misleading (e.g. 4.9%->8.1% may be shown as
  "+3.2 points" or "+65% relative"). Only FALSE / unsupported / misleading is banned (never invent a
  "threshold", never attach a number to the wrong metric, never pair an unrelated big number with a headline
  so they read as one claim).
- EFSA: only state an EFSA-approved claim when the summary explicitly says so (in the Superba portfolio only
  Heart and Liver carry EFSA-approved claims); never imply approval otherwise. Null/negative results kept
  honestly. Never invent a citation, journal, or year."""

HOUSE_STYLE = """SUPERBA HOUSE STYLE (match the deck's frozen hero slides exactly):
- Palette ONLY: Deep Sea Green #163536 (primary dark bg), Polar Blue #E9F7F8 (light bg), Sea Blue #175969,
  Regal Blue #003462, Ruby Red #E30917 (thin accent bars / keywords), Alt Red #BD393F (only red as a solid
  fill), Turquoise #60A09B / #A9DBD5, Peach #FFD1B0.
- Background (brand "deep sea gradient", §4.1) — on a DARK slide do NOT use a flat fill. Begin the SVG with
  <defs><radialGradient id="seabg" cx="32%" cy="24%" r="95%"><stop offset="0%" stop-color="#1f4b47"/><stop offset="55%" stop-color="#173636"/><stop offset="100%" stop-color="#0f2a2a"/></radialGradient></defs>
  and fill the full-canvas background rect with fill="url(#seabg)". LIGHT slides use flat #E9F7F8. Optionally add ONE
  subtle red "krill swarm" glow in an EMPTY corner: an <ellipse> with a red radial gradient fading to stop-opacity 0
  (soft, atmospheric, never over text or a number).
- Fonts: font-family="Exo 2" italic bold for titles + big numbers; font-family="Manrope" for body/labels.
- Titles are italic Exo 2. Do NOT underline a title (or a word) with a short accent bar — see BANNED in the
  visual system. Benefit areas use a hexagon icon. Alternate dark/light backgrounds across the deck for rhythm.
- Benefit hexagon icons by bare filename via <image xlink:href>: heart/liver/joint/muscle/skin.png — use ONLY
  where a benefit area is named. NEVER draw a wordmark or logo yourself: the Superba + Aker footer logos are
  stamped in automatically, so just LEAVE THE BOTTOM 58px OF THE CANVAS CLEAR (nothing important below y=662).
- DESIGN DISCIPLINE (this is what separates a designed slide from a generic AI one — follow it strictly):
  * NO multi-card grids. Do NOT arrange content as multiple parallel rounded boxes (3-card row, 4-up KPI grid,
    2x2 matrix of cards, or a big card holding a stack of sub-cards). That uniform card-grid IS the "AI look".
  * ONE visual-weight tool per container: shadow OR border OR tint-fill OR gradient — never stack them on one
    box. Most text needs NO box at all; naked text on the background reads cleaner and more premium.
  * ONE focal point per slide: the single most important thing (a hero number, the chart, the claim) is clearly
    the largest / boldest; everything else is visibly secondary. Never 4-6 equal-weight boxes competing.
  * Restraint over density: whitespace is a design element, not a gap to fill. NEVER repeat the same fact twice
    on one slide, and never pad with a box you don't need.
  * Accent red is punctuation — a thin bar or one keyword, a few % of the canvas. Don't tint every box and
    don't give boxes arbitrary different colours."""

OVERFLOW_RULES = """LAYOUT SAFETY (hard):
- Canvas 1280x720; keep content within a 64px margin (x:[64..1216]). ONE <text> per logical block.
- SVG text does NOT auto-wrap: size titles so the longest line fits; hand-break long lines into stacked
  <text> lines. Keep >=32px padding inside any card/hexagon. A big number and its unit are ONE <text>
  (e.g. "8.1%", "+3.2 pts") — never split them.
- If the slide has a right-side panel/card column, the title and left-column text MUST fit in the space to
  the LEFT of that panel — shrink or hand-wrap the title so NO glyph runs under or into the panel."""

VISUAL_SYSTEM = """VISUAL SYSTEM (hold these constant on every body slide so the freely-designed slides cohere):
- Type scale: slide title = Exo 2 italic 700 ~40-46px; eyebrow/kicker = Manrope 700 ~15px UPPERCASE
  letter-spaced, Ruby-Red; body = Manrope ~20-22px; small labels/captions = Manrope ~14-15px in Turquoise-Light
  #A9DBD5; hero numbers = Exo 2 italic 700, very large (90-180px), Polar-Blue #E9F7F8 or Peach #FFD1B0 on dark.
- Content margin = 64px; align to a consistent baseline; whitespace is deliberate, not a gap to fill.
- Dark deep-sea-gradient background is the DEFAULT; use a light (#E9F7F8 field, #163536 text) slide now and
  then for rhythm. Benefit hexagon only where a benefit is named; at most one subtle krill-swarm glow in a corner.

BANNED — these are the #1 'AI-generated' tells, NEVER use them:
- A short accent bar / underline under a title or under a single word (e.g. a ~70px red line beneath the title).
- A short red vertical tick to the left of a caption or paragraph.
  For emphasis use WHITESPACE, or a thin hairline rule spanning the FULL width of the content column, or a
  vertical divider between columns — never a stubby bar tied to one word or line.

HUMAN / EDITORIAL DEVICES — use where they genuinely fit; these read as hand-made, not machine-made:
- Annotation arrows: a trend/flow arrow over or along a chart with a small callout (e.g. an ellipse labelled
  'CAGR +7%'); a curved or straight arrow that points at the thing it explains.
- Connector arrows / chevrons between two panels to show flow, cause->effect, or a relationship.
- Circular icon badges beside list items (a small filled circle holding one simple glyph).
- A right-hand 'Comments' / 'Notes' column separated from the main content by a thin vertical divider rule.
- Full-width or full-height hairline rules to structure the page, the way a consultancy/report deck does."""

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "deck_title": {"type": "string"},
        "slides": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["hero", "body"]},
                    "rhythm": {"type": "string", "enum": ["anchor", "dense", "breathing"],
                               "description": "Visual density. Heroes=anchor. Body: 'dense'=2-4 proof points allowed; 'breathing'=ONE focal idea, NO card grid. Vary it across the deck: <=2 dense in a row, include breathing slides."},
                    "template": {"type": "string", "enum": ["cover", "section", "ending"]},
                    "fields": {"type": "object", "additionalProperties": {"type": "string"}},
                    "photo": {"type": "string", "enum": list(PHOTOS),
                              "description": "For a cover/section hero: the photo whose subject best fits this slide's theme."},
                    "role": {"type": "string",
                             "description": "A short slug naming the LAYOUT CONCEPT you invent for this body slide (e.g. 'evidence_timeline', 'crp_comparison', 'null_result', 'mechanism', 'study_spotlight', 'quote', 'hero_stat'). Free text, used as a label. Use exactly 'chart' to request the deterministic clustered-column chart."},
                    "brief": {"type": "string",
                              "description": "The full creative brief: the EXACT claims/numbers to show (traceable to the summary) AND the layout/visualization you intend to build for them (a timeline, a before/after comparison, an annotated figure, a quadrant, a hero number, etc.)."},
                    "chart": {
                        "type": "object",
                        "description": "REQUIRED when role='chart'. Clustered-column chart; values MUST be exact figures from the summary.",
                        "properties": {
                            "title": {"type": "string"}, "kicker": {"type": "string"},
                            "categories": {"type": "array", "items": {"type": "string"}},
                            "series": {"type": "array", "items": {"type": "object", "properties": {
                                "name": {"type": "string"},
                                "role": {"type": "string", "enum": ["treatment", "comparator"]},
                                "values": {"type": "array", "items": {"type": "number"}}},
                                "required": ["name", "values"]}},
                            "unit": {"type": "string"},
                            "callout": {"type": "array", "items": {"type": "object", "properties": {
                                "value": {"type": "string"}, "label": {"type": "string"}}}},
                            "source": {"type": "string"},
                        },
                    },
                    "benefit": {"type": "string", "enum": ["heart", "joint", "liver", "muscle", "skin", "none"]},
                    "notes": {"type": "string"},
                },
                "required": ["kind"],
            },
        },
    },
    "required": ["deck_title", "slides"],
}

PLANNER_SYS = f"""You plan a branded Superba Krill (Aker BioMarine) SALES deck from a verified science summary.
Emit ONLY via the emit_plan tool. The deck is built two ways and you drive both:
- HERO slides use FROZEN on-brand templates — you only supply the copy (fields). Templates + fields:
  cover: TITLE, SUBTITLE | section: KICKER, SECTION_TITLE | ending: CTA_TITLE, CONTACT, DISCLAIMER.
- BODY slides are free-form vector SVG, designed slide-by-slide. For each, DESIGN THE RIGHT LAYOUT for its
  content — invent it (an evidence timeline, a before/after comparison, an annotated mechanism, a quadrant, a
  study spotlight, a hero statistic, a pull-quote…). Do NOT pick from a fixed menu of templates. Engage with
  THIS content: a chronological set of studies wants a timeline; a treatment-vs-control result wants a
  comparison; an honest null finding wants a single-stat callout. Give each body slide a short `role` slug (your
  layout's name) + a rich `brief` stating the exact claims/numbers AND the visualization you intend.
- OPTIONAL deterministic chart: only if a clean clustered-column bar chart is genuinely the best fit, set
  role='chart' and fill the `chart` object with exact values. Otherwise design the figure yourself in the brief.

STRUCTURE: open with a `cover` hero, close with an `ending` hero; use `section` heroes as dividers; put proof
in body slides. Benefit-first for sales tone; comprehensive + per-study for scientific tone. Keep hero copy short.

PHOTOS: for each cover/section hero, set `photo` to the image whose subject best fits that slide's theme —
match, don't default (a sustainability/origin section → iceberg or deep_sea; a skin-benefit deck → skin;
a product/CTA slide → capsules or capsules_duo; everyday-wellness → lifestyle). Options:
{_PHOTO_LIST}

RHYTHM (critical — this is what stops the deck looking AI-generated): tag EVERY slide with `rhythm`. Heroes
are `anchor`. For body slides, ALTERNATE `dense` and `breathing` — never more than two `dense` in a row, and
include at least one or two `breathing` slides in the deck. A `breathing` slide is built on ONE focal idea (a
single hero stat, one chart, one short claim, or a photo with a one-line caption) — NOT a grid of cards. A
`dense` slide may carry 2-4 DISTINCT proof points. Do NOT put the same fact in two places on one slide, and do
NOT repeat a proof point another slide already made — every slide earns its place with distinct content. Push
heavy detail (effect sizes, CI, p-values, dose, design, citation) into `notes`.

{CLAIM_RULES}

Aim for the requested slide count. Emit the plan now."""


def _strip(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[1].rsplit("```", 1)[0]
    i = s.find("<svg")
    s = s[i:] if i >= 0 else s
    return re.sub(r"<!--.*?-->", "", s, flags=re.DOTALL).strip()


def build_plan(client, summary, length="standard", tone="balansert"):
    targets = {"kort": 6, "standard": 9, "detaljert": 13}
    brief = f"BRIEF: about {targets.get(length, 9)} slides; tone={tone}."
    msg = client.messages.create(
        model=MODEL, max_tokens=8000, system=PLANNER_SYS,
        tools=[{"name": "emit_plan", "description": "Emit the hybrid deck plan.", "input_schema": PLAN_SCHEMA}],
        tool_choice={"type": "tool", "name": "emit_plan"},
        messages=[{"role": "user", "content": f"SCIENCE SUMMARY:\n{summary}\n\n{brief}"}],
    )
    for b in msg.content:
        if b.type == "tool_use" and isinstance(b.input, dict) and b.input.get("slides"):
            return b.input
    raise ValueError("Planner returned no slides.")


RHYTHM_NOTE = {
    "breathing": ("SLIDE RHYTHM = BREATHING: build this on ONE focal idea (a single large number, one chart, "
                  "one short claim, or a photo with a one-line caption). Use naked text, a divider and "
                  "whitespace as the structure — NO grid of cards. Calm and confident, lots of air."),
    "dense": ("SLIDE RHYTHM = DENSE: you may present 2-4 DISTINCT proof points, but as varied elements — not "
              "identical rounded cards — and with ONE clear focal point sitting above the rest."),
    "anchor": "SLIDE RHYTHM = ANCHOR: one unique, high-impact composition — never a card grid.",
}


def _exec_body(client, summary, layout, brief, benefit, rhythm="dense", *, prior=None, fixes=None):
    sys_p = ("You are a senior editorial / infographic designer. Design ONE slide as a single self-contained SVG "
             "(xmlns+xmlns:xlink, viewBox=\"0 0 1280 720\"). INVENT the layout that best communicates this slide's "
             "content — a timeline, a before/after comparison, an annotated figure, a quadrant, a hero statistic, "
             "a pull-quote, whatever fits; never fall back on a generic template or a row of identical cards. It "
             "must sit inside the same branded deck as the frozen hero slides. Return ONLY the SVG (starts <svg, "
             "ends </svg>), no prose, no code fences.\n\n"
             + VISUAL_SYSTEM + "\n\n" + HOUSE_STYLE + "\n\n" + CLAIM_RULES + "\n\n" + OVERFLOW_RULES)
    content = (f"SCIENCE SUMMARY (source of every claim):\n{summary}\n\n{RHYTHM_NOTE.get(rhythm, '')}\n\n"
               f"Design this slide (layout concept: {layout}):\n{brief}\n"
               f"Benefit area (for hexagon icon, or 'none'): {benefit}")
    if prior is not None:
        content += ("\n\nYour previous SVG had these mechanical defects (fix EVERY one, keep the visual system, "
                    "keep number+unit in one <text>, keep the bottom 58px clear):\n" + fixes
                    + "\n\nPREVIOUS SVG:\n" + prior)
    msg = client.messages.create(model=MODEL, max_tokens=8000, system=sys_p,
                                 messages=[{"role": "user", "content": content}])
    return _strip(next(b.text for b in msg.content if b.type == "text"))


def _inject_footer(svg: str) -> str:
    """Stamp the canonical Superba+Aker footer logos deterministically (brand is guaranteed,
    not left to the model). Idempotent: strips any logo images first, then appends the fixed
    footer, picking white/green by whether the slide background is light."""
    svg = _strip_stub_bars(svg)
    svg = re.sub(r'<image\b[^>]*(?:superba|aker)_\w+\.png[^>]*/>', '', svg)
    dark = "#E9F7F8" not in svg[:800] and "#e9f7f8" not in svg[:800]
    return svg.replace("</svg>", tf.footer(dark=dark) + "</svg>", 1) if "</svg>" in svg else svg


def _strip_stub_bars(svg: str) -> str:
    """Hard-guarantee the BANNED 'stubby accent bar / red left-tick' AI-tell cannot survive,
    even if the model ignored the instruction. Drops small red <rect>s (a short bar/tick), while
    keeping long full-width/height hairline rules and everything non-red."""
    reds = ("e30917", "e50a1a", "bd393f", "f2242f")

    def num(t, name):
        m = re.search(rf'{name}="(-?[\d.]+)"', t)
        return float(m.group(1)) if m else None

    def drop_rect(m):
        t = m.group(0)
        f = re.search(r'fill="#?([0-9a-fA-F]{6})"', t)
        w, h = num(t, "width"), num(t, "height")
        if f and w is not None and h is not None and f.group(1).lower() in reds:
            if min(w, h) <= 8 and max(w, h) <= 140:  # stubby bar/tick, not a full-width rule
                return ""
        return t

    def drop_line(m):
        t = m.group(0)
        s = re.search(r'stroke="#?([0-9a-fA-F]{6})"', t)
        x1, y1, x2, y2 = num(t, "x1"), num(t, "y1"), num(t, "x2"), num(t, "y2")
        if s and s.group(1).lower() in reds and None not in (x1, y1, x2, y2):
            if ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5 <= 140:  # short red tick/underline
                return ""
        return t

    svg = re.sub(r'<rect\b[^>]*/>', drop_rect, svg)
    svg = re.sub(r'<line\b[^>]*/>', drop_line, svg)
    return svg


def _gated_write(client, path, out, make_first, make_retry):
    svg = make_first()
    best, best_n = svg, None
    for attempt in range(1, MAX_SLIDE_ATTEMPTS + 1):
        path.write_text(svg, encoding="utf-8")
        verdict, png = qg.check_slide(client, path, out, model=MODEL)
        n = 999 if not png else len(verdict.get("defects", []))
        if best_n is None or n < best_n:
            best, best_n = svg, n
        if verdict.get("passed") and not verdict.get("defects"):
            return
        if attempt == MAX_SLIDE_ATTEMPTS:
            break
        svg = make_retry(svg, qg.format_defects(verdict.get("defects", [])))
    path.write_text(best, encoding="utf-8")


def _load_converter():
    if str(VENDOR) not in sys.path:
        sys.path.insert(0, str(VENDOR))
    import svg_to_pptx  # noqa: E402 — vendored, resolved via VENDOR on sys.path
    return svg_to_pptx


def _wording(plan):
    lines = [f"# {plan.get('deck_title', 'Superba deck')} — wording review", ""]
    for i, s in enumerate(plan.get("slides", []), 1):
        note = (s.get("notes") or "").strip()
        if note:
            lines += [f"## Slide {i}", note, ""]
    return "\n".join(lines).strip() + "\n"


def generate(client: anthropic.Anthropic, summary_text: str, base_name: str,
             *, length: str = "standard", tone: str = "balansert", on_progress=None) -> dict:
    """on_progress(pct:int, step:str) is called as generation advances (optional)."""
    def _p(pct, step):
        if on_progress:
            try:
                on_progress(pct, step)
            except Exception:  # noqa: BLE001 — progress reporting must never break generation
                pass

    _p(3, "Planning the deck")
    plan = build_plan(client, summary_text, length, tone)
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="svcgen_"))
    out = tmp / "svg_output"
    out.mkdir(parents=True)
    for a in ASSETS.iterdir():
        if a.is_file():
            shutil.copy(a, out / a.name)
    try:
        n = len(plan["slides"])
        idx = 0
        for s in plan["slides"]:
            idx += 1
            _p(5 + int(86 * (idx - 1) / max(1, n)), f"Building slide {idx} of {n}")
            kind = s.get("kind")
            if kind == "hero" and s.get("template") in HERO_FIELDS:
                t = s["template"]
                f = s.get("fields") or {}
                path = out / f"{idx:02d}_{t}.svg"
                if t == "cover":
                    photo = _photo_file(s.get("photo"), "cover")
                    make = lambda f=f, photo=photo: tf.render_cover(f.get("TITLE", ""), f.get("SUBTITLE", ""), photo)
                elif t == "section":
                    photo = _photo_file(s.get("photo"), "section")
                    make = lambda f=f, photo=photo: tf.render_section(f.get("KICKER", ""), f.get("SECTION_TITLE", ""), photo)
                else:
                    fields = {k: f.get(k, "") for k in HERO_FIELDS[t] + list(tf.HERO_WRAPS.get(t, {}))}
                    wraps = tf.HERO_WRAPS.get(t, {})
                    make = lambda fields=fields, wraps=wraps: tf.fill_template("ending", fields, tf.HERO_FITS["ending"], wraps)
                _gated_write(client, path, out, make, lambda prior, fixes, make=make: make())
            elif s.get("role") == "chart" and s.get("chart"):
                path = out / f"{idx:02d}_chart.svg"
                make = lambda s=s: cr.render_chart(s["chart"])
                _gated_write(client, path, out, make, lambda prior, fixes, make=make: make())
            else:
                layout = s.get("role") or "content"
                slug = re.sub(r"[^a-z0-9]+", "_", layout.lower()).strip("_") or "slide"
                brief = s.get("brief") or ""
                benefit = (s.get("benefit") or "none").lower()
                rhythm = (s.get("rhythm") or "dense").lower()
                path = out / f"{idx:02d}_{slug}.svg"
                _gated_write(
                    client, path, out,
                    lambda layout=layout, brief=brief, benefit=benefit, rhythm=rhythm: _inject_footer(_exec_body(client, summary_text, layout, brief, benefit, rhythm)),
                    lambda prior, fixes, layout=layout, brief=brief, benefit=benefit, rhythm=rhythm: _inject_footer(_exec_body(client, summary_text, layout, brief, benefit, rhythm, prior=prior, fixes=fixes)),
                )
        _p(93, "Converting to PowerPoint")
        _load_converter().main([str(tmp)])
        pptx_files = sorted((tmp / "exports").glob("*.pptx"))
        if not pptx_files:
            raise RuntimeError("svg_to_pptx produced no .pptx")
        pptx = pptx_files[-1].read_bytes()
        _p(99, "Finalizing")
        return {"pptx": pptx, "filename": f"{base_name}.pptx",
                "wording_md": _wording(plan), "slide_count": len(plan["slides"])}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
