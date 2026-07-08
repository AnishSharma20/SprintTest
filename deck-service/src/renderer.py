"""Stage 2 — deterministic renderer.

JSON plan -> python-pptx fills the real Superba template. All styling (fonts, colours,
backgrounds, logos, bullet formatting) is inherited from the template's slide layouts; this
code only chooses which layout to instantiate, drops text into placeholders by index, and
inserts a photo. It never sets a font, colour, or position.

Key disciplines that make template-fill clean (the earlier attempt failed on these):
- strip the 64 example slides first;
- pick the dark (master #0) or light (master #1) variant of a layout by `background`;
- fill placeholders by their INDEX from the layout catalog (not by guessing);
- DELETE any content placeholder the plan didn't fill, so no empty prompt text or tinted
  picture boxes survive (footer/date/slide-number placeholders are left to inherit).
"""
from __future__ import annotations

import copy
import io
import re

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.oxml import parse_xml
from pptx.oxml.ns import nsdecls, qn
from pptx.util import Emu, Inches, Pt

from . import config

CHROME_IDX = {10, 11, 12}   # date / footer / slide-number — never fill, never remove

# trailing connector words a truncation must not end on (English + Norwegian)
_ORPHANS = {"and", "og", "of", "the", "to", "for", "with", "og", "&", "i", "på", "med", "av"}


def _delete_example_slides(prs) -> None:
    lst = prs.slides._sldIdLst
    for sldId in list(lst):
        rId = sldId.get(qn("r:id"))
        if rId:
            prs.part.drop_rel(rId)
        lst.remove(sldId)


def _master_indices():
    inv = config.inventory()
    dark = inv["superba_master_index"]
    light = next((m["index"] for m in inv["masters"]
                  if m["index"] != dark and (m.get("major_font") or "").lower().startswith("exo")), dark)
    return dark, light


def _find_layout(prs, name, master_index):
    master = prs.slide_masters[master_index]
    for lay in master.slide_layouts:
        if lay.name == name:
            return lay
    for m in prs.slide_masters:                 # fallback: any master
        for lay in m.slide_layouts:
            if lay.name == name:
                return lay
    raise ValueError(f"Layout '{name}' not found in template")


def _autofit(tf) -> None:
    """Shrink text to fit its box instead of spilling into the placeholder below. This is the
    'zero overflow' guarantee: a title/heading that would wrap past its box shrinks rather
    than colliding with the subtitle/body. Font family & colour still inherit from the layout."""
    tf.word_wrap = True
    try:
        tf.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE
    except Exception:  # noqa: BLE001
        pass


def _set_text(ph, text: str) -> None:
    """Single logical value into a placeholder, inheriting all run formatting from the layout."""
    ph.text_frame.text = text
    _autofit(ph.text_frame)


def _set_lines(ph, lines: list[str], bullet_rid: str | None = None) -> None:
    """Multiple paragraphs (bullets / agenda items). If bullet_rid is given, each paragraph gets
    the brand's PICTURE bullet (the teal figure embedded in the template master) — this overrides
    the content placeholders' `buNone`. Otherwise each paragraph inherits the layout's list format."""
    lines = [ln for ln in (l.strip() for l in lines) if ln]
    tf = ph.text_frame
    tf.text = lines[0] if lines else ""
    for ln in lines[1:]:
        tf.add_paragraph().text = ln
    if bullet_rid:
        for para in tf.paragraphs:
            _apply_picture_bullet(para._p, bullet_rid)
    _autofit(tf)


# The brand bullet is a small teal PNG embedded in the template master (as a picture bullet at
# body level 1). Content placeholders switch it off with buNone, so for real bullet lists we set
# the picture bullet explicitly on each paragraph, matching the master's indent metrics.
_BULLET_MARL, _BULLET_INDENT, _BULLET_SZ = "342900", "-342900", "100000"


