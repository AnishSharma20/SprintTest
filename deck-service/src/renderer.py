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
_DESIGN_SRC = None


def _design_source():
    """Cache-load template.pptx — the SINGLE design file. It holds the master layouts + theme +
    logos AND the verbatim source slides (ingredient, benefits) that the renderer splices in, so all
    design the AI uses lives in one place."""
    global _DESIGN_SRC
    if _DESIGN_SRC is None:
        _DESIGN_SRC = Presentation(str(config.template_path()))
    return _DESIGN_SRC


def _find_design_slide(marker: str):
    """Find a verbatim source slide inside template.pptx by a case-insensitive text marker."""
    m = marker.upper()
    for s in _design_source().slides:
        for sh in s.shapes:
            if sh.has_text_frame and m in sh.text_frame.text.upper():
                return s
    raise ValueError(f"Design source slide not found in template.pptx (marker {marker!r}).")


def _add_ingredient_slide(prs, master_index: int) -> None:
    """Insert AKBM's standard ingredient slide VERBATIM — the exact slide they always use — by
    splicing its self-contained shape tree into the deck and re-embedding its images / re-linking
    its external hyperlinks. Fidelity is perfect: the slide carries its own full-bleed background,
    so the host layout (a Blank one) is completely hidden behind it. Content is FIXED (the product
    composition never changes), so nothing here is generated."""
    src_slide = _find_design_slide("Cellular Nutrient")
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
    src_slide = _find_design_slide("PROVEN HEALTH BENEFITS")
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
_TEAL2 = RGBColor(0x2C, 0x74, 0x82)   # secondary panel teal
_CHART_COLORS = [_RED, _TEAL2, _LTEAL, RGBColor(0x60, 0xA0, 0x9B)]
_TBL_LINE = "C9D9D9"                  # table row-line colour (hex, for XML)
# --- one consistent design system for the synthetic layouts (client spec) ---
_GUTTER = 0.3                         # standard gutter between side-by-side boxes
_STEP_BADGE = 0.56                    # standard numbered/step badge diameter
_ICON_DISC = 0.9                      # standard icon-circle diameter
_BOX = MSO_SHAPE.RECTANGLE            # one shape style for content boxes (square, consulting look)
_S_TITLE, _S_HEAD, _S_BODY, _S_NOTE = 26, 15, 12.5, 12   # type scale


def _is_num(s: str) -> bool:
    s = (s or "").strip()
    return bool(s) and bool(re.search(r"\d", s)) and bool(re.fullmatch(r"[0-9.,%×xX+\-/()\s]+", s))


def _hbar_table(tbl) -> None:
    """Consulting-style table borders: horizontal row lines only, no vertical gridlines."""
    def _ln(tag, solid):
        inner = f'<a:solidFill><a:srgbClr val="{_TBL_LINE}"/></a:solidFill>' if solid else '<a:noFill/>'
        w = ' w="9525" cap="flat"' if solid else ''
        return parse_xml(f'<a:{tag} {nsdecls("a")}{w}>{inner}</a:{tag}>')
    for row in tbl.rows:
        for cell in row.cells:
            tcPr = cell._tc.get_or_add_tcPr()
            for tag in ("lnL", "lnR", "lnT", "lnB"):
                for el in tcPr.findall(qn("a:" + tag)):
                    tcPr.remove(el)
            for tag in ("lnB", "lnT", "lnR", "lnL"):   # insert at 0 -> final order lnL,lnR,lnT,lnB
                tcPr.insert(0, _ln(tag, tag == "lnB"))


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
    pw, gap = 2.85, _GUTTER
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
                "line": XL_CHART_TYPE.LINE, "stacked_column": XL_CHART_TYPE.COLUMN_STACKED,
                "stacked_100": XL_CHART_TYPE.COLUMN_STACKED_100, "doughnut": XL_CHART_TYPE.DOUGHNUT}


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
    is_round = spec.get("chart_type") == "doughnut"
    multi = len(series) > 1 or is_round
    chart.has_legend = multi
    if multi:
        from pptx.enum.chart import XL_LEGEND_POSITION
        chart.legend.position = XL_LEGEND_POSITION.BOTTOM
        chart.legend.include_in_layout = False
    if is_round:  # one series, many wedges — colour the POINTS
        for i, pt in enumerate(chart.plots[0].series[0].points):
            try:
                pt.format.fill.solid(); pt.format.fill.fore_color.rgb = _CHART_COLORS[i % len(_CHART_COLORS)]
            except Exception:  # noqa: BLE001
                pass
    else:
        for i, plot_series in enumerate(chart.plots[0].series):
            try:
                plot_series.format.fill.solid()
                plot_series.format.fill.fore_color.rgb = _CHART_COLORS[i % len(_CHART_COLORS)]
            except Exception:  # noqa: BLE001 — line charts style the line
                plot_series.format.line.color.rgb = _CHART_COLORS[i % len(_CHART_COLORS)]


