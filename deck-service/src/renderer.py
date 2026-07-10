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
import math
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


def _autofit(tf, *, shrink: bool = True) -> None:
    """Text-frame fit policy. Short single-value labels (title/heading) keep shrink-to-fit as a
    graceful last-resort guard against a 1-char overflow. Multi-line bodies/lists use `shrink=False`
    (MSO_AUTO_SIZE.NONE) so text stays at its fixed size — content is CAPPED by the schema char
    limits rather than shrunk to cram more in (client typography rule). Font/colour inherit."""
    tf.word_wrap = True
    try:
        tf.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE if shrink else MSO_AUTO_SIZE.NONE
    except Exception:  # noqa: BLE001
        pass


def _shrink_to_fit(ph, text: str, base_pt: float, min_pt: float = 18) -> None:
    """Deterministically shrink a placeholder's font so `text` fits its box (width x height). The
    template's own shrink-to-fit is unreliable in headless render, so a long title would otherwise
    overflow past its box (into the footer, or onto the content below). Estimates lines from the box
    width and steps the size down until the wrapped text fits the box height. Only ever shrinks."""
    w_in = (ph.width or 0) / 914400.0
    h_in = (ph.height or 0) / 914400.0
    if not text or w_in <= 0 or h_in <= 0:
        return
    pt = base_pt
    while pt > min_pt:
        cpl = max(1.0, (w_in * 72.0) / (pt * 0.52))     # chars per line at this size
        lines = max(1, math.ceil(len(text) / cpl))
        if lines * pt * 1.2 / 72.0 <= h_in:             # wrapped height fits the box
            break
        pt -= 1
    for p in ph.text_frame.paragraphs:
        for r in p.runs:
            r.font.size = Pt(pt)


def _set_ph_box(ph, l, t, w, h) -> None:
    """Reposition/resize a placeholder by writing its full a:xfrm directly. Safer than the python-pptx
    left/top setters, which raise on placeholders that inherit their geometry (no spPr/xfrm yet).
    l, t, w, h are EMU (ints, e.g. Inches(...))."""
    sp = ph._element
    spPr = sp.find(qn("p:spPr"))
    if spPr is None:
        spPr = sp.makeelement(qn("p:spPr"), {})
        nv = sp.find(qn("p:nvSpPr")) or sp.find(qn("p:nvPicPr"))
        (nv.addnext(spPr) if nv is not None else sp.insert(0, spPr))
    for x in spPr.findall(qn("a:xfrm")):
        spPr.remove(x)
    xfrm = spPr.makeelement(qn("a:xfrm"), {})
    off = xfrm.makeelement(qn("a:off"), {"x": str(int(l)), "y": str(int(t))})
    ext = xfrm.makeelement(qn("a:ext"), {"cx": str(int(w)), "cy": str(int(h))})
    xfrm.append(off); xfrm.append(ext)
    spPr.insert(0, xfrm)


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
    _autofit(tf, shrink=False)   # bodies/lists: cap content, do not shrink


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

    # Text-with-picture: make the title FULL WIDTH (the narrow template title box overflows a long
    # takeaway), drop the unused sub-heading, and place the body (left) and picture (right) BELOW the
    # title with a fixed margin so the body never touches the title.
    if cat["kind"] == "text_picture":
        tph = phmap.get(fields.get("title"))
        if tph is not None:
            _set_ph_box(tph, Inches(_MARGIN), Inches(0.746), Inches(_CONTENT_W), Inches(1.0))
            _shrink_to_fit(tph, str(title or ""), base_pt=32, min_pt=20)
        hidx = fields.get("heading")
        if hidx in filled and hidx in phmap:
            phmap[hidx]._element.getparent().remove(phmap[hidx]._element)
            filled.discard(hidx)
        body_top = 2.1                               # title bottom ~1.75 + a fixed ~0.35 margin
        bidx = fields.get("body"); bph = phmap.get(bidx)
        if bph is not None and bidx in filled:
            _set_ph_box(bph, Inches(_MARGIN), Inches(body_top), Inches(4.1), Inches(_BODY_BOTTOM - body_top))
        pidx = fields.get("picture")
        if pidx is not None and pidx in filled:
            # insert_picture replaced the placeholder element, so re-fetch it fresh from the slide.
            pph = next((p for p in slide.placeholders if p.placeholder_format.idx == pidx), None)
            if pph is not None:
                _set_ph_box(pph, Inches(5.0), Inches(body_top), Inches(7.83), Inches(_BODY_BOTTOM - body_top))

    # Section divider: a long section title overflows its short template box down into the footer.
    # Give it a taller box (clear of the footer) and shrink the font deterministically to fit.
    if cat["kind"] == "section":
        stph = phmap.get(fields.get("title"))
        if stph is not None and title and len(str(title)) > 40:
            _set_ph_box(stph, Inches(0.97), Inches(3.2), Inches(7.30), Inches(3.0))
            _shrink_to_fit(stph, str(title), base_pt=40, min_pt=24)

    # A takeaway title can run to two lines, but some layouts (Text Slide, Picture With Title, Title
    # Only) have a ONE-line title box, so the second line collides with the content below. When such a
    # layout gets a long title, push any filled content that sits too high down to clear a two-line
    # title. Set the FULL box from the layout (left/width too) so we don't drop the inherited width.
    title_idx = fields.get("title")
    tbox = _layout_box(layout_name, master_index, title_idx) if title_idx is not None else None
    if tbox and title and len(str(title)) > 48 and tbox[3] < Inches(0.72):   # short (1-line) title box
        safe_top = tbox[1] + int(Inches(1.02))
        for idx in filled:
            if idx == title_idx or idx in CHROME_IDX:
                continue
            box = _layout_box(layout_name, master_index, idx)
            ph = phmap.get(idx)
            if ph is None or not box or box[1] >= safe_top:
                continue
            delta = safe_top - box[1]
            ph.left, ph.width = Emu(box[0]), Emu(box[2])
            ph.top, ph.height = Emu(safe_top), Emu(max(int(Inches(0.6)), box[3] - delta))

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
_TEAL2 = RGBColor(0x2C, 0x74, 0x82)   # secondary panel teal
_PANEL = RGBColor(0xE4, 0xF1, 0xF1)
_INKC = RGBColor(0x16, 0x35, 0x36)
_LTEAL = RGBColor(0xA9, 0xDB, 0xD5)
_ONTEAL = RGBColor(0xEC, 0xF5, 0xF5)  # body text ON a solid teal panel — high contrast (LTEAL was too dim)
_WHITE = RGBColor(0xFF, 0xFF, 0xFF)
_HEAD, _BODY = "Exo 2", "+mn-lt"   # body = the theme MINOR font (embedded Manrope), referenced the same
                                   # way the template placeholders do; a hard-coded "Manrope" can bind to a
                                   # wrong/cursive installed variant instead of the embedded regular one.