def _bullet_rid(slide) -> str | None:
    """Embed the brand bullet image in the slide part (idempotent) and return its relationship id."""
    path = config.ASSETS_DIR / "bullet.png"
    if not path.exists():
        return None
    _, rid = slide.part.get_or_add_image_part(str(path))
    return rid


def _apply_picture_bullet(p, rid: str) -> None:
    """Set the brand picture bullet on one <a:p>, replacing any inherited buNone/buChar."""
    pPr = p.find(qn("a:pPr"))
    if pPr is None:
        pPr = p.makeelement(qn("a:pPr"), {})
        p.insert(0, pPr)
    pPr.set("marL", _BULLET_MARL)
    pPr.set("indent", _BULLET_INDENT)
    for tag in ("a:buClr", "a:buSzPct", "a:buSzPts", "a:buFont", "a:buFontTx",
                "a:buNone", "a:buChar", "a:buAutoNum", "a:buBlip"):
        for el in pPr.findall(qn(tag)):
            pPr.remove(el)
    # Order matters in the schema: bullet size (buSz*) before the bullet itself (bu*).
    buSz = pPr.makeelement(qn("a:buSzPct"), {"val": _BULLET_SZ})
    buBlip = pPr.makeelement(qn("a:buBlip"), {})
    blip = buBlip.makeelement(qn("a:blip"), {qn("r:embed"): rid})
    buBlip.append(blip)
    pPr.append(buSz)
    pPr.append(buBlip)


DISCLAIMER = ("AI generated draft from the source material. Review all content, claims and figures, "
              "and edit as needed before use.")


def _add_disclaimer(slide, dark: bool) -> None:
    """Add a small 'AI generated, review before use' note along the bottom of the cover slide.
    A free-standing textbox (no template placeholder exists for it), so we set a subtle size/colour."""
    box = slide.shapes.add_textbox(Inches(0.5), Inches(6.98), Inches(10.5), Inches(0.4))
    tf = box.text_frame
    tf.word_wrap = True
    tf.text = DISCLAIMER
    run = tf.paragraphs[0].runs[0]
    run.font.size = Pt(9)
    run.font.italic = True
    run.font.color.rgb = RGBColor(0xBF, 0xE3, 0xEF) if dark else RGBColor(0x6B, 0x8B, 0x95)


def _icon_path(benefit: str):
    """Resolve a health-benefit tag to its staged branded icon (one brand-red line-art colourway
    that reads on both masters). Returns None if there is no icon for that benefit."""
    if not benefit or benefit == "none":
        return None
    entry = config.asset_index().get(f"icon_{benefit}")
    if not entry or not entry.get("path"):
        return None
    p = config.resolve_asset(entry["path"])
    return p if p.exists() else None


def _generic_icon_path(keyword: str):
    """Resolve a generic-library keyword to its staged fallback icon (same brand-red line-art).
    Used only when a slide can't be fully covered by the branded benefit icons."""
    if not keyword or keyword == "none":
        return None
    entry = config.asset_index().get(f"generic_{keyword}")
    if not entry or not entry.get("path"):
        return None
    p = config.resolve_asset(entry["path"])
    return p if p.exists() else None


def _layout_box(layout_name: str, master_index: int, idx: int):
    """(left, top, width, height) in EMU for a placeholder, from the inventory (dims already
    resolved through master inheritance)."""
    for lay in config.inventory()["layouts"]:
        if lay["name"] == layout_name and lay["master_index"] == master_index:
            for p in lay["placeholders"]:
                if p["idx"] == idx and p["width_emu"] and p["height_emu"]:
                    return p["left_emu"], p["top_emu"], p["width_emu"], p["height_emu"]
    return None