def _fill_matrix(prs, spec: dict, dark_index: int) -> None:
    """2x2 matrix: four teal quadrant panels + axis labels, filled from the plan."""
    slide = prs.slides.add_slide(_blank_layout(prs, dark_index))
    for ph in list(slide.shapes):
        ph._element.getparent().remove(ph._element)
    _place_text(slide, 0.6, 0.5, 12.1, 0.8, spec.get("title", ""), 26, _WHITE, bold=True, font=_HEAD)
    quads = (spec.get("quadrants") or [])[:4]
    mx, my, mw, mh = 3.1, 2.15, 9.3, 4.3
    gap = 0.14
    qw, qh = (mw - gap) / 2, (mh - gap) / 2
    pos = [(mx, my), (mx + qw + gap, my), (mx, my + qh + gap), (mx + qw + gap, my + qh + gap)]
    for i, q in enumerate(quads):
        x, y = pos[i]
        pan = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(qw), Inches(qh))
        pan.fill.solid(); pan.fill.fore_color.rgb = _TEAL
        pan.line.color.rgb = _WHITE; pan.line.width = Pt(1); pan.shadow.inherit = False
        _place_text(slide, x + 0.2, y + 0.18, qw - 0.4, 0.5, q.get("heading", ""), 15, _WHITE, bold=True, font=_HEAD)
        _place_text(slide, x + 0.2, y + 0.72, qw - 0.4, qh - 0.9, q.get("body", ""), 12, _LTEAL)
    if spec.get("y_axis"):
        _place_text(slide, 0.7, my, 2.2, mh, spec["y_axis"], 12, _LTEAL, anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER)
    if spec.get("x_axis"):
        _place_text(slide, mx, my + mh + 0.12, mw, 0.4, spec["x_axis"], 12, _LTEAL, align=PP_ALIGN.CENTER)


def _fill_journey(prs, spec: dict, dark_index: int) -> None:
    """Horizontal process journey: a red timeline with numbered nodes; heading + body per step."""
    slide = prs.slides.add_slide(_blank_layout(prs, dark_index))
    for ph in list(slide.shapes):
        ph._element.getparent().remove(ph._element)
    _place_text(slide, 0.6, 0.5, 12.1, 0.8, spec.get("title", ""), 26, _WHITE, bold=True, font=_HEAD)
    steps = (spec.get("steps") or [])[:5]
    n = len(steps)
    if not n:
        return
    gap = _GUTTER
    sw = min(2.6, (12.0 - (n - 1) * gap) / n)
    total = n * sw + (n - 1) * gap
    x0 = (13.333 - total) / 2
    cy = 3.5
    cx_first = x0 + sw / 2
    cx_last = x0 + (n - 1) * (sw + gap) + sw / 2
    line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(cx_first), Inches(cy + 0.27), Inches(cx_last - cx_first), Inches(0.06))
    line.fill.solid(); line.fill.fore_color.rgb = _RED; line.line.fill.background(); line.shadow.inherit = False
    for i, st in enumerate(steps):
        x = x0 + i * (sw + gap); cx = x + sw / 2
        _place_text(slide, x, 2.35, sw, 0.5, st.get("heading", ""), 15, _WHITE, bold=True, font=_HEAD, align=PP_ALIGN.CENTER)
        c = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - 0.28), Inches(cy + 0.02), Inches(0.56), Inches(0.56))
        c.fill.solid(); c.fill.fore_color.rgb = _RED; c.line.color.rgb = _WHITE; c.line.width = Pt(1.5); c.shadow.inherit = False
        c.text_frame.text = str(i + 1)
        rr = c.text_frame.paragraphs[0].runs[0]
        rr.font.size = Pt(16); rr.font.bold = True; rr.font.color.rgb = _WHITE; rr.font.name = _HEAD
        c.text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER
        _place_text(slide, x, cy + 0.8, sw, 1.6, st.get("body", ""), 12, _LTEAL, align=PP_ALIGN.CENTER)


