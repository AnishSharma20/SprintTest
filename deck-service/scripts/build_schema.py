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
INV = ROOT / "config" / "template_inventory.json"
MANIFEST = ROOT / "config" / "asset_manifest.json"
SCHEMA_OUT = ROOT / "config" / "slide_schema.json"
CATALOG_OUT = ROOT / "config" / "layout_catalog.json"

# Footer / date / slide-number placeholders — never filled, never removed (they inherit the
# brand footer + slide number from the master). Everything else is content.
CHROME_IDX = {10, 11, 12}

# The 10-12 LLM-facing layouts (justified in README): semantic name -> template layout + kind.
# Kept deliberately small; more choices degrade the model's layout selection.
LAYOUTS = {
    "title":              {"tpl": "Title Slide 1",       "kind": "title"},
    "section":            {"tpl": "Section Header 1",    "kind": "section"},
    "agenda":             {"tpl": "Agenda 1",            "kind": "agenda"},
    "highlight":          {"tpl": "Highlight Text",      "kind": "highlight"},
    "title_only":         {"tpl": "Title Only 1",        "kind": "title_only"},
    "text":               {"tpl": "Text Slide 1",        "kind": "text"},
    "text_with_picture":  {"tpl": "Text With Picture 1", "kind": "text_picture"},
    "picture_with_title": {"tpl": "Picture With Title 1", "kind": "picture_title"},
    "picture_full":       {"tpl": "Text With Picture 3", "kind": "picture_full"},
    "two_columns":        {"tpl": "Two Columns",         "kind": "columns", "n": 2},
    "three_columns":      {"tpl": "Three Columns",       "kind": "columns", "n": 3},
    "four_columns":       {"tpl": "Four Columns",        "kind": "columns", "n": 4},
}