def _place_icon(slide, box, icon_path) -> bool:
    """Add an icon scaled to FIT (letterbox), centred in the box — icons must not be
    crop-to-filled the way insert_picture would. box = (left, top, width, height) in EMU."""
    if not box or not icon_path:
        return False
    left, top, w, h = box
    try:
        from PIL import Image
        with Image.open(icon_path) as im:
            iw, ih = im.size
        if (iw / ih) > (w / h):
            dw, dh = w, int(w * ih / iw)
        else:
            dh, dw = h, int(h * iw / ih)
        slide.shapes.add_picture(str(icon_path), left + (w - dw) // 2, top + (h - dh) // 2, dw, dh)
        return True
    except Exception:  # noqa: BLE001 — an icon is decorative; never break the render
        return False


def _fit(text, limit):
    """Hard word-boundary truncation for collision-prone 1-line label fields (cover/agenda
    title, headings). The planner + validation retry keep these within the limit almost
    always; this is the last-resort guarantee that a stray over-limit label can never wrap
    into a 2nd line and collide with the element below. Not applied to bodies/items (they
    grow into empty space or auto-fit)."""
    if not (text and limit and len(text) > limit):
        return text
    words = text.split()
    if len(words[0]) > limit:      # a single word already exceeds the box — keep it whole (no mid-word cut)
        return words[0]
    out = ""
    for w in words:                # pack whole words up to the limit
        if len(out) + len(w) + (1 if out else 0) > limit:
            break
        out = f"{out} {w}".strip()
    out = out or words[0]
    # A cut can leave a dangling connector or symbol ("Omega-3 EPA &", "Heart and"); drop it so
    # the label never ends on an orphan token.
    out = re.sub(r"[\s&+/,-]+$", "", out)
    while len(out.split()) > 1 and out.rsplit(" ", 1)[1].lower() in _ORPHANS:
        out = re.sub(r"[\s&+/,-]+$", "", out.rsplit(" ", 1)[0])
    return out.strip() or words[0]


def _distinct_col_headings(raws, limit):
    """Fit each column heading to its (narrow, 1-line) box AND guarantee the columns don't render
    the SAME heading. Two parallel headings that share an opening ("What the barrier does" / "…
    needs", or "Superba supports heart" / "… brain") would otherwise both truncate to the shared
    prefix. When that happens we drop the common leading words and re-fit the distinguishing tail
    (which also turns "Superba supports heart/brain" into a clean "Heart"/"Brain")."""
    fitted = [_fit(h or "", limit) for h in raws]
    ne = [h for h in fitted if h]
    if len(set(ne)) == len(ne):
        return fitted
    toks = [(h or "").split() for h in raws]
    present = [t for t in toks if t]
    common = 0
    if len(present) > 1:
        shortest = min(len(t) for t in present)
        for i in range(shortest):
            w = present[0][i].lower()
            if i < shortest - 1 and all(t[i].lower() == w for t in present):  # never strip all words
                common += 1
            else:
                break
    if common:
        stripped = [" ".join(t[common:]) for t in toks]
        stripped = [s[:1].upper() + s[1:] if s else "" for s in stripped]
        refit = [_fit(s, limit) for s in stripped]
        rne = [h for h in refit if h]
        if len(set(rne)) == len(rne):
            return refit
    return fitted


def _fill_slide(slide, spec: dict, cat: dict, master_index: int, dark: bool) -> None:
    fields = cat["fields"]
    lim = cat.get("limits", {})
    layout_name = cat["template_layout"]
    phmap = {ph.placeholder_format.idx: ph for ph in slide.placeholders}
    filled: set[int] = set()
    benefit = spec.get("benefit")
    benefit = None if benefit in (None, "none") else benefit

    def put(idx, value, multiline=False, bullets=False):
        if idx is None or idx not in phmap or value is None:
            return
        if multiline:
            raw = value if isinstance(value, list) else str(value).split("\n")
            lines = [ln for ln in (str(x).strip() for x in raw) if ln]
            # A list of points (2+ lines) gets the brand picture bullet; a single line stays plain prose.
            rid = _bullet_rid(slide) if (bullets and len(lines) > 1) else None
            _set_lines(phmap[idx], lines, bullet_rid=rid)
        else:
            _set_text(phmap[idx], str(value))
        filled.add(idx)

    title = spec.get("title")
    if cat["kind"] in ("title", "agenda"):     # narrow 1-line title box above a neighbour
        title = _fit(title, lim.get("title"))
    put(fields.get("title"), title)
    put(fields.get("subtitle"), spec.get("subtitle"))
    put(fields.get("heading"), _fit(spec.get("heading"), lim.get("heading")))
    put(fields.get("body"), spec.get("body"), multiline=True, bullets=True)
    if spec.get("items"):
        put(fields.get("items"), spec["items"], multiline=True, bullets=True)

    col_head_max = (lim.get("columns") or {}).get("heading_max")
    col_maps = fields.get("columns", [])
    cols = spec.get("columns", [])
    # Icon consistency ACROSS the whole slide (brand rule): every column gets an icon or NONE do,
    # all from ONE source (all AKBM benefit icons OR all generic fallback icons — never mixed),
    # each icon distinct. Prefer the branded benefit icons; fall back to the generic set only
    # when every column can be matched there. If neither source covers all columns, drop icons
    # from the whole slide rather than render a partial / duplicated / mixed set.
    def _consistent(paths):
        strs = [str(p) for p in paths]
        return paths if paths and all(paths) and len(set(strs)) == len(strs) else None
    icons = (_consistent([_icon_path(c.get("icon")) for c in cols])
             or _consistent([_generic_icon_path(c.get("icon_generic")) for c in cols])
             or [None] * len(cols))
    heads = _distinct_col_headings([c.get("heading") for c in cols], col_head_max)
    for col_map, col, icon, head in zip(col_maps, cols, icons, heads):
        put(col_map.get("heading"), head)
        # Content-driven: a column body written as several lines becomes bullets; a single
        # sentence stays prose. Same rule as the main body.
        put(col_map.get("body"), col.get("body"), multiline=True, bullets=True)
        pic = col_map.get("picture")
        if icon and pic is not None:
            _place_icon(slide, _layout_box(layout_name, master_index, pic), icon)

    aid = spec.get("asset_id")
    pic_idx = fields.get("picture")
    if aid:
        if pic_idx is not None and pic_idx in phmap:
            path = config.resolve_asset(config.asset_index()[aid]["path"])
            if path.exists():
                phmap[pic_idx].insert_picture(str(path))
                filled.add(pic_idx)
    elif benefit and pic_idx is not None and pic_idx in phmap:
        # Benefit slide with a picture area but no photo → show the benefit icon there.
        _place_icon(slide, _layout_box(layout_name, master_index, pic_idx), _icon_path(benefit))

    # Benefit icon on text-only benefit slides (highlight / section have open top-left space).
    if benefit and cat["kind"] in ("highlight", "section"):
        _place_icon(slide, (Inches(0.5), Inches(0.42), Inches(0.95), Inches(0.95)), _icon_path(benefit))

    # AI-generated disclaimer along the bottom of the cover slide.
    if cat["kind"] == "title":
        _add_disclaimer(slide, dark)

    # Remove every content placeholder we did not fill (prevents empty picture boxes /
    # leftover prompt text). Chrome placeholders (date/footer/number) stay and inherit.
    for ph in list(slide.placeholders):
        idx = ph.placeholder_format.idx
        if idx in CHROME_IDX or idx in filled:
            continue
        ph._element.getparent().remove(ph._element)

    notes = spec.get("speaker_notes")
    if notes:
        slide.notes_slide.notes_text_frame.text = notes


_R_ATTRS = (qn("r:embed"), qn("r:link"), qn("r:id"))
_INGREDIENT_SRC = None


def _ingredient_source():
    """Cache-load the standalone ingredient slide (`assets/ingredient_slide.pptx`) — AKBM's real,
    verbatim 'Key Cellular Nutrients' slide, self-contained (its own full-bleed background,
    capsule, connectors, footer logos, citation links)."""
    global _INGREDIENT_SRC
    if _INGREDIENT_SRC is None:
        _INGREDIENT_SRC = Presentation(str(config.resolve_asset("assets/ingredient_slide.pptx")))
    return _INGREDIENT_SRC


def _add_ingredient_slide(prs, master_index: int) -> None:
    """Insert AKBM's standard ingredient slide VERBATIM — the exact slide they always use — by
    splicing its self-contained shape tree into the deck and re-embedding its images / re-linking
    its external hyperlinks. Fidelity is perfect: the slide carries its own full-bleed background,
    so the host layout (a Blank one) is completely hidden behind it. Content is FIXED (the product
    composition never changes), so nothing here is generated."""
    src_slide = _ingredient_source().slides[0]
    slide = prs.slides.add_slide(_find_layout(prs, "Blank", master_index))
    for ph in list(slide.shapes):                 # drop the Blank layout's own placeholders
        ph._element.getparent().remove(ph._element)
    spTree = slide.shapes._spTree
    rmap = dict(src_slide.part.rels.items())
    for shp in src_slide.shapes:
        el = copy.deepcopy(shp._element)
        for node in el.iter():                    # remap every relationship reference in the copy
            for a in _R_ATTRS:
                if a in node.attrib:
                    rel = rmap.get(node.get(a))
                    if rel is None:
                        continue
                    if rel.is_external:
                        new = slide.part.rels.get_or_add_ext_rel(rel.reltype, rel.target_ref)
                    else:
                        _, new = slide.part.get_or_add_image_part(io.BytesIO(rel._target.blob))
                    node.set(a, new)
        spTree.append(el)


_BENEFITS_SRC = None


def _benefits_source():
    """Cache-load the standalone benefits slide (`assets/benefits_slide.pptx`) — AKBM's verbatim
    'Multiple, Proven Health Benefits' overview (benefit hexagon cards + trial counts + capsule photo)."""
    global _BENEFITS_SRC
    if _BENEFITS_SRC is None:
        _BENEFITS_SRC = Presentation(str(config.resolve_asset("assets/benefits_slide.pptx")))
    return _BENEFITS_SRC


def _blank_layout(prs, master_index: int):
    master = prs.slide_masters[master_index]
    for lay in master.slide_layouts:
        if "blank" in lay.name.lower():
            return lay
    return master.slide_layouts[-1]


def _set_white_bg(slide) -> None:
    """Force a solid-white slide background (the benefits slide is a white infographic; the host
    master is the dark deep-sea one)."""
    cSld = slide._element.find(qn("p:cSld"))
    for old in cSld.findall(qn("p:bg")):
        cSld.remove(old)
    cSld.insert(0, parse_xml(
        f'<p:bg {nsdecls("p", "a")}><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>'
        f'<a:effectLst/></p:bgPr></p:bg>'))


def _add_benefits_slide(prs, master_index: int) -> None:
    """Splice AKBM's verbatim benefits-overview slide onto a white background, using the LIGHT master's
    blank layout so the footer logos are the light-background (red/dark) colourway. Content is FIXED."""
    src_slide = _benefits_source().slides[0]
    slide = prs.slides.add_slide(_blank_layout(prs, master_index))
    for ph in list(slide.shapes):
        ph._element.getparent().remove(ph._element)
    _set_white_bg(slide)
    spTree = slide.shapes._spTree
    rmap = dict(src_slide.part.rels.items())
    for shp in src_slide.shapes:
        el = copy.deepcopy(shp._element)
        for node in el.iter():
            for a in _R_ATTRS:
                if a in node.attrib:
                    rel = rmap.get(node.get(a))
                    if rel is None:
                        continue
                    if rel.is_external:
                        new = slide.part.rels.get_or_add_ext_rel(rel.reltype, rel.target_ref)
                    else:
                        _, new = slide.part.get_or_add_image_part(io.BytesIO(rel._target.blob))
                    node.set(a, new)
        spTree.append(el)


# ---------------------------------------------------------------------------
# Synthetic (code-built) layouts — mechanism B. The renderer reproduces a faithful structure on a
# Blank layout (inheriting the master's background + logos) and fills it from the plan: text into
# slots, AI-picked brand icons into circles, or a native chart. Brand palette / fonts below.
# ---------------------------------------------------------------------------
_RED = RGBColor(0xE5, 0x0A, 0x1A)
_TEAL = RGBColor(0x18, 0x59, 0x68)
_PANEL = RGBColor(0xE4, 0xF1, 0xF1)
_INKC = RGBColor(0x16, 0x35, 0x36)
_LTEAL = RGBColor(0xA9, 0xDB, 0xD5)
_WHITE = RGBColor(0xFF, 0xFF, 0xFF)
_HEAD, _BODY = "Exo 2", "Manrope"
_CHART_COLORS = [_RED, RGBColor(0x2C, 0x74, 0x82), _LTEAL, RGBColor(0x60, 0xA0, 0x9B)]


def _place_text(slide, l, t, w, h, text, size, color, *, bold=False, font=_BODY,
                align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, italic=False):
    tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Emu(0)
    p = tf.paragraphs[0]
    p.alignment = align
    r = p.add_run()
    r.text = text or ""
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.italic = italic
    r.font.name = font
    r.font.color.rgb = color
    return tb


def _fill_key_points(prs, spec: dict, light_index: int) -> None:
    """4-icon-card 'key points' layout: banner + panels + circles, filled from the plan; the
    AI-picked brand icon goes in each circle. On a white background with the light-master logos."""
    slide = prs.slides.add_slide(_blank_layout(prs, light_index))
    for ph in list(slide.shapes):
        ph._element.getparent().remove(ph._element)
    _set_white_bg(slide)

    _place_text(slide, 0.6, 0.5, 12.1, 0.8, spec.get("title", ""), 26, _INKC, bold=True, font=_HEAD)
    banner = spec.get("banner")
    if banner:
        ban = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.53), Inches(1.55), Inches(12.27), Inches(0.55))
        ban.fill.solid(); ban.fill.fore_color.rgb = _TEAL; ban.line.fill.background(); ban.shadow.inherit = False
        tf = ban.text_frame; tf.word_wrap = True; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
        r = p.add_run(); r.text = banner; r.font.size = Pt(15); r.font.bold = True
        r.font.name = _HEAD; r.font.color.rgb = _WHITE

    items = (spec.get("items") or [])[:4]
    n = len(items)
    if not n:
        return
    pw, gap = 2.85, 0.29
    x0 = (13.333 - (n * pw + (n - 1) * gap)) / 2
    ptop, pbot = (2.65, 6.75) if banner else (2.2, 6.75)
    d = 0.95
    for i, it in enumerate(items):
        x = x0 + i * (pw + gap); cx = x + pw / 2
        pan = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(ptop), Inches(pw), Inches(pbot - ptop))
        pan.fill.solid(); pan.fill.fore_color.rgb = _PANEL; pan.line.fill.background(); pan.shadow.inherit = False
        circ = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - d / 2), Inches(ptop - d / 2), Inches(d), Inches(d))
        circ.fill.solid(); circ.fill.fore_color.rgb = _WHITE
        circ.line.color.rgb = _RED; circ.line.width = Pt(2.25); circ.shadow.inherit = False
        ip = _icon_path(it.get("icon")) or _generic_icon_path(it.get("icon_generic"))
        if ip:
            slide.shapes.add_picture(str(ip), Inches(cx - 0.25), Inches(ptop - 0.25), Inches(0.5), Inches(0.5))
        _place_text(slide, x + 0.15, ptop + 0.55, pw - 0.3, 0.5, it.get("heading", ""), 14.5, _INKC,
                    bold=True, font=_HEAD, align=PP_ALIGN.CENTER)
        _place_text(slide, x + 0.2, ptop + 1.15, pw - 0.4, pbot - ptop - 1.4, it.get("body", ""), 12, _INKC,
                    align=PP_ALIGN.CENTER)