def _fill_exec_summary(prs, spec: dict, dark_index: int) -> None:
    """Executive summary: red-accented key points on the left, a picture (or panel) on the right."""
    slide = prs.slides.add_slide(_blank_layout(prs, dark_index))
    for ph in list(slide.shapes):
        ph._element.getparent().remove(ph._element)
    _place_text(slide, 0.6, 0.5, 7.3, 0.8, spec.get("title", ""), 26, _WHITE, bold=True, font=_HEAD)
    pts = (spec.get("points") or [])[:4]
    n = max(1, len(pts))
    top, bottom = 1.95, 6.4
    step = (bottom - top) / n
    for i, pt in enumerate(pts):
        y = top + i * step
        bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.6), Inches(y + 0.05), Inches(0.16), Inches(step - 0.5))
        bar.fill.solid(); bar.fill.fore_color.rgb = _RED; bar.line.fill.background(); bar.shadow.inherit = False
        _place_text(slide, 1.0, y, 6.4, 0.5, pt.get("heading", ""), 15, _WHITE, bold=True, font=_HEAD)
        _place_text(slide, 1.0, y + 0.5, 6.4, step - 0.55, pt.get("body", ""), 12.5, _LTEAL)
    # right: photo if picked, else a teal panel
    aid = spec.get("asset_id")
    ix, iy, iw, ih = 8.2, 1.95, 4.5, 4.45
    placed = False
    if aid:
        try:
            path = config.resolve_asset(config.asset_index()[aid]["path"])
            if path.exists():
                slide.shapes.add_picture(str(path), Inches(ix), Inches(iy), Inches(iw), Inches(ih)); placed = True
        except Exception:  # noqa: BLE001
            placed = False
    if not placed:
        pan = slide.shapes.add_shape(_BOX, Inches(ix), Inches(iy), Inches(iw), Inches(ih))
        pan.fill.solid(); pan.fill.fore_color.rgb = RGBColor(0x2C, 0x74, 0x82); pan.line.fill.background(); pan.shadow.inherit = False


def _fill_quote(prs, spec: dict, dark_index: int) -> None:
    """Pull quote: a large red quotation mark, the quote, and the attribution."""
    slide = prs.slides.add_slide(_blank_layout(prs, dark_index))
    for ph in list(slide.shapes):
        ph._element.getparent().remove(ph._element)
    if spec.get("title"):
        _place_text(slide, 1.2, 0.7, 11.0, 0.5, spec["title"], 14, _LTEAL, bold=True, font=_HEAD)
    _place_text(slide, 1.1, 1.3, 3.0, 1.6, "“", 120, _RED, bold=True, font=_HEAD)
    _place_text(slide, 1.5, 2.4, 10.3, 3.0, spec.get("quote", ""), 26, _WHITE, font=_HEAD, anchor=MSO_ANCHOR.TOP)
    if spec.get("author"):
        _place_text(slide, 1.5, 5.7, 10.3, 0.6, spec["author"], 15, _LTEAL, bold=True)


def _fill_comparison(prs, spec: dict, light_index: int) -> None:
    """Comparison table: a native, brand-styled table (teal header, light body) on white."""
    slide = prs.slides.add_slide(_blank_layout(prs, light_index))
    for ph in list(slide.shapes):
        ph._element.getparent().remove(ph._element)
    _set_white_bg(slide)
    _place_text(slide, 0.6, 0.5, 12.1, 0.8, spec.get("title", ""), 26, _INKC, bold=True, font=_HEAD)
    headers = spec.get("headers") or []
    rows = spec.get("rows") or []
    ncols = len(headers)
    nrows = len(rows) + 1
    if ncols < 1 or nrows < 2:
        return
    h = min(4.9, 0.5 + 0.62 * (nrows - 1))
    gf = slide.shapes.add_table(nrows, ncols, Inches(0.6), Inches(1.7), Inches(12.13), Inches(h))
    tbl = gf.table
    tbl.first_row = False; tbl.horz_banding = False
    def _cell(cell, text, *, bold, color, fill, align=PP_ALIGN.LEFT):
        cell.fill.solid(); cell.fill.fore_color.rgb = fill
        cell.margin_left = cell.margin_right = Inches(0.12)
        tf = cell.text_frame; tf.word_wrap = True
        p = tf.paragraphs[0]; p.alignment = align
        r = p.add_run(); r.text = text or ""
        r.font.size = Pt(_S_BODY); r.font.bold = bold; r.font.name = (_HEAD if bold else _BODY); r.font.color.rgb = color
    for j, head in enumerate(headers):
        _cell(tbl.cell(0, j), head, bold=True, color=_WHITE, fill=_TEAL)
    for i, row in enumerate(rows, start=1):
        cells = (row.get("cells") or [])
        band = RGBColor(0xF1, 0xF8, 0xF8) if i % 2 else _WHITE
        for j in range(ncols):
            val = cells[j] if j < len(cells) else ""
            al = PP_ALIGN.RIGHT if (j > 0 and _is_num(val)) else PP_ALIGN.LEFT   # numbers right, text left
            _cell(tbl.cell(i, j), val, bold=(j == 0), color=_INKC, fill=band, align=al)
    _hbar_table(tbl)   # horizontal row lines only


