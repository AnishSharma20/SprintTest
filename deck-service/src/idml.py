"""IDML story line mapping — the text fill primitives behind the InDesign whitepaper.

An .idml is a zip of XML; a story's text lives in <Content> runs separated by <Br/>
elements. Everything here rewrites ONLY the text inside existing <Content> nodes, line by
line: bullet markers ("•" runs) and leading tabs are preserved; paragraph styles,
threading, images, geometry and the whole design are inherited untouched, the exact
contract the deck renderer has with template.pptx. Content is capped to each line's
budget, not shrunk.

Consumed by idml_library.py (the mixed pages whitepaper, the one whitepaper flavour the
tool offers) and by the scripts/ that measure the page library. The single template
(Healthy Aging) fill this module was born for is gone; mixed pages replaced it.

No headless IDML renderer exists (InDesign Server is paid), so there is no visual QA gate
here; safety is deterministic: schema fixed slot counts + budgets measured from the template.
"""
from __future__ import annotations

import re
from xml.etree import ElementTree as ET


_MARKER_RE = re.compile(r"^[\s•·▪‣﻿ ]*$")  # bullet/space-only runs
_NS = "http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"
ET.register_namespace("idPkg", _NS)


# ---------------------------------------------------------------------------
# Story text model: a story is a sequence of LINES; a line is the list of <Content>
# elements between <Br/> elements (in document order, across style ranges).
# ---------------------------------------------------------------------------

def story_lines(root: ET.Element) -> list[list[ET.Element]]:
    lines: list[list[ET.Element]] = []
    cur: list[ET.Element] = []
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "Content":
            cur.append(el)
        elif tag == "Br":
            lines.append(cur)
            cur = []
    lines.append(cur)
    return lines


def line_text(line: list[ET.Element]) -> str:
    return "".join(c.text or "" for c in line)


def payload_lines(root: ET.Element) -> list[list[ET.Element]]:
    """Lines that carry real text (not empty spacers, not bullet-marker-only runs)."""
    return [ln for ln in story_lines(root) if not _MARKER_RE.fullmatch(line_text(ln) or "")]


def payload_text(line: list[ET.Element]) -> str:
    """A line's text minus any leading bullet marker/tab prefix (what the budget measures)."""
    return re.sub(r"^[\s•·▪‣﻿]+", "", line_text(line))


def set_line(line: list[ET.Element], text: str) -> None:
    """Write `text` into a line, keeping bullet-marker runs and the leading tab intact."""
    wrote = False
    for c in line:
        t = c.text or ""
        if not wrote and _MARKER_RE.fullmatch(t):
            continue  # keep the "•" marker run untouched
        if not wrote:
            lead = re.match(r"[\s﻿]*", t).group(0)
            c.text = lead + text
            wrote = True
        else:
            c.text = ""
    if not wrote and line:  # marker-only line (shouldn't happen for payload lines)
        line[-1].text = (line[-1].text or "") + text


def truncate(text: str, cap: int) -> str:
    """Cap, not shrink: cut at the last sentence end (else word end) under the budget."""
    text = (text or "").strip()
    if len(text) <= cap:
        return text
    cut = text[:cap]
    dot = cut.rfind(". ")
    if dot > cap * 0.5:
        return cut[: dot + 1]
    sp = cut.rfind(" ")
    return (cut[:sp] if sp > 0 else cut).rstrip(",;: ")


# ---------------------------------------------------------------------------
# Serialization — byte-faithful except for the Content text we changed.
# ---------------------------------------------------------------------------

def _parse_story(data: bytes) -> ET.Element:
    return ET.fromstring(data.decode("utf-8"))


def _serialize_story(root: ET.Element) -> bytes:
    body = ET.tostring(root, encoding="unicode")
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + body).encode("utf-8")


# ---------------------------------------------------------------------------
# Fill engine
# ---------------------------------------------------------------------------

def _strip_dashes(s: str) -> str:
    from .blog import strip_dashes  # late import to avoid cycles
    return strip_dashes(s)


_LEAD_MARKER_RE = re.compile(r"^\s*[•·▪‣\-\*–—]+\s+")