_CHART_TYPES = {"column": XL_CHART_TYPE.COLUMN_CLUSTERED, "bar": XL_CHART_TYPE.BAR_CLUSTERED,
                "line": XL_CHART_TYPE.LINE}


def _fill_chart(prs, spec: dict, dark_index: int) -> None:
    """Native, editable PowerPoint chart from the plan's categories + series, brand-coloured, on the
    deep-sea master (inherits background + logos). Data comes only from the plan (claim fidelity)."""
    slide = prs.slides.add_slide(_blank_layout(prs, dark_index))
    for ph in list(slide.shapes):
        ph._element.getparent().remove(ph._element)

    _place_text(slide, 0.6, 0.5, 12.1, 0.9, spec.get("title", ""), 26, _WHITE, bold=True, font=_HEAD)
    if spec.get("caption"):
        _place_text(slide, 0.6, 1.45, 12.1, 0.5, spec["caption"], 13, _LTEAL, italic=True)

    cats = spec.get("categories") or []
    series = spec.get("series") or []
    if not cats or not series:
        return
    cd = CategoryChartData()
    cd.categories = cats
    for s in series:
        vals = [(v if isinstance(v, (int, float)) else None) for v in (s.get("values") or [])]
        cd.add_series(s.get("name", ""), vals)
    ctype = _CHART_TYPES.get(spec.get("chart_type", "column"), XL_CHART_TYPE.COLUMN_CLUSTERED)
    gf = slide.shapes.add_chart(ctype, Inches(0.9), Inches(2.15), Inches(11.5), Inches(4.0), cd)
    chart = gf.chart
    chart.font.color.rgb = _WHITE
    chart.font.size = Pt(12)
    chart.font.name = _BODY
    multi = len(series) > 1
    chart.has_legend = multi
    if multi:
        from pptx.enum.chart import XL_LEGEND_POSITION
        chart.legend.position = XL_LEGEND_POSITION.BOTTOM
        chart.legend.include_in_layout = False
    for i, plot_series in enumerate(chart.plots[0].series):
        try:
            plot_series.format.fill.solid()
            plot_series.format.fill.fore_color.rgb = _CHART_COLORS[i % len(_CHART_COLORS)]
        except Exception:  # noqa: BLE001 — line charts style the line, handled below
            plot_series.format.line.color.rgb = _CHART_COLORS[i % len(_CHART_COLORS)]