_CHART_COLORS = [_RED, _TEAL2, _LTEAL, RGBColor(0x60, 0xA0, 0x9B)]
_TBL_LINE = "C9D9D9"                  # table row-line colour (hex, for XML)

# ── Consultancy design system — ONE fixed skeleton for every synthetic slide ──────────────
# Canvas is 13.333 x 7.5 in (16:9). The title, eyebrow, body zone and footer occupy identical
# positions on every slide, so nothing shifts when moving between slides. All side-by-side
# boxes use the same gutter; parallel boxes get equal heights. See _synth_slide().
_MARGIN = 0.5                          # page margin — matches the template content-title LEFT (0.5)
_CONTENT_W = 13.333 - 2 * _MARGIN      # 12.333 in usable width
_TITLE_Y, _TITLE_H = 0.746, 0.95       # title TOP matches the template's content layouts exactly, so the
_EYEBROW_Y = 1.72                      # title never shifts between a synthetic and a template slide
_BODY_TOP, _BODY_BOTTOM = 2.1, 6.7     # fixed body zone (the footer band lives below 6.7)
_BODY_H = _BODY_BOTTOM - _BODY_TOP     # 4.6 in
_GUTTER = 0.3                          # the ONE gutter between all side-by-side boxes
_PAD = 0.22                            # inner padding inside panels
_LINE_SPACING = 1.06                   # fixed line spacing, applied everywhere

# Type scale — exactly 3 text sizes (title / body / small) + one hero-figure size. Footer excluded.
# Hierarchy is expressed through WEIGHT, COLOUR and CAPS, never through extra sizes.
_SZ_TITLE = 24                         # slide headlines
_SZ_BODY = 14                          # headings (bold), body, labels, table cells, bullets
_SZ_SMALL = 11                         # eyebrows, captions, notes, footnotes, axis / step labels
_SZ_HERO = 40                          # hero data figures ONLY (stat values)

_STEP_BADGE = 0.5                      # numbered step / timeline node badge diameter
_ICON_DISC = 0.9                       # icon-circle diameter
_BOX = MSO_SHAPE.RECTANGLE            # one shape style for content boxes (square, consulting look)


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
                align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, italic=False,
                line_spacing=_LINE_SPACING):
    tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    try:
        tf.auto_size = MSO_AUTO_SIZE.NONE      # fixed size — cap content, never shrink text to fit
    except Exception:  # noqa: BLE001
        pass
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Emu(0)
    p = tf.paragraphs[0]
    p.alignment = align
    p.line_spacing = line_spacing
    r = p.add_run()
    r.text = text or ""
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.italic = italic
    r.font.name = font
    r.font.color.rgb = color
    return tb


def _synth_slide(prs, master_index, *, white=False, title=None, eyebrow=None):
    """Create a blank-layout slide with the ONE fixed skeleton every synthetic layout shares:
    chrome (footer logos / date / page number) is preserved so it sits in an identical position on
    every slide; the takeaway title and optional eyebrow are placed in their fixed boxes. Returns the
    slide with the body zone (_BODY_TOP.._BODY_BOTTOM) free for the builder to fill."""
    slide = prs.slides.add_slide(_blank_layout(prs, master_index))
    for sh in list(slide.shapes):
        if sh.is_placeholder and sh.placeholder_format.idx in CHROME_IDX:
            continue                            # keep date/footer/slide-number → cross-slide consistency
        sh._element.getparent().remove(sh._element)
    if white:
        _set_white_bg(slide)
    if title is not None:
        _place_text(slide, _MARGIN, _TITLE_Y, _CONTENT_W, _TITLE_H, title, _SZ_TITLE,
                    _INKC if white else _WHITE, bold=True, font=_HEAD)
    if eyebrow is not None:
        _place_text(slide, _MARGIN, _EYEBROW_Y, _CONTENT_W, 0.4, eyebrow, _SZ_SMALL,
                    _TEAL if white else _LTEAL, bold=True, font=_HEAD)
    return slide