def _fill_stat(prs, spec: dict, dark_index: int) -> None:
    """Hero stats: 1-3 big red figures with labels (the '50+ / 135+' treatment)."""
    slide = prs.slides.add_slide(_blank_layout(prs, dark_index))
    for ph in list(slide.shapes):
        ph._element.getparent().remove(ph._element)
    _place_text(slide, 0.6, 0.5, 12.1, 0.8, spec.get("title", ""), 26, _WHITE, bold=True, font=_HEAD)
    if spec.get("caption"):
        _place_text(slide, 0.6, 1.45, 12.1, 0.5, spec["caption"], 13, _LTEAL, italic=True)
    stats = (spec.get("stats") or [])[:3]
    n = max(1, len(stats))
    cw = 12.0 / n
    x0 = (13.333 - 12.0) / 2
    for i, st in enumerate(stats):
        x = x0 + i * cw
        _place_text(slide, x, 2.5, cw, 1.3, st.get("value", ""), 72, _RED, bold=True, font=_HEAD, align=PP_ALIGN.CENTER)
        _place_text(slide, x + 0.2, 3.95, cw - 0.4, 0.6, st.get("label", ""), 16, _WHITE, bold=True, font=_HEAD, align=PP_ALIGN.CENTER)
        if st.get("note"):
            _place_text(slide, x + 0.3, 4.65, cw - 0.6, 1.4, st["note"], 12.5, _LTEAL, align=PP_ALIGN.CENTER)


_HB_GLYPH = {0: "○", 1: "◔", 2: "◑", 3: "◕", 4: "●"}  # ○ ◔ ◑ ◕ ●


def _fill_harvey_ball(prs, spec: dict, light_index: int) -> None:
    """Harvey-ball rating grid: criteria (rows) x options (columns), each cell a 0-4 filled circle."""
    slide = prs.slides.add_slide(_blank_layout(prs, light_index))
    for ph in list(slide.shapes):
        ph._element.getparent().remove(ph._element)
    _set_white_bg(slide)
    _place_text(slide, 0.6, 0.5, 12.1, 0.8, spec.get("title", ""), 26, _INKC, bold=True, font=_HEAD)
    options = spec.get("options") or []
    criteria = spec.get("criteria") or []
    ncols = len(options) + 1
    nrows = len(criteria) + 1
    if ncols < 2 or nrows < 2:
        return
    h = min(4.9, 0.55 + 0.62 * (nrows - 1))
    tbl = slide.shapes.add_table(nrows, ncols, Inches(0.6), Inches(1.7), Inches(12.13), Inches(h)).table
    tbl.first_row = False; tbl.horz_banding = False
    def _cell(cell, text, *, bold, color, fill, size=13, center=False, font=_BODY):
        cell.fill.solid(); cell.fill.fore_color.rgb = fill
        cell.margin_left = cell.margin_right = Inches(0.12)
        tf = cell.text_frame; tf.word_wrap = True
        p = tf.paragraphs[0]
        if center:
            p.alignment = PP_ALIGN.CENTER
        r = p.add_run(); r.text = text or ""
        r.font.size = Pt(size); r.font.bold = bold; r.font.name = font; r.font.color.rgb = color
    _cell(tbl.cell(0, 0), "", bold=True, color=_WHITE, fill=_TEAL)
    for j, opt in enumerate(options, start=1):
        _cell(tbl.cell(0, j), opt, bold=True, color=_WHITE, fill=_TEAL, center=True, font=_HEAD)
    for i, crit in enumerate(criteria, start=1):
        band = RGBColor(0xF1, 0xF8, 0xF8) if i % 2 else _WHITE
        _cell(tbl.cell(i, 0), crit.get("label", ""), bold=True, color=_INKC, fill=band)
        scores = crit.get("scores") or []
        for j in range(1, ncols):
            sc = scores[j - 1] if j - 1 < len(scores) else 0
            _cell(tbl.cell(i, j), _HB_GLYPH.get(int(sc), "○"), bold=False, color=_RED, fill=band, size=20, center=True)
    _hbar_table(tbl)   # horizontal row lines only