def render_deck(plan: dict) -> bytes:
    prs = Presentation(str(config.template_path()))
    _delete_example_slides(prs)
    catalog = config.catalog()
    dark, light = _master_indices()

    for spec in plan["slides"]:
        layout_name = spec["layout"]
        if layout_name == "ingredient":   # AKBM's standard slide, spliced in verbatim
            _add_ingredient_slide(prs, dark)
            continue
        if layout_name == "key_points":   # code-built 4-icon-card layout (mechanism B)
            _fill_key_points(prs, spec, light)
            continue
        if layout_name == "chart":        # native pptx chart (mechanism B)
            _fill_chart(prs, spec, dark)
            continue
        cat = catalog.get(layout_name)
        if not cat:
            raise ValueError(f"Unknown layout '{layout_name}' (not in catalog)")
        want_light = spec.get("background") == "light" and "light" in cat["backgrounds"]
        master_index = light if want_light else dark
        layout = _find_layout(prs, cat["template_layout"], master_index)
        slide = prs.slides.add_slide(layout)
        _fill_slide(slide, spec, cat, master_index, dark=not want_light)

    # AKBM's standard "Proven Health Benefits" overview, spliced in verbatim as the second-to-last
    # slide of every deck (appended, then moved into place).
    _add_benefits_slide(prs, light)
    sldIdLst = prs.slides._sldIdLst
    ids = list(sldIdLst)
    benefits = ids[-1]
    sldIdLst.remove(benefits)
    sldIdLst.insert(max(1, len(sldIdLst) - 1), benefits)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()