def _consistent_icons(objs):
    """All-or-nothing, one-source, distinct brand icons for a list of objects carrying icon/icon_generic.
    Returns a list of icon paths (one per object) or None if the set can't be cleanly covered — so a
    layout shows a full icon set or none, never a half-empty/mixed ring (the tell-tale AI look)."""
    def _c(paths):
        s = [str(p) for p in paths]
        return paths if paths and all(paths) and len(set(s)) == len(s) else None
    return (_c([_icon_path(o.get("icon")) for o in objs])
            or _c([_generic_icon_path(o.get("icon_generic")) for o in objs]))


def _icon_disc(slide, cx, cy, d, icon_path=None, number=None):
    """A soft light disc centred at (cx, cy) holding the red brand icon (or a red number) — the
    consulting 'icon chip' treatment that replaces ad-hoc accent bars on list slides."""
    disc = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - d / 2), Inches(cy - d / 2), Inches(d), Inches(d))
    disc.fill.solid(); disc.fill.fore_color.rgb = _PANEL; disc.line.fill.background(); disc.shadow.inherit = False
    if icon_path:
        pad = d * 0.28
        _place_icon(slide, (Inches(cx - d / 2 + pad), Inches(cy - d / 2 + pad), Inches(d - 2 * pad), Inches(d - 2 * pad)), icon_path)
    elif number is not None:
        tf = disc.text_frame; tf.word_wrap = False; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        tf.text = str(number)
        rr = tf.paragraphs[0].runs[0]
        rr.font.size = Pt(_SZ_BODY); rr.font.bold = True; rr.font.color.rgb = _RED; rr.font.name = _HEAD
        tf.paragraphs[0].alignment = PP_ALIGN.CENTER
    return disc


def _place_bullets(slide, l, t, w, h, lines, size, color, *, font=_BODY,
                   anchor=MSO_ANCHOR.TOP, rid=None):
    """Render lines as a Superba teal picture-bullet list in a synthetic textbox (the standard brand
    bullet). A single line still gets a bullet, so lists read consistently across the deck."""
    lines = [ln.strip() for ln in lines if ln and ln.strip()]
    tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    try:
        tf.auto_size = MSO_AUTO_SIZE.NONE
    except Exception:  # noqa: BLE001
        pass
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Emu(0)
    if rid is None:
        rid = _bullet_rid(slide)
    for i, ln in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.line_spacing = _LINE_SPACING
        p.space_after = Pt(6)
        r = p.add_run(); r.text = ln
        r.font.size = Pt(size); r.font.name = font; r.font.color.rgb = color
        if rid:
            _apply_picture_bullet(p._p, rid)
    return tb


def _fill_key_points(prs, spec: dict, light_index: int) -> None:
    """'Key points' cards: a teal banner, then equal-height panels with a brand icon in a circle,
    a heading and a body. Icons are all-or-nothing from ONE source (never a partial/empty set)."""
    slide = _synth_slide(prs, light_index, white=True, title=spec.get("title", ""))
    banner = spec.get("banner")
    if banner:
        ban = slide.shapes.add_shape(_BOX, Inches(_MARGIN), Inches(_EYEBROW_Y), Inches(_CONTENT_W), Inches(0.55))
        ban.fill.solid(); ban.fill.fore_color.rgb = _TEAL; ban.line.fill.background(); ban.shadow.inherit = False
        tf = ban.text_frame; tf.word_wrap = True; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER; p.line_spacing = _LINE_SPACING
        r = p.add_run(); r.text = banner; r.font.size = Pt(_SZ_BODY); r.font.bold = True
        r.font.name = _HEAD; r.font.color.rgb = _WHITE

    items = (spec.get("items") or [])[:4]
    n = len(items)
    if not n:
        return
    icons = _consistent_icons(items)              # all-or-nothing, one source, distinct (no AI-look ring)
    d = _ICON_DISC
    ptop = (_EYEBROW_Y + 0.55 + d / 2 + 0.05) if banner else (_BODY_TOP + d / 2)
    if not icons:
        ptop = (_EYEBROW_Y + 0.75) if banner else _BODY_TOP
    pbot = _BODY_BOTTOM
    pw = (_CONTENT_W - (n - 1) * _GUTTER) / n     # equal panel widths, one standard gutter
    for i, it in enumerate(items):
        x = _MARGIN + i * (pw + _GUTTER); cx = x + pw / 2
        pan = slide.shapes.add_shape(_BOX, Inches(x), Inches(ptop), Inches(pw), Inches(pbot - ptop))
        pan.fill.solid(); pan.fill.fore_color.rgb = _PANEL; pan.line.fill.background(); pan.shadow.inherit = False
        hy = ptop + (0.6 if icons else 0.22)
        if icons:
            circ = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - d / 2), Inches(ptop - d / 2), Inches(d), Inches(d))
            circ.fill.solid(); circ.fill.fore_color.rgb = _WHITE
            circ.line.color.rgb = _RED; circ.line.width = Pt(2.25); circ.shadow.inherit = False
            _place_icon(slide, (Inches(cx - 0.26), Inches(ptop - 0.26), Inches(0.52), Inches(0.52)), icons[i])
        _place_text(slide, x + _PAD, hy, pw - 2 * _PAD, 0.5, it.get("heading", ""), _SZ_BODY, _INKC,
                    bold=True, font=_HEAD, align=PP_ALIGN.CENTER)
        # Body as standard Superba teal bullets (one short point per line).
        _place_bullets(slide, x + _PAD, hy + 0.6, pw - 2 * _PAD, pbot - (hy + 0.6) - _PAD,
                       str(it.get("body", "")).split("\n"), _SZ_SMALL, _INKC)