def _fill_timeline(prs, spec: dict, dark_index: int) -> None:
    """Horizontal timeline: dated milestones on a red line with numbered nodes."""
    slide = prs.slides.add_slide(_blank_layout(prs, dark_index))
    for ph in list(slide.shapes):
        ph._element.getparent().remove(ph._element)
    _place_text(slide, 0.6, 0.5, 12.1, 0.8, spec.get("title", ""), 26, _WHITE, bold=True, font=_HEAD)
    ms = (spec.get("milestones") or [])[:6]
    n = len(ms)
    if not n:
        return
    gap = _GUTTER
    sw = min(2.3, (12.0 - (n - 1) * gap) / n)
    total = n * sw + (n - 1) * gap
    x0 = (13.333 - total) / 2
    cy = 3.6
    cxf, cxl = x0 + sw / 2, x0 + (n - 1) * (sw + gap) + sw / 2
    line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(cxf), Inches(cy + 0.24), Inches(cxl - cxf), Inches(0.05))
    line.fill.solid(); line.fill.fore_color.rgb = _RED; line.line.fill.background(); line.shadow.inherit = False
    for i, mstone in enumerate(ms):
        x = x0 + i * (sw + gap); cx = x + sw / 2
        _place_text(slide, x, 2.5, sw, 0.4, mstone.get("date", ""), 13, _LTEAL, bold=True, font=_HEAD, align=PP_ALIGN.CENTER)
        _place_text(slide, x, 2.9, sw, 0.5, mstone.get("heading", ""), 14, _WHITE, bold=True, font=_HEAD, align=PP_ALIGN.CENTER)
        c = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - 0.11), Inches(cy + 0.11), Inches(0.3), Inches(0.3))
        c.fill.solid(); c.fill.fore_color.rgb = _RED; c.line.color.rgb = _WHITE; c.line.width = Pt(1.5); c.shadow.inherit = False
        _place_text(slide, x, cy + 0.65, sw, 1.6, mstone.get("body", ""), 12, _LTEAL, align=PP_ALIGN.CENTER)


def _fill_funnel(prs, spec: dict, dark_index: int) -> None:
    """Funnel: centred bars that narrow top-to-bottom, one per stage, heading + body."""
    slide = prs.slides.add_slide(_blank_layout(prs, dark_index))
    for ph in list(slide.shapes):
        ph._element.getparent().remove(ph._element)
    _place_text(slide, 0.6, 0.5, 12.1, 0.8, spec.get("title", ""), 26, _WHITE, bold=True, font=_HEAD)
    stages = (spec.get("stages") or [])[:5]
    n = len(stages)
    if not n:
        return
    top, wide, narrow, bh, gap = 1.9, 9.0, 4.2, 0.82, 0.18
    for i, st in enumerate(stages):
        w = wide - (wide - narrow) * (i / max(1, n - 1))
        x = (13.333 - w) / 2
        y = top + i * (bh + gap)
        bar = slide.shapes.add_shape(_BOX, Inches(x), Inches(y), Inches(w), Inches(bh))
        bar.fill.solid(); bar.fill.fore_color.rgb = _TEAL if i % 2 == 0 else RGBColor(0x2C, 0x74, 0x82)
        bar.line.fill.background(); bar.shadow.inherit = False
        tf = bar.text_frame; tf.word_wrap = True; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
        r = p.add_run(); r.text = st.get("heading", ""); r.font.size = Pt(15); r.font.bold = True
        r.font.name = _HEAD; r.font.color.rgb = _WHITE
        if st.get("body"):
            p2 = tf.add_paragraph(); p2.alignment = PP_ALIGN.CENTER
            r2 = p2.add_run(); r2.text = st["body"]; r2.font.size = Pt(10.5); r2.font.name = _BODY
            r2.font.color.rgb = RGBColor(0xE9, 0xF7, 0xF8)


