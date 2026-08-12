"""Step 3 — slide plan schema + renderer layout catalog.

Derives everything from config/template_inventory.json so nothing is hardcoded to Superba
(swap the template + re-run inspect_template.py + this, and the schema/catalog regenerate).

Produces two artifacts:
  config/slide_schema.json    JSON Schema — the planner's tool definition AND the renderer's
                              validation contract. Per-layout required fields + maxLength
                              (char limits) enforced via allOf/if-then.
  config/layout_catalog.json  The renderer's map: semantic layout -> template layout name +
                              field->placeholder-idx + column grouping + which backgrounds
                              (dark master #0 / light master #1) are available.

Char limits are geometric: a box W x H inches at font F pt holds
  chars/line = W*72 / (F*0.50)   (0.50 em average glyph advance)
  lines      = H*72 / (F*1.20)   (1.20 line spacing)
capped by a per-role max-lines and a 0.85 safety fill, then clamped to a sane range. This
guarantees the planner's text fits the real placeholder (overflow is the #1 failure mode).

    python scripts/build_schema.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from src import brand as _brand  # noqa: E402  (needs ROOT on the path first)
from src import config as _cfg  # noqa: E402

# Footer / date / slide-number placeholders — never filled, never removed (they inherit the
# brand footer + slide number from the master). Everything else is content.
CHROME_IDX = {10, 11, 12}

# The 10-12 LLM-facing layouts (justified in README): semantic name -> template layout + kind.
# Kept deliberately small; more choices degrade the model's layout selection.
#
# HAND-AUTHORED, PER BRAND, and the one part of the config that cannot be generated: only a
# person can say which of a template's layouts is "the agenda". A brand simply omits any
# semantic layout its template has no home for — the code-built layouts cover that ground, and
# main() prints what was skipped rather than failing.
LAYOUTS_BY_BRAND = {
    "superba": {
        "title":              {"tpl": "Title Slide 1",       "kind": "title"},
        "section":            {"tpl": "Section Header 1",    "kind": "section"},
        "agenda":             {"tpl": "Agenda 1",            "kind": "agenda"},
        "highlight":          {"tpl": "Highlight Text",      "kind": "highlight"},
        "title_only":         {"tpl": "Title Only 1",        "kind": "title_only"},
        "text":               {"tpl": "Text Slide 1",        "kind": "text"},
        "text_with_picture":  {"tpl": "Text With Picture 1", "kind": "text_picture"},
        "picture_full":       {"tpl": "Text With Picture 3", "kind": "picture_full"},
        "two_columns":        {"tpl": "Two Columns",         "kind": "columns", "n": 2},
        "three_columns":      {"tpl": "Three Columns",       "kind": "columns", "n": 3},
        "four_columns":       {"tpl": "Four Columns",        "kind": "columns", "n": 4},
    },
    # Revervia's template offers 6 near-identical cover variants and 8 section-break variants,
    # but only four real content layouts — so it natively covers 7 of the 11 roles above. The
    # gaps (two_columns, four_columns, picture_full) are exactly what the 31 code-built layouts
    # already do better, so nothing is lost by leaving them unmapped.
    # `agenda` and `text` deliberately share Content 3: it is the template's only plain
    # title-plus-body layout, and an agenda IS a titled list. They stay separate semantic
    # layouts because their kinds fill it differently.
    "revervia": {
        "title":              {"tpl": "Title 1",             "kind": "title"},
        "section":            {"tpl": "Section Break 1",     "kind": "section"},
        "agenda":             {"tpl": "Content 3",           "kind": "agenda"},
        "highlight":          {"tpl": "Highlight 2",         "kind": "highlight"},
        "title_only":         {"tpl": "Title Only",          "kind": "title_only"},
        "text":               {"tpl": "Content 3",           "kind": "text"},
        "text_with_picture":  {"tpl": "Content 4",           "kind": "text_picture"},
        "three_columns":      {"tpl": "Content 1",           "kind": "columns", "n": 3},
    },
}

def font_pt(brand: str | None = None) -> dict:
    """Point size the RENDERER will actually force for each text role, per brand — used only to
    size char limits. Not measured from the template's own inherited layout styles, because the
    renderer overrides those (the deck-wide 3-size rule). Derived from the brand theme so the two
    can never drift: a limit computed against the wrong size is either overflow or wasted space.

    Superba resolves to 60/32/16/14, i.e. exactly the table this replaced."""
    s = _brand.theme(brand)["sizes"]
    return {
        "cover_title": s["cover"], "agenda_title": s["cover"], "highlight_title": s["cover"],
        "content_title": s["title"], "section_title": s["title"],
        "subtitle": s["subtitle"], "heading": s["subtitle"], "section_body": s["subtitle"],
        "agenda_item": s["subtitle"],
        "body": s["body"], "object": s["body"], "small_body": s["body"],
    }


TITLE_FONT = {"title": "cover_title", "section": "section_title", "agenda": "agenda_title",
              "highlight": "highlight_title"}


def char_limit(w, h, pt, max_lines, fill=0.85, lo=16, hi=800, honor_height=True):
    """Chars a W x H inch box holds at `pt`. Titles auto-fit/wrap (honor_height=False → use
    max_lines directly); bodies overflow for real (honor_height=True → cap lines by height)."""
    if not w:
        return 60
    cpl = (w * 72) / (pt * 0.50)
    if honor_height and h:
        lines = min(max_lines, max(1, int((h * 72) // (pt * 1.20))))
    else:
        lines = max_lines
    return max(lo, min(hi, int(cpl * lines * fill)))


TITLE_LINES = {"highlight": 4, "picture_title": 1, "picture_full": 3, "text_picture": 3}


def load_primary_layouts(inv):
    si = inv.get("primary_master_index", inv.get("superba_master_index", 0))
    by_name = {}
    for lay in inv["layouts"]:
        if lay["master_index"] == si:
            by_name.setdefault(lay["name"], lay)
    light = {lay["name"] for lay in inv["layouts"] if lay["master_index"] != si}
    return by_name, light


def content_phs(layout):
    return [p for p in layout["placeholders"] if p["idx"] not in CHROME_IDX]


def classify(phs):
    """Split a layout's content placeholders into title/subtitle/headings/bodies/pics/objects."""
    title = subtitle = obj = None
    headings, bodies, pics = [], [], []
    for p in phs:
        t = (p["type"] or "").upper()
        h = p["height_in"] or 0
        if t in ("CENTER_TITLE", "TITLE") and title is None:
            title = p
        elif t == "SUBTITLE":
            subtitle = p
        elif t == "PICTURE":
            pics.append(p)
        elif t == "OBJECT":
            obj = p
        elif t == "BODY":
            (headings if h < 0.6 else bodies).append(p)
    for grp in (headings, bodies, pics):
        grp.sort(key=lambda p: (p["left_in"] or 0))
    return {"title": title, "subtitle": subtitle, "object": obj,
            "headings": headings, "bodies": bodies, "pics": pics}