_CHART_TYPES = {"column": XL_CHART_TYPE.COLUMN_CLUSTERED, "bar": XL_CHART_TYPE.BAR_CLUSTERED,
                "line": XL_CHART_TYPE.LINE, "stacked_column": XL_CHART_TYPE.COLUMN_STACKED,
                "stacked_100": XL_CHART_TYPE.COLUMN_STACKED_100, "doughnut": XL_CHART_TYPE.DOUGHNUT}


def _fill_chart(prs, spec: dict, dark_index: int) -> None:
    """Native, editable PowerPoint chart from the plan's categories + series, brand-coloured, on the
    deep-sea master (inherits background + logos). Data comes only from the plan (claim fidelity)."""
    slide = _synth_slide(prs, dark_index, title=spec.get("title", ""),
                         eyebrow=spec.get("caption"))

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
    gf = slide.shapes.add_chart(ctype, Inches(0.9), Inches(_BODY_TOP), Inches(11.5), Inches(_BODY_H - 0.35), cd)
    chart = gf.chart
    chart.has_title = False                # no auto series-name title (we use the slide title)
    chart.font.color.rgb = _WHITE
    chart.font.size = Pt(_SZ_SMALL)
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

    # Axis titles — mandatory for charts with axes (doughnut has none). The category axis takes the
    # dimension (x_axis), the value axis takes what is measured + units (y_axis); on a bar chart these
    # are visually swapped but stay semantically correct.
    if not is_round:
        def _axis_title(axis, text):
            axis.has_title = True
            tf = axis.axis_title.text_frame
            tf.text = text
            run = tf.paragraphs[0].runs[0]
            run.font.color.rgb = _WHITE
            run.font.size = Pt(_SZ_SMALL)
            run.font.name = _BODY
            run.font.bold = True
        try:
            if spec.get("x_axis"):
                _axis_title(chart.category_axis, spec["x_axis"])
            if spec.get("y_axis"):
                _axis_title(chart.value_axis, spec["y_axis"])
        except (ValueError, KeyError, IndexError):  # axis absent for this chart type
            pass

    # Line charts: pull the plot to the axis edges (first category flush left) instead of the default
    # half-category padding, so the first point (e.g. "Day 0") sits at the left edge.
    if spec.get("chart_type") == "line":
        try:
            valAx = chart.value_axis._element
            existing = valAx.find(qn("c:crossBetween"))
            if existing is not None:
                existing.set("val", "midCat")
            else:
                anchor = None
                for tag in ("c:crossAx", "c:crosses", "c:crossesAt"):
                    el = valAx.find(qn(tag))
                    if el is not None:
                        anchor = el
                cb = valAx.makeelement(qn("c:crossBetween"), {"val": "midCat"})
                anchor.addnext(cb) if anchor is not None else valAx.append(cb)
        except Exception:  # noqa: BLE001
            pass

    # Think-cell-style delta callout: for a 2-bar single-series column chart, reserve headroom on the
    # value axis, then draw a bracket spanning the two columns with a red delta chip (the % change) —
    # the classic "highlight the difference" annotation.
    if spec.get("chart_type", "column") == "column" and len(cats) == 2 and len(series) == 1:
        vals = [v for v in (series[0].get("values") or []) if isinstance(v, (int, float))]
        if len(vals) == 2 and (vals[0] or vals[1]):
            v0, v1 = vals[0], vals[1]
            label = (f"{'+' if v1 >= v0 else ''}{(v1 - v0) / abs(v0) * 100:.0f}%") if v0 else f"+{v1 - v0:g}"
            arrow = "▲" if v1 >= v0 else "▼"
            try:
                chart.value_axis.minimum_scale = 0
                chart.value_axis.maximum_scale = max(vals) * 1.35     # guaranteed headroom for the callout
            except Exception:  # noqa: BLE001
                pass
            fx, fy, fw, fh = 0.9, _BODY_TOP, 11.5, _BODY_H - 0.35
            plot_l, plot_w = fx + 0.75, fw - 0.95
            plot_top, plot_bot = fy + 0.15, fy + fh - 0.55
            cx0 = plot_l + plot_w * 0.25
            cx1 = plot_l + plot_w * 0.75
            by = max(plot_top + 0.2, plot_bot - (plot_bot - plot_top) / 1.35 - 0.3)   # just above the tall bar
            ln = slide.shapes.add_shape(_BOX, Inches(cx0), Inches(by), Inches(cx1 - cx0), Inches(0.035))
            ln.fill.solid(); ln.fill.fore_color.rgb = _RED; ln.line.fill.background(); ln.shadow.inherit = False
            for cxe in (cx0, cx1):
                tick = slide.shapes.add_shape(_BOX, Inches(cxe - 0.017), Inches(by), Inches(0.035), Inches(0.16))
                tick.fill.solid(); tick.fill.fore_color.rgb = _RED; tick.line.fill.background(); tick.shadow.inherit = False
            cw, ch = 1.5, 0.44
            chip = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches((cx0 + cx1) / 2 - cw / 2),
                                          Inches(by - ch - 0.08), Inches(cw), Inches(ch))
            chip.fill.solid(); chip.fill.fore_color.rgb = _RED; chip.line.fill.background(); chip.shadow.inherit = False
            ctf = chip.text_frame; ctf.word_wrap = False; ctf.vertical_anchor = MSO_ANCHOR.MIDDLE
            ctf.margin_top = ctf.margin_bottom = Emu(0)
            cp = ctf.paragraphs[0]; cp.alignment = PP_ALIGN.CENTER
            cr = cp.add_run(); cr.text = f"{arrow} {label}"; cr.font.size = Pt(_SZ_BODY); cr.font.bold = True
            cr.font.name = _HEAD; cr.font.color.rgb = _WHITE