def _fill_case_study(prs, spec: dict, dark_index: int) -> None:
    """Case study / proof point: study eyebrow + three equal panels (Design, Result, Takeaway)."""
    slide = prs.slides.add_slide(_blank_layout(prs, dark_index))
    for ph in list(slide.shapes):
        ph._element.getparent().remove(ph._element)
    _place_text(slide, 0.6, 0.5, 12.1, 0.8, spec.get("title", ""), _S_TITLE, _WHITE, bold=True, font=_HEAD)
    eyebrow = "CASE STUDY" + (f"   ·   {spec['study']}" if spec.get("study") else "")
    _place_text(slide, 0.6, 1.42, 12.1, 0.4, eyebrow, 12, _LTEAL, bold=True, font=_HEAD)
    blocks = [("DESIGN", spec.get("design", "")), ("RESULT", spec.get("result", "")),
              ("TAKEAWAY", spec.get("takeaway", ""))]
    pw = (12.13 - 2 * _GUTTER) / 3
    x0, top, ph = 0.6, 2.15, 4.3
    for i, (lab, body) in enumerate(blocks):
        x = x0 + i * (pw + _GUTTER)
        pan = slide.shapes.add_shape(_BOX, Inches(x), Inches(top), Inches(pw), Inches(ph))
        pan.fill.solid(); pan.fill.fore_color.rgb = _TEAL; pan.line.fill.background(); pan.shadow.inherit = False
        if lab == "RESULT":  # highlight the insight with a red top accent
            acc = slide.shapes.add_shape(_BOX, Inches(x), Inches(top), Inches(pw), Inches(0.09))
            acc.fill.solid(); acc.fill.fore_color.rgb = _RED; acc.line.fill.background(); acc.shadow.inherit = False
        _place_text(slide, x + 0.22, top + 0.22, pw - 0.44, 0.4, lab, 13, _WHITE, bold=True, font=_HEAD)
        _place_text(slide, x + 0.22, top + 0.78, pw - 0.44, ph - 1.0, body, _S_BODY, _LTEAL)


def _fill_closing(prs, spec: dict, dark_index: int) -> None:
    """Closing / contact: a closing statement, optional tagline, and contact details."""
    slide = prs.slides.add_slide(_blank_layout(prs, dark_index))
    for ph in list(slide.shapes):
        ph._element.getparent().remove(ph._element)
    bar = slide.shapes.add_shape(_BOX, Inches(0.6), Inches(2.2), Inches(0.18), Inches(1.5))
    bar.fill.solid(); bar.fill.fore_color.rgb = _RED; bar.line.fill.background(); bar.shadow.inherit = False
    _place_text(slide, 1.05, 2.2, 11.2, 1.6, spec.get("title", ""), 32, _WHITE, bold=True, font=_HEAD)
    if spec.get("tagline"):
        _place_text(slide, 1.05, 3.85, 11.2, 0.8, spec["tagline"], 16, _LTEAL)
    if spec.get("contact"):
        _place_text(slide, 1.05, 5.9, 11.2, 0.6, spec["contact"], 14, _LTEAL, bold=True, font=_HEAD)


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
        if layout_name == "matrix":
            _fill_matrix(prs, spec, dark); continue
        if layout_name == "journey":
            _fill_journey(prs, spec, dark); continue
        if layout_name == "exec_summary":
            _fill_exec_summary(prs, spec, dark); continue
        if layout_name == "quote":
            _fill_quote(prs, spec, dark); continue
        if layout_name == "comparison":
            _fill_comparison(prs, spec, light); continue
        if layout_name == "stat":
            _fill_stat(prs, spec, dark); continue
        if layout_name == "harvey_ball":
            _fill_harvey_ball(prs, spec, light); continue
        if layout_name == "timeline":
            _fill_timeline(prs, spec, dark); continue
        if layout_name == "funnel":
            _fill_funnel(prs, spec, dark); continue
        if layout_name == "case_study":
            _fill_case_study(prs, spec, dark); continue
        if layout_name == "closing":
            _fill_closing(prs, spec, dark); continue
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