def build(sem, spec, layout, light_names, FONT_PT):
    kind = spec["kind"]
    c = classify(content_phs(layout))
    fields, limits, cat_fields = {}, {}, {}
    title_font = FONT_PT[TITLE_FONT.get(sem, "content_title")]

    if c["title"]:
        if kind in ("title", "agenda"):
            # Narrow title box sitting flush above another element (cover: logo above +
            # subtitle below; agenda: the items list below). A 2-line title grows into the
            # neighbour, so cap to ONE line at the real font — these titles are short by design.
            limits["title"] = char_limit(c["title"]["width_in"], c["title"]["height_in"],
                                         title_font, 1, honor_height=True, fill=0.95, lo=6)
        else:
            limits["title"] = char_limit(c["title"]["width_in"], c["title"]["height_in"],
                                         title_font, TITLE_LINES.get(kind, 2), honor_height=False)
        cat_fields["title"] = c["title"]["idx"]

    if kind == "title":  # cover
        if c["subtitle"]:
            limits["subtitle"] = char_limit(c["subtitle"]["width_in"], c["subtitle"]["height_in"], FONT_PT["subtitle"], 1)
            cat_fields["subtitle"] = c["subtitle"]["idx"]
    elif kind == "section":
        pass  # title only — the layout's body placeholder is a large display style that breaks
              # with a sentence and collides with the title; leave it unfilled (renderer removes it).
    elif kind == "agenda":
        if c["bodies"]:
            b = c["bodies"][0]
            per = char_limit(b["width_in"], 0.4, FONT_PT["agenda_item"], 1)
            limits["items"] = {"maxItems": 7, "item_max": per}
            cat_fields["items"] = b["idx"]
    elif kind == "highlight":
        pass  # title only (big statement)
    elif kind == "title_only":
        pass
    elif kind == "text":
        if c["object"]:
            limits["body"] = char_limit(c["object"]["width_in"], c["object"]["height_in"], FONT_PT["object"], 9, hi=560)
            cat_fields["body"] = c["object"]["idx"]
    elif kind in ("text_picture",):
        if c["headings"]:
            limits["heading"] = char_limit(c["headings"][0]["width_in"], c["headings"][0]["height_in"], FONT_PT["heading"], 1, lo=12)
            cat_fields["heading"] = c["headings"][0]["idx"]
        if c["bodies"]:
            limits["body"] = char_limit(c["bodies"][0]["width_in"], c["bodies"][0]["height_in"], FONT_PT["body"], 9)
            cat_fields["body"] = c["bodies"][0]["idx"]
        if c["pics"]:
            cat_fields["picture"] = c["pics"][0]["idx"]
    elif kind in ("picture_title", "picture_full"):
        if c["pics"]:
            cat_fields["picture"] = c["pics"][0]["idx"]
    elif kind == "columns":
        n = spec["n"]
        cols = []
        body_font = FONT_PT["body"]
        head_lim = char_limit(c["headings"][0]["width_in"], c["headings"][0]["height_in"], FONT_PT["heading"], 1, lo=12) if c["headings"] else 34
        body_lim = char_limit(c["bodies"][0]["width_in"], c["bodies"][0]["height_in"], body_font, 8) if c["bodies"] else 200
        for i in range(n):
            col = {}
            if i < len(c["headings"]): col["heading"] = c["headings"][i]["idx"]
            if i < len(c["bodies"]):   col["body"] = c["bodies"][i]["idx"]
            if i < len(c["pics"]):     col["picture"] = c["pics"][i]["idx"]
            cols.append(col)
        cat_fields["columns"] = cols
        limits["columns"] = {"n": n, "heading_max": head_lim, "body_max": body_lim}

    backgrounds = ["dark"] + (["light"] if spec["tpl"] in light_names else [])
    catalog = {
        "template_layout": spec["tpl"],
        "kind": kind,
        "backgrounds": backgrounds,
        "fields": cat_fields,
        "limits": limits,   # per-field char limits — renderer truncates collision-prone labels
        "picture_slots": [p["idx"] for p in c["pics"]],
        "removable_idx": [p["idx"] for p in content_phs(layout)],  # any content ph not filled -> remove
    }
    return catalog, limits