def _fill_matrix(prs, spec: dict, dark_index: int) -> None:
    """2x2 matrix: four equal teal quadrants separated by the standard gutter, with axis labels."""
    slide = _synth_slide(prs, dark_index, title=spec.get("title", ""))
    quads = (spec.get("quadrants") or [])[:4]
    mx, my = 3.0, _BODY_TOP
    mw = 13.333 - _MARGIN - mx
    mh = _BODY_BOTTOM - my - 0.45          # leave room for the x-axis label below
    gap = _GUTTER
    qw, qh = (mw - gap) / 2, (mh - gap) / 2
    pos = [(mx, my), (mx + qw + gap, my), (mx, my + qh + gap), (mx + qw + gap, my + qh + gap)]
    for i, q in enumerate(quads):
        x, y = pos[i]
        pan = slide.shapes.add_shape(_BOX, Inches(x), Inches(y), Inches(qw), Inches(qh))
        pan.fill.solid(); pan.fill.fore_color.rgb = _TEAL; pan.line.fill.background(); pan.shadow.inherit = False
        _place_text(slide, x + _PAD, y + 0.16, qw - 2 * _PAD, 0.45, q.get("heading", ""), _SZ_BODY, _WHITE, bold=True, font=_HEAD)
        _place_text(slide, x + _PAD, y + 0.66, qw - 2 * _PAD, qh - 0.82, q.get("body", ""), _SZ_BODY, _ONTEAL)
    if spec.get("y_axis"):
        _place_text(slide, _MARGIN, my, mx - _MARGIN - 0.15, mh, spec["y_axis"], _SZ_SMALL, _LTEAL,
                    bold=True, font=_HEAD, anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.CENTER)
    if spec.get("x_axis"):
        _place_text(slide, mx, my + mh + 0.08, mw, 0.35, spec["x_axis"], _SZ_SMALL, _LTEAL,
                    bold=True, font=_HEAD, align=PP_ALIGN.CENTER)


def _fill_journey(prs, spec: dict, dark_index: int) -> None:
    """Horizontal process journey: a red connector with numbered nodes; heading + body per step."""
    slide = _synth_slide(prs, dark_index, title=spec.get("title", ""))
    steps = (spec.get("steps") or [])[:5]
    n = len(steps)
    if not n:
        return
    sw = min(2.6, (_CONTENT_W - (n - 1) * _GUTTER) / n)
    total = n * sw + (n - 1) * _GUTTER
    x0 = (13.333 - total) / 2
    line_y = _BODY_TOP + 1.5                # vertical centre of the connector + nodes
    d = _STEP_BADGE
    cxf, cxl = x0 + sw / 2, x0 + (n - 1) * (sw + _GUTTER) + sw / 2
    line = slide.shapes.add_shape(_BOX, Inches(cxf), Inches(line_y - 0.03), Inches(cxl - cxf), Inches(0.06))
    line.fill.solid(); line.fill.fore_color.rgb = _RED; line.line.fill.background(); line.shadow.inherit = False
    for i, st in enumerate(steps):
        x = x0 + i * (sw + _GUTTER); cx = x + sw / 2
        _place_text(slide, x, _BODY_TOP + 0.4, sw, line_y - d / 2 - (_BODY_TOP + 0.4) - 0.1,
                    st.get("heading", ""), _SZ_BODY, _WHITE, bold=True, font=_HEAD,
                    align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.BOTTOM)
        c = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - d / 2), Inches(line_y - d / 2), Inches(d), Inches(d))
        c.fill.solid(); c.fill.fore_color.rgb = _RED; c.line.color.rgb = _WHITE; c.line.width = Pt(1.5); c.shadow.inherit = False
        c.text_frame.word_wrap = False; c.text_frame.vertical_anchor = MSO_ANCHOR.MIDDLE
        c.text_frame.text = str(i + 1)
        rr = c.text_frame.paragraphs[0].runs[0]
        rr.font.size = Pt(_SZ_BODY); rr.font.bold = True; rr.font.color.rgb = _WHITE; rr.font.name = _HEAD
        c.text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER
        _place_text(slide, x, line_y + d / 2 + 0.15, sw, _BODY_BOTTOM - (line_y + d / 2 + 0.15),
                    st.get("body", ""), _SZ_SMALL, _LTEAL, align=PP_ALIGN.CENTER)