FONT_PT = {  # measured from the rendered template (used only to size char limits)
    "cover_title": 54, "content_title": 32, "section_title": 36, "agenda_title": 60,
    "highlight_title": 40, "subtitle": 16, "heading": 16, "body": 13, "object": 16,
    "section_body": 16, "agenda_item": 16, "small_body": 14,
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


def load_superba_layouts(inv):
    si = inv["superba_master_index"]
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


def build(sem, spec, layout, light_names):
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


def main():
    inv = json.loads(INV.read_text(encoding="utf-8"))
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    asset_ids = [a["id"] for a in manifest["assets"] if a.get("selectable") and a["kind"] == "photo"]
    benefits = manifest["benefits"] + ["none"]
    generic = manifest.get("generic_icons", []) + ["none"]

    by_name, light_names = load_superba_layouts(inv)
    catalog, conditionals, summary = {}, [], []
    for sem, spec in LAYOUTS.items():
        layout = by_name.get(spec["tpl"])
        if not layout:
            print(f"  !! template layout missing: {spec['tpl']} ({sem})"); continue
        cat, limits = build(sem, spec, layout, light_names)
        catalog[sem] = cat
        conditionals.append(slide_conditional(sem, spec["kind"], limits, asset_ids, benefits, generic))
        summary.append((sem, spec["tpl"], cat["backgrounds"], limits))

    # 'ingredient' — AKBM's real standard slide, spliced in VERBATIM by the renderer (fixed
    # product-composition content, not generated). The planner only picks the layout; any copy it
    # emits is ignored, so nothing is required or length-limited here.
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
                     "title": {"type": "string", "maxLength": 90},
                     "banner": {"type": "string", "maxLength": 70},
                     "items": {"type": "array", "minItems": 3, "maxItems": 4,
                               "items": {"type": "object", "additionalProperties": False,
                                         "required": ["heading", "body"],
                                         "properties": {"heading": {"type": "string", "maxLength": 26},
                                                        "body": {"type": "string", "maxLength": 320},
                                                        "icon": {"enum": benefits},
                                                        "icon_generic": {"enum": generic}}}}}}})
    summary.append(("key_points", "Blank (code-built: 4 icon cards)", ["light"], {"items": "3-4 x {head,body,icon}"}))

    catalog["chart"] = {"template_layout": "Blank", "kind": "chart", "backgrounds": ["dark"],
                        "fields": {}, "limits": {}, "picture_slots": [], "removable_idx": []}
    conditionals.append({
        "if": {"properties": {"layout": {"const": "chart"}}, "required": ["layout"]},
        "then": {"required": ["layout", "title", "categories", "series", "x_axis", "y_axis"],
                 "properties": {
                     "title": {"type": "string", "maxLength": 90},
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
    summary.append(("chart", "Blank (native pptx chart)", ["dark"], {"data": "categories+series"}))

    # Batch 1 synthetic layouts (matrix / journey / exec_summary / quote / comparison).
    def _synth(name, kind, bg, required, props, note):
        catalog[name] = {"template_layout": "Blank", "kind": kind, "backgrounds": [bg],
                         "fields": {}, "limits": {}, "picture_slots": [], "removable_idx": []}
        conditionals.append({"if": {"properties": {"layout": {"const": name}}, "required": ["layout"]},
                             "then": {"required": required, "properties": props}})
        summary.append((name, f"Blank ({note})", [bg], {"fields": ",".join(required[1:])}))

    _synth("matrix", "matrix", "dark", ["layout", "title", "quadrants"], {
        "title": {"type": "string", "maxLength": 90},
        "x_axis": {"type": "string", "maxLength": 40}, "y_axis": {"type": "string", "maxLength": 40},
        "quadrants": {"type": "array", "minItems": 4, "maxItems": 4, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading", "body"],
            "properties": {"heading": {"type": "string", "maxLength": 30},
                           "body": {"type": "string", "maxLength": 120}}}}}, "2x2 matrix")

    _synth("journey", "journey", "dark", ["layout", "title", "steps"], {
        "title": {"type": "string", "maxLength": 90},
        "steps": {"type": "array", "minItems": 3, "maxItems": 5, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading", "body"],
            "properties": {"heading": {"type": "string", "maxLength": 24},
                           "body": {"type": "string", "maxLength": 90},
                           "icon": {"enum": benefits}, "icon_generic": {"enum": generic}}}}}, "process journey")

    _synth("exec_summary", "exec_summary", "dark", ["layout", "title", "points"], {
        "title": {"type": "string", "maxLength": 90},
        "asset_id": {"enum": asset_ids + [None]},
        "points": {"type": "array", "minItems": 2, "maxItems": 4, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading", "body"],
            "properties": {"heading": {"type": "string", "maxLength": 42},
                           "body": {"type": "string", "maxLength": 160},
                           "icon": {"enum": benefits}, "icon_generic": {"enum": generic}}}}}, "text points + image")

    _synth("quote", "quote", "dark", ["layout", "quote"], {
        "title": {"type": "string", "maxLength": 60},
        "quote": {"type": "string", "maxLength": 400},
        "author": {"type": "string", "maxLength": 70}}, "pull quote")

    _synth("comparison", "comparison", "light", ["layout", "title", "headers", "rows"], {
        "title": {"type": "string", "maxLength": 90},
        "headers": {"type": "array", "minItems": 2, "maxItems": 4, "items": {"type": "string", "maxLength": 30}},
        "rows": {"type": "array", "minItems": 1, "maxItems": 8, "items": {
            "type": "object", "additionalProperties": False, "required": ["cells"],
            "properties": {"cells": {"type": "array", "minItems": 2, "maxItems": 4,
                                     "items": {"type": "string", "maxLength": 70}}}}}}, "comparison table")

    # Batch 2 synthetic layouts (stat / harvey_ball / timeline / funnel).
    _synth("stat", "stat", "dark", ["layout", "title", "stats"], {
        "title": {"type": "string", "maxLength": 90},
        "caption": {"type": "string", "maxLength": 90},
        "stats": {"type": "array", "minItems": 1, "maxItems": 3, "items": {
            "type": "object", "additionalProperties": False, "required": ["value", "label"],
            "properties": {"value": {"type": "string", "maxLength": 12},
                           "label": {"type": "string", "maxLength": 40},
                           "note": {"type": "string", "maxLength": 90}}}}}, "hero stats")

    _synth("harvey_ball", "harvey_ball", "light", ["layout", "title", "options", "criteria"], {
        "title": {"type": "string", "maxLength": 90},
        "options": {"type": "array", "minItems": 2, "maxItems": 4, "items": {"type": "string", "maxLength": 24}},
        "criteria": {"type": "array", "minItems": 2, "maxItems": 6, "items": {
            "type": "object", "additionalProperties": False, "required": ["label", "scores"],
            "properties": {"label": {"type": "string", "maxLength": 40},
                           "scores": {"type": "array", "minItems": 2, "maxItems": 4,
                                      "items": {"type": "integer", "minimum": 0, "maximum": 4}}}}}}, "harvey-ball grid")

    _synth("timeline", "timeline", "dark", ["layout", "title", "milestones"], {
        "title": {"type": "string", "maxLength": 90},
        "milestones": {"type": "array", "minItems": 3, "maxItems": 6, "items": {
            "type": "object", "additionalProperties": False, "required": ["date", "heading"],
            "properties": {"date": {"type": "string", "maxLength": 16},
                           "heading": {"type": "string", "maxLength": 26},
                           "body": {"type": "string", "maxLength": 80}}}}}, "timeline")

    _synth("funnel", "funnel", "dark", ["layout", "title", "stages"], {
        "title": {"type": "string", "maxLength": 90},
        "stages": {"type": "array", "minItems": 3, "maxItems": 5, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading"],
            "properties": {"heading": {"type": "string", "maxLength": 30},
                           "body": {"type": "string", "maxLength": 90}}}}}, "funnel")

    # Client-requested layouts.
    _synth("case_study", "case_study", "dark", ["layout", "title", "design", "result", "takeaway"], {
        "title": {"type": "string", "maxLength": 90},
        "study": {"type": "string", "maxLength": 80},
        "design": {"type": "string", "maxLength": 220},
        "result": {"type": "string", "maxLength": 220},
        "takeaway": {"type": "string", "maxLength": 160}}, "case study / proof point")

    _synth("closing", "closing", "dark", ["layout", "title"], {
        "title": {"type": "string", "maxLength": 90},
        "tagline": {"type": "string", "maxLength": 90},
        "contact": {"type": "string", "maxLength": 160}}, "closing / contact")

    # More MBB layouts.
    _synth("pyramid", "pyramid", "dark", ["layout", "title", "levels"], {
        "title": {"type": "string", "maxLength": 90},
        "levels": {"type": "array", "minItems": 2, "maxItems": 5, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading"],
            "properties": {"heading": {"type": "string", "maxLength": 30},
                           "body": {"type": "string", "maxLength": 120}}}}}, "layered pyramid")

    _synth("kpi_dashboard", "kpi_dashboard", "dark", ["layout", "title", "metrics"], {
        "title": {"type": "string", "maxLength": 90},
        "caption": {"type": "string", "maxLength": 100},
        "metrics": {"type": "array", "minItems": 3, "maxItems": 6, "items": {
            "type": "object", "additionalProperties": False, "required": ["value", "label"],
            "properties": {"value": {"type": "string", "maxLength": 12},
                           "label": {"type": "string", "maxLength": 42},
                           "note": {"type": "string", "maxLength": 60}}}}}, "KPI dashboard tiles")

    _synth("roadmap", "roadmap", "dark", ["layout", "title", "phases"], {
        "title": {"type": "string", "maxLength": 90},
        "phases": {"type": "array", "minItems": 2, "maxItems": 5, "items": {
            "type": "object", "additionalProperties": False, "required": ["heading"],
            "properties": {"date": {"type": "string", "maxLength": 20},
                           "heading": {"type": "string", "maxLength": 26},
                           "body": {"type": "string", "maxLength": 170}}}}}, "roadmap phases (chevrons)")

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
                                                            "matrix", "journey", "exec_summary", "quote", "comparison",
                                                            "stat", "harvey_ball", "timeline", "funnel",
                                                            "case_study", "closing",
                                                            "pyramid", "kpi_dashboard", "roadmap"]},
                        "background": {"enum": ["dark", "light"],
                                       "description": "dark = deep-sea master (default), light = light master. Alternate for rhythm."},
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
                        "quote": {"type": "string"}, "author": {"type": "string"},
                        "quadrants": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"heading": {"type": "string"}, "body": {"type": "string"}}}},
                        "steps": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"heading": {"type": "string"}, "body": {"type": "string"},
                                           "icon": {"enum": benefits}, "icon_generic": {"enum": generic}}}},
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
                        "milestones": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"date": {"type": "string"}, "heading": {"type": "string"},
                                           "body": {"type": "string"}}}},
                        "stages": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"heading": {"type": "string"}, "body": {"type": "string"}}}},
                        "levels": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"heading": {"type": "string"}, "body": {"type": "string"}}}},
                        "metrics": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"value": {"type": "string"}, "label": {"type": "string"},
                                           "note": {"type": "string"}}}},
                        "phases": {"type": "array", "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"date": {"type": "string"}, "heading": {"type": "string"},
                                           "body": {"type": "string"}}}},
                        "study": {"type": "string"}, "design": {"type": "string"},
                        "result": {"type": "string"}, "takeaway": {"type": "string"},
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
                        "speaker_notes": {"type": "string", "maxLength": 1400},
                        "source_citations": {"type": "array", "maxItems": 6,
                                             "items": {"type": "string", "maxLength": 160}},
                    },
                    "allOf": conditionals,
                },
            },
        },
    }

    SCHEMA_OUT.write_text(json.dumps(schema, indent=2, ensure_ascii=False), encoding="utf-8")
    CATALOG_OUT.write_text(json.dumps(catalog, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Wrote {SCHEMA_OUT.relative_to(ROOT)} + {CATALOG_OUT.relative_to(ROOT)}")
    print(f"{len(catalog)} layouts, asset_id enum has {len(asset_ids)} photos, {len(benefits)-1} benefits\n")
    for sem, tpl, bgs, lim in summary:
        pretty = ", ".join(f"{k}:{(v if not isinstance(v, dict) else v)}" for k, v in lim.items())
        print(f"  {sem:<19} <- {tpl:<20} bg={'/'.join(bgs):<10} limits: {pretty}")


if __name__ == "__main__":
    main()