def slide_conditional(sem, kind, limits, asset_ids, benefits, generic):
    """One allOf if/then block enforcing this layout's required fields + maxLengths."""
    props, required = {}, ["layout"]
    if "title" in limits:
        props["title"] = {"type": "string", "maxLength": limits["title"]}
        required.append("title")
    if "subtitle" in limits:
        props["subtitle"] = {"type": "string", "maxLength": limits["subtitle"]}
    if "heading" in limits:
        props["heading"] = {"type": "string", "maxLength": limits["heading"]}
    if "body" in limits:
        props["body"] = {"type": "string", "maxLength": limits["body"]}
        if kind in ("text",):
            required.append("body")
    if "items" in limits:
        props["items"] = {"type": "array", "minItems": 2, "maxItems": limits["items"]["maxItems"],
                          "items": {"type": "string", "maxLength": limits["items"]["item_max"]}}
        required.append("items")
    if "columns" in limits:
        cl = limits["columns"]
        props["columns"] = {
            "type": "array", "minItems": cl["n"], "maxItems": cl["n"],
            "items": {"type": "object", "required": ["heading", "body"], "additionalProperties": False,
                      "properties": {"heading": {"type": "string", "maxLength": cl["heading_max"]},
                                     "body": {"type": "string", "maxLength": cl["body_max"]},
                                     "icon": {"enum": benefits},
                                     "icon_generic": {"enum": generic}}}}
        required.append("columns")
    if kind in ("text_picture", "picture_title", "picture_full"):
        props["asset_id"] = {"enum": asset_ids + [None]}
        if kind in ("picture_title", "picture_full"):
            required.append("asset_id")
    return {"if": {"properties": {"layout": {"const": sem}}, "required": ["layout"]},
            "then": {"required": required, "properties": props}}