def _fill_exec_summary(prs, spec: dict, dark_index: int) -> None:
    """Executive summary: key points as icon-chip rows on the left, a picture (or teal panel) on the right.
    Each point gets its own icon disc (a brand icon, or a numbered chip) — the consulting look, no accent bars."""
    slide = _synth_slide(prs, dark_index, title=spec.get("title", ""))
    pts = (spec.get("points") or [])[:4]
    n = max(1, len(pts))
    icons = _consistent_icons(pts)
    left_w = 7.0
    disc = 0.72
    text_x = _MARGIN + disc + 0.3
    tw = left_w - (disc + 0.3)
    step = _BODY_H / n                     # equal vertical slot per point
    for i, pt in enumerate(pts):
        y = _BODY_TOP + i * step
        _icon_disc(slide, _MARGIN + disc / 2, y + 0.42, disc,
                   icon_path=(icons[i] if icons else None), number=(None if icons else i + 1))
        _place_text(slide, text_x, y + 0.12, tw, 0.5, pt.get("heading", ""), _SZ_BODY, _WHITE, bold=True, font=_HEAD)
        _place_text(slide, text_x, y + 0.6, tw, step - 0.68, pt.get("body", ""), _SZ_BODY, _LTEAL)
    # right: photo if picked, else a teal panel — spans the full body zone
    ix = _MARGIN + left_w + 0.6
    iw = 13.333 - _MARGIN - ix
    iy, ih = _BODY_TOP, _BODY_H
    aid = spec.get("asset_id")
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
        pan.fill.solid(); pan.fill.fore_color.rgb = _TEAL2; pan.line.fill.background(); pan.shadow.inherit = False


def _fill_quote(prs, spec: dict, dark_index: int) -> None:
    """Pull quote: the quotation set in the title size + attribution. Clean typography, no accent bar."""
    slide = _synth_slide(prs, dark_index, eyebrow=spec.get("title"))
    qy, qh = _BODY_TOP + 0.5, 2.8
    quote = spec.get("quote", "")
    _place_text(slide, _MARGIN, qy, _CONTENT_W, qh, f"“{quote}”" if quote else "",
                _SZ_TITLE, _WHITE, font=_HEAD, anchor=MSO_ANCHOR.TOP)
    if spec.get("author"):
        _place_text(slide, _MARGIN, qy + qh + 0.15, _CONTENT_W, 0.5, spec["author"],
                    _SZ_SMALL, _LTEAL, bold=True, font=_HEAD)


def _fill_comparison(prs, spec: dict, light_index: int) -> None:
    """Comparison table: a native, brand-styled table (teal header, light body) on white."""
    slide = _synth_slide(prs, light_index, white=True, title=spec.get("title", ""))
    headers = spec.get("headers") or []
    rows = spec.get("rows") or []
    ncols = len(headers)
    nrows = len(rows) + 1
    if ncols < 1 or nrows < 2:
        return
    h = min(_BODY_H, 0.5 + 0.62 * (nrows - 1))
    gf = slide.shapes.add_table(nrows, ncols, Inches(_MARGIN), Inches(_BODY_TOP), Inches(_CONTENT_W), Inches(h))
    tbl = gf.table
    tbl.first_row = False; tbl.horz_banding = False
    def _cell(cell, text, *, bold, color, fill, align=PP_ALIGN.LEFT):
        cell.fill.solid(); cell.fill.fore_color.rgb = fill
        cell.margin_left = cell.margin_right = Inches(0.12)
        tf = cell.text_frame; tf.word_wrap = True
        p = tf.paragraphs[0]; p.alignment = align
        r = p.add_run(); r.text = text or ""
        r.font.size = Pt(_SZ_BODY); r.font.bold = bold; r.font.name = (_HEAD if bold else _BODY); r.font.color.rgb = color
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
    slide = _synth_slide(prs, dark_index, title=spec.get("title", ""), eyebrow=spec.get("caption"))
    stats = (spec.get("stats") or [])[:3]
    n = max(1, len(stats))
    cw = (_CONTENT_W - (n - 1) * _GUTTER) / n     # equal columns, one standard gutter
    vy = _BODY_TOP + 0.8
    for i, st in enumerate(stats):
        x = _MARGIN + i * (cw + _GUTTER)
        _place_text(slide, x, vy, cw, 1.0, st.get("value", ""), _SZ_HERO, _RED, bold=True, font=_HEAD, align=PP_ALIGN.CENTER)
        _place_text(slide, x, vy + 1.05, cw, 0.5, st.get("label", ""), _SZ_BODY, _WHITE, bold=True, font=_HEAD, align=PP_ALIGN.CENTER)
        if st.get("note"):
            _place_text(slide, x + 0.2, vy + 1.6, cw - 0.4, 1.4, st["note"], _SZ_SMALL, _LTEAL, align=PP_ALIGN.CENTER)