def _strip_lead_marker(s: str) -> str:
    """Drop a leading bullet/dash the model may have added — the template frames already carry
    their own bullet marker, so a model-supplied one renders as a doubled bullet."""
    return _LEAD_MARKER_RE.sub("", s or "")


def _trim_trailing_empty_paragraphs(root: ET.Element) -> None:
    """Drop paragraphs left empty at the END of a story.

    Blanking a line is not enough when the paragraph style auto-numbers: an emptied entry in the
    reference list still renders its number, so a document citing 3 sources showed "4." to "11."
    as bare numerals. Removing the trailing <Br/> removes the paragraph itself.
    """
    parents = {child: parent for parent in root.iter() for child in parent}
    while True:
        brs = [el for el in root.iter() if el.tag.rsplit("}", 1)[-1] == "Br"]
        if not brs:
            return
        last = brs[-1]
        # Everything after the final Br is the last paragraph; if it carries no text, drop it.
        seen_last = False
        tail: list[ET.Element] = []
        for el in root.iter():
            tag = el.tag.rsplit("}", 1)[-1]
            if el is last:
                seen_last = True
                continue
            if seen_last and tag == "Content":
                tail.append(el)
        if any((el.text or "").strip() for el in tail):
            return
        for el in (*tail, last):
            parent = parents.get(el)
            if parent is not None:
                parent.remove(el)
        parents = {child: parent for parent in root.iter() for child in parent}


def _fill_story_texts(xml: bytes, texts: list[str], caps: list[int]) -> bytes:
    """Map `texts` onto the story's payload lines 1:1; blank leftover lines; merge overflow
    items into the last text so nothing is silently dropped."""
    root = _parse_story(xml)
    lines = payload_lines(root)
    if not lines:
        return xml
    if len(texts) > len(lines):
        head, tail = texts[: len(lines) - 1], texts[len(lines) - 1:]
        texts = head + [" ".join(t for t in tail if t)]
    for i, ln in enumerate(lines):
        if i < len(texts):
            cap = caps[i] if i < len(caps) else (caps[-1] if caps else 400)
            set_line(ln, truncate(_strip_lead_marker(_strip_dashes(texts[i] or "")), cap))
        else:
            set_line(ln, "")
    if len(texts) < len(lines):
        _trim_trailing_empty_paragraphs(root)
    return _serialize_story(root)


def _slot_texts(slot: dict, value) -> list[str]:
    """Normalize a plan value for a slot into the list of line texts."""
    if value is None:
        return []
    if slot["mode"] == "single":
        # A "single" frame can still be several typeset lines (a two line cover title). Split on
        # newlines so the model's line breaks map onto the frame's real lines instead of landing
        # inside one run as a literal newline.
        return [p.strip() for p in str(value).split("\n") if p.strip()] or [""]
    if isinstance(value, str):  # prose emitted as one string -> split paragraphs
        return [p.strip() for p in re.split(r"\n\s*\n|\n", value) if p.strip()]
    return [str(v) for v in value]


# ---------------------------------------------------------------------------
# Planner-facing schema — generated from a page's measured slots, like build_schema.py
# for slides (idml_library.build_fill_schema assembles these per chosen page).
# ---------------------------------------------------------------------------

def _slot_schema(slot: dict, what: str) -> dict:
    caps = [ln["cap"] for ln in slot.get("lines") or [{"cap": 200}]]
    sample = (slot.get("sample") or "")[:90]
    desc = f"{what} Budget per line: {caps} chars."
    if len(caps) > 1 and slot.get("mode") == "single":
        desc += (f" This frame is typeset over {len(caps)} lines: separate them with a newline "
                 f"character, and keep each line within its own budget.")
    if sample:
        desc += (' Role example from the current document, with ⏎ marking a line break (NEVER copy '
                 f'the wording and never type ⏎): "{sample}"')
    if slot["mode"] == "single":
        return {"type": "string", "maxLength": max(caps[0], 8), "description": desc}
    # Item cap = the MEASURED per-line budget (no inflated floor). These frames are physically
    # sized, so an over-generous maxLength let the planner overrun narrow title/label frames.
    return {"type": "array", "minItems": 1, "maxItems": len(caps),
            "items": {"type": "string", "maxLength": max(max(caps), 12)},
            "description": desc + f" Exactly up to {len(caps)} lines/paragraphs; keep each within its budget."}