def main(brand: str | None = None):
    cfg_dir = _cfg.config_dir(brand)
    inv = json.loads((cfg_dir / "template_inventory.json").read_text(encoding="utf-8"))
    manifest = json.loads((cfg_dir / "asset_manifest.json").read_text(encoding="utf-8"))
    LAYOUTS = LAYOUTS_BY_BRAND.get(brand or _cfg.DEFAULT_BRAND, {})
    FONT_PT = font_pt(brand)
    if not LAYOUTS:
        sys.exit(f"No native layout map authored for brand {brand!r} — add one to LAYOUTS_BY_BRAND.")
    asset_ids = [a["id"] for a in manifest["assets"] if a.get("selectable") and a["kind"] == "photo"]
    benefits = manifest["benefits"] + ["none"]
    generic = manifest.get("generic_icons", []) + ["none"]

    by_name, light_names = load_primary_layouts(inv)
    catalog, conditionals, summary = {}, [], []
    for sem, spec in LAYOUTS.items():
        layout = by_name.get(spec["tpl"])
        if not layout:
            print(f"  !! template layout missing: {spec['tpl']} ({sem})"); continue
        cat, limits = build(sem, spec, layout, light_names, FONT_PT)
        catalog[sem] = cat
        conditionals.append(slide_conditional(sem, spec["kind"], limits, asset_ids, benefits, generic))
        summary.append((sem, spec["tpl"], cat["backgrounds"], limits))

    # 'ingredient' — the brand's real standard nutrient slide, spliced in VERBATIM by the renderer
    # (fixed product-composition content, not generated). The planner only picks the layout; any
    # copy it emits is ignored, so nothing is required or length-limited here.
    #
    # Omitted entirely for a brand whose template has no such slide. The catalog IS a brand's
    # layout vocabulary — the planner, the validator and the gallery all derive from it — so
    # leaving a layout in that the renderer must refuse puts the three out of step with each other.
    if _brand.theme(brand).get("has_ingredient_slide"):
        catalog["ingredient"] = {"template_layout": "Blank", "kind": "ingredient",
                                 "backgrounds": ["dark"], "fields": {}, "limits": {},
                                 "picture_slots": [], "removable_idx": []}
        conditionals.append({
            "if": {"properties": {"layout": {"const": "ingredient"}}, "required": ["layout"]},
            "then": {"required": ["layout"]}})
    summary.append(("ingredient", "Blank (verbatim AKBM slide)", ["dark"], {"content": "fixed"}))

    # --- Synthetic, code-built layouts (mechanism B) -----------------------------------------
    # NOT from the template: the renderer BUILDS these on a Blank layout (like 'ingredient') and
    # fills them from the plan (text into slots + AI-picked brand icons / native charts). Registered
    # here so the planner can choose them and the schema validates their fields.
    catalog["key_points"] = {"template_layout": "Blank", "kind": "key_points", "backgrounds": ["light"],
                             "fields": {}, "limits": {}, "picture_slots": [], "removable_idx": []}
    conditionals.append({
        "if": {"properties": {"layout": {"const": "key_points"}}, "required": ["layout"]},
        "then": {"required": ["layout", "title", "items"],
                 "properties": {
                     "title": {"type": "string", "maxLength": 50},
                     "banner": {"type": "string", "maxLength": 70},
                     "items": {"type": "array", "minItems": 3, "maxItems": 4,
                               "items": {"type": "object", "additionalProperties": False,
                                         "required": ["heading", "body"],
                                         "properties": {"heading": {"type": "string", "maxLength": 26},
                                                        "body": {"type": "string", "maxLength": 320},
                                                        "icon": {"enum": benefits},
                                                        "icon_generic": {"enum": generic}}}}}}})
    summary.append(("key_points", "Blank (code-built: 4 icon cards)", ["light"], {"items": "3-4 x {head,body,icon}"}))

    catalog["chart"] = {"template_layout": "Blank", "kind": "chart", "backgrounds": ["dark", "light"],
                        "fields": {}, "limits": {}, "picture_slots": [], "removable_idx": []}
    conditionals.append({
        "if": {"properties": {"layout": {"const": "chart"}}, "required": ["layout"]},
        "then": {"required": ["layout", "title", "categories", "series", "x_axis", "y_axis"],
                 "properties": {
                     "title": {"type": "string", "maxLength": 50},
                     "caption": {"type": "string", "maxLength": 100},
                     "x_axis": {"type": "string", "maxLength": 40},
                     "y_axis": {"type": "string", "maxLength": 40},
                     "chart_type": {"enum": ["column", "bar", "line", "stacked_column", "stacked_100", "doughnut"]},
                     "categories": {"type": "array", "minItems": 2, "maxItems": 8,
                                    "items": {"type": "string", "maxLength": 24}},
                     "series": {"type": "array", "minItems": 1, "maxItems": 4,
                                "items": {"type": "object", "additionalProperties": False,
                                          "required": ["name", "values"],
                                          "properties": {"name": {"type": "string", "maxLength": 40},
                                                         "values": {"type": "array", "items": {"type": "number"}}}}}}}})
    summary.append(("chart", "Blank (native pptx chart)", ["dark", "light"], {"data": "categories+series"}))

    # Batch 1 synthetic layouts (matrix / exec_summary / comparison).
    def _synth(name, kind, bg, required, props, note):
        # bg is a single theme name ("light") for the handful of layouts that can ONLY render on
        # the light master, or a list (["dark", "light"]) for the rest — the renderer.py _fill_*
        # function's own signature is the ground truth for which is which.
        backgrounds = bg if isinstance(bg, list) else [bg]
        catalog[name] = {"template_layout": "Blank", "kind": kind, "backgrounds": backgrounds,
                         "fields": {}, "limits": {}, "picture_slots": [], "removable_idx": []}
        conditionals.append({"if": {"properties": {"layout": {"const": name}}, "required": ["layout"]},
                             "then": {"required": required, "properties": props}})
        summary.append((name, f"Blank ({note})", backgrounds, {"fields": ",".join(required[1:])}))

    _synth("matrix", "matrix", ["dark", "light"], ["layout", "title", "quadrants"], {
        "title": {"type": "string", "maxLength": 50},
        "x_axis": {"type": "string", "maxLength": 40}, "y_axis": {"type": "string", "maxLength": 40},
        "quadrants": {"type": "array", "minItems": 4, "maxItems": 4, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading", "body"],
            "properties": {"heading": {"type": "string", "maxLength": 30},
                           "body": {"type": "string", "maxLength": 120}}}}}, "2x2 matrix")

    # The deck's REQUIRED executive summary (slide 2, right after the cover). Title is FIXED
    # ("Executive summary", stamped by the renderer) so it is deliberately absent here — like
    # `ingredient`, the model writes no title for it. Five fixed labelled rows, each a lead-in
    # label + 1-2 sentences; maxLengths sized so the 5 together cap just over the ~80-word target
    # (a safety ceiling against overflow, not the target itself — the prompt drives the real budget).
    _synth("exec_summary", "exec_summary", ["dark", "light"],
          ["layout", "source", "key_finding", "supporting_findings", "relevance", "contents"], {
        "source": {"type": "string", "maxLength": 110},
        "key_finding": {"type": "string", "maxLength": 140},
        "supporting_findings": {"type": "string", "maxLength": 140},
        "relevance": {"type": "string", "maxLength": 110},
        "contents": {"type": "string", "maxLength": 90},
    }, "executive summary: source/key_finding/supporting_findings/relevance/contents")

    _synth("comparison", "comparison", "light", ["layout", "title", "headers", "rows"], {
        "title": {"type": "string", "maxLength": 50},
        "headers": {"type": "array", "minItems": 2, "maxItems": 4, "items": {"type": "string", "maxLength": 30}},
        "rows": {"type": "array", "minItems": 1, "maxItems": 8, "items": {
            "type": "object", "additionalProperties": False, "required": ["cells"],
            "properties": {"cells": {"type": "array", "minItems": 2, "maxItems": 4,
                                     "items": {"type": "string", "maxLength": 70}}}}}}, "comparison table")

    # Batch 2 synthetic layouts (stat / harvey_ball / funnel).
    _synth("stat", "stat", ["dark", "light"], ["layout", "title", "stats"], {
        "title": {"type": "string", "maxLength": 50},
        "caption": {"type": "string", "maxLength": 90},
        "stats": {"type": "array", "minItems": 1, "maxItems": 3, "items": {
            "type": "object", "additionalProperties": False, "required": ["value", "label"],
            "properties": {"value": {"type": "string", "maxLength": 12},
                           "label": {"type": "string", "maxLength": 40},
                           "note": {"type": "string", "maxLength": 90}}}}}, "hero stats")

    _synth("harvey_ball", "harvey_ball", "light", ["layout", "title", "options", "criteria"], {
        "title": {"type": "string", "maxLength": 50},
        "options": {"type": "array", "minItems": 2, "maxItems": 4, "items": {"type": "string", "maxLength": 24}},
        "criteria": {"type": "array", "minItems": 2, "maxItems": 6, "items": {
            "type": "object", "additionalProperties": False, "required": ["label", "scores"],
            "properties": {"label": {"type": "string", "maxLength": 40},
                           "scores": {"type": "array", "minItems": 2, "maxItems": 4,
                                      "items": {"type": "integer", "minimum": 0, "maximum": 4}}}}}}, "harvey-ball grid")

    _synth("funnel", "funnel", ["dark", "light"], ["layout", "title", "stages"], {
        "title": {"type": "string", "maxLength": 50},
        "stages": {"type": "array", "minItems": 3, "maxItems": 5, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading"],
            "properties": {"heading": {"type": "string", "maxLength": 30},
                           "body": {"type": "string", "maxLength": 90}}}}}, "funnel")

    # Client-requested layouts.
    _synth("closing", "closing", ["dark", "light"], ["layout", "title"], {
        "title": {"type": "string", "maxLength": 50},
        "tagline": {"type": "string", "maxLength": 90},
        "contact": {"type": "string", "maxLength": 160}}, "closing / contact")

    # More MBB layouts.
    _synth("kpi_dashboard", "kpi_dashboard", ["dark", "light"], ["layout", "title", "metrics"], {
        "title": {"type": "string", "maxLength": 50},
        "caption": {"type": "string", "maxLength": 100},
        "metrics": {"type": "array", "minItems": 3, "maxItems": 6, "items": {
            "type": "object", "additionalProperties": False, "required": ["value", "label"],
            "properties": {"value": {"type": "string", "maxLength": 12},
                           "label": {"type": "string", "maxLength": 42},
                           "note": {"type": "string", "maxLength": 60}}}}}, "KPI dashboard tiles")

    _synth("roadmap", "roadmap", ["dark", "light"], ["layout", "title", "phases"], {
        "title": {"type": "string", "maxLength": 50},
        "phases": {"type": "array", "minItems": 2, "maxItems": 5, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading"],
            "properties": {"date": {"type": "string", "maxLength": 20},
                           "heading": {"type": "string", "maxLength": 26},
                           "body": {"type": "string", "maxLength": 170}}}}}, "roadmap phases (chevrons)")

    _synth("icon_grid", "icon_grid", ["dark", "light"], ["layout", "title", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "banner": {"type": "string", "maxLength": 90},
        "items": {"type": "array", "minItems": 3, "maxItems": 6, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading"],
            "properties": {"heading": {"type": "string", "maxLength": 28},
                           "body": {"type": "string", "maxLength": 150},
                           "icon": {"enum": benefits}, "icon_generic": {"enum": generic}}}}}, "icon tile grid")

    _synth("takeaways", "takeaways", ["dark", "light"], ["layout", "title", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "items": {"type": "array", "minItems": 2, "maxItems": 6, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading"],
            "properties": {"heading": {"type": "string", "maxLength": 90},
                           "body": {"type": "string", "maxLength": 170}}}}}, "numbered takeaways")

    _synth("from_to", "from_to", ["dark", "light"], ["layout", "title", "before", "after"], {
        "title": {"type": "string", "maxLength": 50},
        "before": {"type": "object", "additionalProperties": False, "required": ["heading"],
                   "properties": {"heading": {"type": "string", "maxLength": 40},
                                  "body": {"type": "string", "maxLength": 220}}},
        "after": {"type": "object", "additionalProperties": False, "required": ["heading"],
                  "properties": {"heading": {"type": "string", "maxLength": 40},
                                 "body": {"type": "string", "maxLength": 220}}}}, "from-to transformation")

    _synth("pillars", "pillars", ["dark", "light"], ["layout", "title", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "banner": {"type": "string", "maxLength": 90},
        "items": {"type": "array", "minItems": 2, "maxItems": 5, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading"],
            "properties": {"heading": {"type": "string", "maxLength": 28},
                           "body": {"type": "string", "maxLength": 220},
                           "icon": {"enum": benefits}, "icon_generic": {"enum": generic}}}}}, "pillars under a roof")

    _synth("team", "team", ["dark", "light"], ["layout", "title", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "items": {"type": "array", "minItems": 2, "maxItems": 4, "items": {
            "type": "object", "additionalProperties": False, "required": ["name"],
            "properties": {"name": {"type": "string", "maxLength": 36},
                           "role": {"type": "string", "maxLength": 46},
                           "bio": {"type": "string", "maxLength": 160}}}}}, "team member cards")

    _synth("metric_bars", "metric_bars", ["dark", "light"], ["layout", "title", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "caption": {"type": "string", "maxLength": 100},
        "items": {"type": "array", "minItems": 2, "maxItems": 6, "items": {
            "type": "object", "additionalProperties": False, "required": ["label", "pct"],
            "properties": {"label": {"type": "string", "maxLength": 46},
                           "value": {"type": "string", "maxLength": 16},
                           "pct": {"type": "number"},
                           "note": {"type": "string", "maxLength": 60}}}}}, "metric bars")

    _synth("cause_effect", "cause_effect", ["dark", "light"], ["layout", "title", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "items": {"type": "array", "minItems": 2, "maxItems": 4, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading", "body"],
            "properties": {"heading": {"type": "string", "maxLength": 40},
                           "body": {"type": "string", "maxLength": 170}}}}}, "cause and effect rows")

    _synth("org_chart", "org_chart", ["dark", "light"], ["layout", "title", "center", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "center": {"type": "string", "maxLength": 40},
        "items": {"type": "array", "minItems": 2, "maxItems": 4, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading"],
            "properties": {"heading": {"type": "string", "maxLength": 28},
                           "body": {"type": "string", "maxLength": 130}}}}}, "org chart")

    _synth("decision_tree", "decision_tree", ["dark", "light"], ["layout", "title", "center", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "center": {"type": "string", "maxLength": 44},
        "items": {"type": "array", "minItems": 2, "maxItems": 4, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading"],
            "properties": {"heading": {"type": "string", "maxLength": 30},
                           "body": {"type": "string", "maxLength": 150}}}}}, "decision tree")

    _synth("cycle", "cycle", ["dark", "light"], ["layout", "title", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "center": {"type": "string", "maxLength": 22},
        "items": {"type": "array", "minItems": 3, "maxItems": 6, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading"],
            "properties": {"heading": {"type": "string", "maxLength": 26},
                           "body": {"type": "string", "maxLength": 80}}}}}, "cycle around a hub")

    _synth("gantt", "gantt", ["dark", "light"], ["layout", "title", "periods", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "caption": {"type": "string", "maxLength": 100},
        "periods": {"type": "array", "minItems": 2, "maxItems": 8,
                    "items": {"type": "string", "maxLength": 14}},
        "items": {"type": "array", "minItems": 2, "maxItems": 8, "items": {
            "type": "object", "additionalProperties": False, "required": ["label", "start"],
            "properties": {"label": {"type": "string", "maxLength": 40},
                           "start": {"type": "integer", "minimum": 1},
                           "end": {"type": "integer", "minimum": 1},
                           "note": {"type": "string", "maxLength": 40},
                           "milestone": {"type": "boolean"}}}}}, "gantt / project schedule")

    _synth("serpentine", "serpentine", ["dark", "light"], ["layout", "title", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "items": {"type": "array", "minItems": 3, "maxItems": 4, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading"],
            "properties": {"date": {"type": "string", "maxLength": 16},
                           "heading": {"type": "string", "maxLength": 34},
                           "body": {"type": "string", "maxLength": 130},
                           "icon": {"enum": benefits}, "icon_generic": {"enum": generic}}}}},
           "serpentine S-curve flow")

    _synth("coverage_matrix", "coverage_matrix", "light", ["layout", "title", "headers", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "caption": {"type": "string", "maxLength": 100},
        "headers": {"type": "array", "minItems": 2, "maxItems": 8, "items": {"type": "string", "maxLength": 18}},
        "items": {"type": "array", "minItems": 2, "maxItems": 5, "items": {
            "type": "object", "additionalProperties": False, "required": ["label", "marks"],
            "properties": {"label": {"type": "string", "maxLength": 26},
                           "body": {"type": "string", "maxLength": 110},
                           "marks": {"type": "array", "minItems": 2, "maxItems": 8,
                                     "items": {"type": "boolean"}}}}}}, "coverage tick matrix")

    _synth("photo_stats", "photo_stats", ["dark", "light"], ["layout", "title", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "caption": {"type": "string", "maxLength": 110},
        "items": {"type": "array", "minItems": 2, "maxItems": 3, "items": {
            "type": "object", "additionalProperties": False, "required": ["value", "label"],
            "properties": {"value": {"type": "string", "maxLength": 10},
                           "label": {"type": "string", "maxLength": 32},
                           "note": {"type": "string", "maxLength": 90},
                           "asset_id": {"enum": asset_ids + [None]}}}}}, "photo-topped stat cards")

    _synth("numbered_cards", "numbered_cards", ["dark", "light"], ["layout", "title", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "items": {"type": "array", "minItems": 2, "maxItems": 4, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading"],
            "properties": {"heading": {"type": "string", "maxLength": 40},
                           "body": {"type": "string", "maxLength": 190},
                           "icon": {"enum": benefits}, "icon_generic": {"enum": generic}}}}},
           "numbered cards with corner icon")

    _synth("implications", "implications", ["dark", "light"], ["layout", "title", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "headers": {"type": "array", "minItems": 3, "maxItems": 3, "items": {"type": "string", "maxLength": 26}},
        "items": {"type": "array", "minItems": 2, "maxItems": 5, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading", "body", "implication"],
            "properties": {"heading": {"type": "string", "maxLength": 34},
                           "body": {"type": "string", "maxLength": 240},
                           "implication": {"type": "string", "maxLength": 130}}}}},
           "trend / overview / implication rows")

    _synth("breakdown", "breakdown", ["dark", "light"], ["layout", "title", "total", "items"], {
        "title": {"type": "string", "maxLength": 50},
        "total": {"type": "string", "maxLength": 12},
        "caption": {"type": "string", "maxLength": 60},
        "items": {"type": "array", "minItems": 2, "maxItems": 6, "items": {
            "type": "object", "additionalProperties": False, "required": ["label", "pct"],
            "properties": {"label": {"type": "string", "maxLength": 34},
                           "pct": {"type": "number"}}}}}, "total broken into shares")

    _synth("chart_bands", "chart_bands", ["dark", "light"], ["layout", "title", "categories", "values", "bands"], {
        "title": {"type": "string", "maxLength": 50},
        "caption": {"type": "string", "maxLength": 110},
        "y_axis": {"type": "string", "maxLength": 40},
        "categories": {"type": "array", "minItems": 3, "maxItems": 16,
                       "items": {"type": "string", "maxLength": 10}},
        "values": {"type": "array", "minItems": 3, "maxItems": 16, "items": {"type": "number"}},
        "bands": {"type": "array", "minItems": 1, "maxItems": 4, "items": {
            "type": "object", "additionalProperties": False, "required": ["label", "start", "end"],
            "properties": {"label": {"type": "string", "maxLength": 30},
                           "start": {"type": "integer", "minimum": 1},
                           "end": {"type": "integer", "minimum": 1}}}}},
           "column chart with narrative phase bands")

    _synth("chart_takeaways", "chart_takeaways", "light",
           ["layout", "title", "x_axis", "y_axis", "bubbles", "takeaways"], {
        "title": {"type": "string", "maxLength": 50},
        "headers": {"type": "array", "minItems": 2, "maxItems": 2,
                    "items": {"type": "string", "maxLength": 34}},
        "x_axis": {"type": "string", "maxLength": 40},
        "y_axis": {"type": "string", "maxLength": 40},
        "bubbles": {"type": "array", "minItems": 3, "maxItems": 12, "items": {
            "type": "object", "additionalProperties": False, "required": ["label", "x", "y"],
            "properties": {"label": {"type": "string", "maxLength": 20},
                           "x": {"type": "number"}, "y": {"type": "number"},
                           "size": {"type": "number", "minimum": 0}}}},
        "takeaways": {"type": "array", "minItems": 2, "maxItems": 5,
                      "items": {"type": "string", "maxLength": 220}},
        "bottom_note": {"type": "string", "maxLength": 180}},
           "bubble chart + key takeaways")

    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Superba deck plan",
        "type": "object",
        "required": ["deck_title", "language", "slides"],
        "additionalProperties": False,
        "properties": {
            "deck_title": {"type": "string", "maxLength": 90},
            "language": {"enum": ["no", "en"], "description": "Output language; follows the input."},
            "slides": {
                "type": "array", "minItems": 3, "maxItems": 34,
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["layout"],
                    "properties": {
                        "layout": {"enum": list(LAYOUTS) + ["ingredient", "key_points", "chart",
                                                            "matrix", "exec_summary", "comparison",
                                                            "stat", "harvey_ball", "funnel",
                                                            "closing",
                                                            "kpi_dashboard", "roadmap",
                                                            "icon_grid", "takeaways", "from_to",
                                                            "pillars", "team", "metric_bars", "cause_effect",
                                                            "org_chart", "decision_tree", "cycle", "gantt",
                                                            "serpentine", "coverage_matrix", "photo_stats",
                                                            "numbered_cards", "implications",
                                                            "breakdown", "chart_bands",
                                                            "chart_takeaways"]},
                        "background": {"enum": ["dark", "light", "pastel"],
                                       "description": "dark = deep-sea master (default), light = white master, "
                                                       "pastel = the same white master with a solid pastel-mint "
                                                       "override. Alternate for rhythm."},
                        "title": {"type": "string"},
                        "subtitle": {"type": "string"},
                        "heading": {"type": "string"},
                        "body": {"type": "string"},
                        "eyebrow": {"type": "string"},
                        "bottom_note": {"type": "string"},
                        "banner": {"type": "string"},
                        "caption": {"type": "string"},
                        "chart_type": {"enum": ["column", "bar", "line", "stacked_column", "stacked_100", "doughnut"]},
                        "categories": {"type": "array", "items": {"type": "string"}},
                        "series": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"name": {"type": "string"},
                                           "values": {"type": "array", "items": {"type": "number"}}}}},
                        "x_axis": {"type": "string"}, "y_axis": {"type": "string"},
                        "quadrants": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"heading": {"type": "string"}, "body": {"type": "string"}}}},
                        "points": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"heading": {"type": "string"}, "body": {"type": "string"},
                                           "icon": {"enum": benefits}, "icon_generic": {"enum": generic}}}},
                        "headers": {"type": "array", "items": {"type": "string"}},
                        "rows": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"cells": {"type": "array", "items": {"type": "string"}}}}},
                        "stats": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"value": {"type": "string"}, "label": {"type": "string"},
                                           "note": {"type": "string"}}}},
                        "options": {"type": "array", "items": {"type": "string"}},
                        "criteria": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"label": {"type": "string"},
                                           "scores": {"type": "array", "items": {"type": "integer"}}}}},
                        "stages": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"heading": {"type": "string"}, "body": {"type": "string"}}}},
                        "metrics": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"value": {"type": "string"}, "label": {"type": "string"},
                                           "note": {"type": "string"}}}},
                        "center": {"type": "string"},
                        "total": {"type": "string"},
                        "periods": {"type": "array", "items": {"type": "string"}},
                        "values": {"type": "array", "items": {"type": "number"}},
                        "takeaways": {"type": "array", "items": {"type": "string"}},
                        "bubbles": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"label": {"type": "string"}, "x": {"type": "number"},
                                           "y": {"type": "number"}, "size": {"type": "number"}}}},
                        "bands": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"label": {"type": "string"},
                                           "start": {"type": "integer"}, "end": {"type": "integer"}}}},
                        "before": {"type": "object", "additionalProperties": False,
                                   "properties": {"heading": {"type": "string"}, "body": {"type": "string"}}},
                        "after": {"type": "object", "additionalProperties": False,
                                  "properties": {"heading": {"type": "string"}, "body": {"type": "string"}}},
                        "phases": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"date": {"type": "string"}, "heading": {"type": "string"},
                                           "body": {"type": "string"}}}},
                        "tagline": {"type": "string"}, "contact": {"type": "string"},
                        "items": {"type": "array"},
                        "columns": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"heading": {"type": "string"}, "body": {"type": "string"},
                                           "icon": {"enum": benefits},
                                           "icon_generic": {"enum": generic}}}},
                        "callouts": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"heading": {"type": "string"}, "body": {"type": "string"}}}},
                        "asset_id": {"enum": asset_ids + [None]},
                        "benefit": {"enum": benefits},
                        "source": {"type": "string"}, "key_finding": {"type": "string"},
                        "supporting_findings": {"type": "string"}, "relevance": {"type": "string"},
                        "contents": {"type": "string"},
                        "speaker_notes": {"type": "string", "maxLength": 1400},
                        "source_citations": {"type": "array", "maxItems": 6,
                                             "items": {"type": "string", "maxLength": 160}},
                    },
                    "allOf": conditionals,
                },
            },
        },
    }

    schema_out, catalog_out = cfg_dir / "slide_schema.json", cfg_dir / "layout_catalog.json"
    schema_out.write_text(json.dumps(schema, indent=2, ensure_ascii=False), encoding="utf-8")
    catalog_out.write_text(json.dumps(catalog, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Wrote {schema_out.relative_to(ROOT)} + {catalog_out.relative_to(ROOT)}")
    print(f"{len(catalog)} layouts, asset_id enum has {len(asset_ids)} photos, {len(benefits)-1} benefits\n")
    for sem, tpl, bgs, lim in summary:
        pretty = ", ".join(f"{k}:{(v if not isinstance(v, dict) else v)}" for k, v in lim.items())
        print(f"  {sem:<19} <- {tpl:<20} bg={'/'.join(bgs):<10} limits: {pretty}")


if __name__ == "__main__":
    argv = sys.argv[1:]
    brand_arg = None
    if "--brand" in argv:
        brand_arg = argv[argv.index("--brand") + 1]
    main(brand_arg)