_HB_GLYPH = {0: "○", 1: "◔", 2: "◑", 3: "◕", 4: "●"}  # ○ ◔ ◑ ◕ ●


def _fill_harvey_ball(prs, spec: dict, light_index: int) -> None:
    """Harvey-ball rating grid: criteria (rows) x options (columns), each cell a 0-4 filled circle."""
    slide = _synth_slide(prs, light_index, white=True, title=spec.get("title", ""))
    options = spec.get("options") or []
    criteria = spec.get("criteria") or []
    ncols = len(options) + 1
    nrows = len(criteria) + 1
    if ncols < 2 or nrows < 2:
        return
    h = min(_BODY_H, 0.55 + 0.62 * (nrows - 1))
    tbl = slide.shapes.add_table(nrows, ncols, Inches(_MARGIN), Inches(_BODY_TOP), Inches(_CONTENT_W), Inches(h)).table
    tbl.first_row = False; tbl.horz_banding = False
    def _cell(cell, text, *, bold, color, fill, size=_SZ_BODY, center=False, font=_BODY):
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
            _cell(tbl.cell(i, j), _HB_GLYPH.get(int(sc), "○"), bold=False, color=_RED, fill=band, size=_SZ_TITLE, center=True)
    _hbar_table(tbl)   # horizontal row lines only


def _fill_timeline(prs, spec: dict, dark_index: int) -> None:
    """Horizontal timeline: dated milestones on a red connector with round nodes."""
    slide = _synth_slide(prs, dark_index, title=spec.get("title", ""))
    ms = (spec.get("milestones") or [])[:6]
    n = len(ms)
    if not n:
        return
    sw = min(2.3, (_CONTENT_W - (n - 1) * _GUTTER) / n)
    total = n * sw + (n - 1) * _GUTTER
    x0 = (13.333 - total) / 2
    line_y = _BODY_TOP + 1.4
    dot = 0.28
    cxf, cxl = x0 + sw / 2, x0 + (n - 1) * (sw + _GUTTER) + sw / 2
    line = slide.shapes.add_shape(_BOX, Inches(cxf), Inches(line_y - 0.025), Inches(cxl - cxf), Inches(0.05))
    line.fill.solid(); line.fill.fore_color.rgb = _RED; line.line.fill.background(); line.shadow.inherit = False
    for i, mstone in enumerate(ms):
        x = x0 + i * (sw + _GUTTER); cx = x + sw / 2
        _place_text(slide, x, _BODY_TOP, sw, 0.35, mstone.get("date", ""), _SZ_SMALL, _LTEAL, bold=True, font=_HEAD, align=PP_ALIGN.CENTER)
        _place_text(slide, x, _BODY_TOP + 0.38, sw, line_y - dot / 2 - (_BODY_TOP + 0.38) - 0.05,
                    mstone.get("heading", ""), _SZ_BODY, _WHITE, bold=True, font=_HEAD,
                    align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.BOTTOM)
        c = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - dot / 2), Inches(line_y - dot / 2), Inches(dot), Inches(dot))
        c.fill.solid(); c.fill.fore_color.rgb = _RED; c.line.color.rgb = _WHITE; c.line.width = Pt(1.5); c.shadow.inherit = False
        _place_text(slide, x, line_y + dot / 2 + 0.15, sw, _BODY_BOTTOM - (line_y + dot / 2 + 0.15),
                    mstone.get("body", ""), _SZ_SMALL, _LTEAL, align=PP_ALIGN.CENTER)


def _fill_funnel(prs, spec: dict, dark_index: int) -> None:
    """Funnel: centred bars that narrow top-to-bottom, one per stage, heading + body."""
    slide = _synth_slide(prs, dark_index, title=spec.get("title", ""))
    stages = (spec.get("stages") or [])[:5]
    n = len(stages)
    if not n:
        return
    wide, narrow = 9.0, 4.5
    bh = (_BODY_H - (n - 1) * _GUTTER) / n          # bars fill the body zone, one standard gutter
    for i, st in enumerate(stages):
        w = wide - (wide - narrow) * (i / max(1, n - 1))
        x = (13.333 - w) / 2
        y = _BODY_TOP + i * (bh + _GUTTER)
        bar = slide.shapes.add_shape(_BOX, Inches(x), Inches(y), Inches(w), Inches(bh))
        bar.fill.solid(); bar.fill.fore_color.rgb = _TEAL if i % 2 == 0 else _TEAL2
        bar.line.fill.background(); bar.shadow.inherit = False
        tf = bar.text_frame; tf.word_wrap = True; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER; p.line_spacing = _LINE_SPACING
        r = p.add_run(); r.text = st.get("heading", ""); r.font.size = Pt(_SZ_BODY); r.font.bold = True
        r.font.name = _HEAD; r.font.color.rgb = _WHITE
        if st.get("body"):
            p2 = tf.add_paragraph(); p2.alignment = PP_ALIGN.CENTER; p2.line_spacing = _LINE_SPACING
            r2 = p2.add_run(); r2.text = st["body"]; r2.font.size = Pt(_SZ_SMALL); r2.font.name = _BODY
            r2.font.color.rgb = RGBColor(0xE9, 0xF7, 0xF8)


def _fill_case_study(prs, spec: dict, dark_index: int) -> None:
    """Case study / proof point: study eyebrow + three compact panels (Design, Result, Takeaway), each
    with an icon chip and a red accent on Result. Body text is bright for contrast on the teal panel."""
    eyebrow = "CASE STUDY" + (f"   ·   {spec['study']}" if spec.get("study") else "")
    slide = _synth_slide(prs, dark_index, title=spec.get("title", ""), eyebrow=eyebrow)
    blocks = [("DESIGN", spec.get("design", ""), "research"),
              ("RESULT", spec.get("result", ""), "proven"),
              ("TAKEAWAY", spec.get("takeaway", ""), "molecule")]
    pw = (_CONTENT_W - 2 * _GUTTER) / 3            # three equal panels, one standard gutter
    panh = 3.4
    top = _BODY_TOP + (_BODY_H - panh) / 2 + 0.1   # compact panels, vertically centred in the body zone
    dd = 0.62
    for i, (lab, body, ic) in enumerate(blocks):
        x = _MARGIN + i * (pw + _GUTTER)
        pan = slide.shapes.add_shape(_BOX, Inches(x), Inches(top), Inches(pw), Inches(panh))
        pan.fill.solid(); pan.fill.fore_color.rgb = _TEAL; pan.line.fill.background(); pan.shadow.inherit = False
        # Every panel gets the SAME subtle top accent (associated light teal) — never single one out.
        acc = slide.shapes.add_shape(_BOX, Inches(x), Inches(top), Inches(pw), Inches(0.07))
        acc.fill.solid(); acc.fill.fore_color.rgb = _LTEAL; acc.line.fill.background(); acc.shadow.inherit = False
        _icon_disc(slide, x + _PAD + dd / 2, top + 0.34 + dd / 2, dd, icon_path=_generic_icon_path(ic))
        _place_text(slide, x + _PAD + dd + 0.18, top + 0.34, pw - 2 * _PAD - dd - 0.18, dd, lab,
                    _SZ_SMALL, _WHITE, bold=True, font=_HEAD, anchor=MSO_ANCHOR.MIDDLE)
        _place_text(slide, x + _PAD, top + dd + 0.6, pw - 2 * _PAD, panh - (dd + 0.6) - _PAD,
                    body, _SZ_BODY, _ONTEAL)


def _fill_closing(prs, spec: dict, dark_index: int) -> None:
    """Closing / contact: a closing statement, optional tagline, and contact details."""
    slide = _synth_slide(prs, dark_index)
    cy = 2.6
    bar = slide.shapes.add_shape(_BOX, Inches(_MARGIN), Inches(cy), Inches(0.16), Inches(1.5))
    bar.fill.solid(); bar.fill.fore_color.rgb = _RED; bar.line.fill.background(); bar.shadow.inherit = False
    _place_text(slide, _MARGIN + 0.45, cy, _CONTENT_W - 0.5, 1.6, spec.get("title", ""), _SZ_TITLE, _WHITE, bold=True, font=_HEAD)
    if spec.get("tagline"):
        _place_text(slide, _MARGIN + 0.45, cy + 1.6, _CONTENT_W - 0.5, 0.8, spec["tagline"], _SZ_BODY, _LTEAL)
    if spec.get("contact"):
        _place_text(slide, _MARGIN + 0.45, _BODY_BOTTOM - 0.5, _CONTENT_W - 0.5, 0.5, spec["contact"], _SZ_SMALL, _LTEAL, bold=True, font=_HEAD)


def _slide_has_white_bg(slide) -> bool:
    cSld = slide._element.find(qn("p:cSld"))
    bg = cSld.find(qn("p:bg")) if cSld is not None else None
    return bg is not None and "FFFFFF" in (bg.xml or "")


def _add_page_number(slide, n: int) -> None:
    """A page number in an identical bottom-centre position on every slide (the template carries none),
    coloured for the slide's background. Footer element — excluded from the type-scale count."""
    color = _TEAL if _slide_has_white_bg(slide) else _LTEAL
    tb = slide.shapes.add_textbox(Inches((13.333 - 1.0) / 2), Inches(7.06), Inches(1.0), Inches(0.3))
    tf = tb.text_frame
    tf.word_wrap = False
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = Emu(0)
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = str(n)
    r.font.size = Pt(10)
    r.font.name = _BODY
    r.font.color.rgb = color


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

    # Page numbers in a fixed position on every slide (cover excluded), stamped in final order.
    for i, slide in enumerate(prs.slides):
        if i == 0:
            continue
        _add_page_number(slide, i + 1)

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()
