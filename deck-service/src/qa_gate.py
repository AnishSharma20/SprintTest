"""Visual QA gate — the last line of defence the schema can't provide.

The planner + validator guarantee the plan is well-formed and within length limits, and the
renderer guarantees on-brand styling. But nothing else LOOKS at the finished slides. This gate
does: it rasterises the rendered deck to images, sends them to one vision call that flags only
objective visual defects (text overflow / collision / truncation / an icon that doesn't match its
text), and returns short, actionable fixes. `pipeline.generate` then revises just the flagged
slides and re-renders.

Deliberately conservative: it reports on what's VISIBLE, never critiques wording/tone, and if no
rasteriser is available (no LibreOffice, not on Windows) it degrades to a no-op so generation never
breaks. Enabled only in "polished" mode (fast mode skips it).

Rasteriser: LibreOffice headless (portable — add `soffice` to the Docker image to enable on Render)
→ PDF → PyMuPDF; falls back to PowerPoint COM on a Windows dev box.
"""
from __future__ import annotations

import base64
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from . import config

GATE_MODEL = os.environ.get("DECK_GATE_MODEL", "").strip() or config.MODEL
_MAX_W = 1200  # downscale slides before the vision call to keep tokens/cost sane

ISSUE_ENUM = ["text_overflow", "collision", "truncation", "icon_mismatch",
              "empty_or_broken", "off_brand", "other"]

_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["slides"],
    "properties": {"slides": {"type": "array", "items": {
        "type": "object", "additionalProperties": False, "required": ["slide", "ok"],
        "properties": {
            "slide": {"type": "integer", "description": "1-based slide number as labelled."},
            "ok": {"type": "boolean", "description": "true if the slide has NO visual defect."},
            "issues": {"type": "array", "items": {"enum": ISSUE_ENUM}},
            "fix": {"type": "string", "maxLength": 240,
                    "description": "If not ok: one short, concrete instruction the writer can apply "
                                   "(shorten a heading, change/drop a mismatched icon, trim body). Empty if ok."},
        }}}},
}

_SYSTEM = """You are a meticulous slide-design QA reviewer for on-brand corporate decks. You are shown
each rendered slide as an image, labelled 'Slide N' with a note of its layout and any icons it uses.

Flag ONLY objective, visible defects:
- text_overflow: text spills out of its box, off the slide edge, or overlaps the footer/logo.
- collision: two elements overlap or a title runs into the body/an image.
- truncation: a word or label is visibly cut off (e.g. ends mid-word or on a dangling "&"/"and").
- icon_mismatch: an icon's meaning clearly contradicts its heading/text (e.g. a heart icon on a
  liver point, a random object unrelated to the words). Judge against the labelled icon + what you see.
- empty_or_broken: an empty picture box, a missing image, obvious render corruption.
- off_brand: a jarring colour/element clearly outside the deep-sea / brand look.

Do NOT critique wording, tone, persuasiveness, or content choices — only what is visibly wrong.
Most slides should be ok:true. Be strict but not fussy: a slide that merely looks plain is fine.
For every not-ok slide give a SHORT, concrete `fix` the writer can apply. Report every slide."""


def _render_pngs(pptx: Path, out_dir: Path) -> bool:
    """LibreOffice (portable) → PDF → PyMuPDF; else PowerPoint COM (Windows). Same approach as
    scripts/qa.py. Returns False if no rasteriser is available."""
    out_dir.mkdir(parents=True, exist_ok=True)
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if soffice:
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir", tmp, str(pptx)],
                           check=True, capture_output=True)
            pdf = next(Path(tmp).glob("*.pdf"))
            import fitz  # PyMuPDF
            doc = fitz.open(str(pdf))
            for n, page in enumerate(doc, 1):
                page.get_pixmap(dpi=110).save(str(out_dir / f"slide{n:03d}.png"))
        return True
    if sys.platform.startswith("win"):
        ps = (f'$pp=New-Object -ComObject PowerPoint.Application;'
              f'$pres=$pp.Presentations.Open("{pptx}",$true,$true,$false);'
              f'$pres.Export("{out_dir}","PNG",1600,900);$pres.Close();$pp.Quit()')
        subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True, capture_output=True)
        return True
    return False


def _natkey(p: Path):
    m = re.findall(r"\d+", p.stem)
    return int(m[-1]) if m else 0


def rasterize(pptx_bytes: bytes) -> list[bytes] | None:
    """Render a deck to one PNG per slide, in order. None if no rasteriser is available (gate off)."""
    try:
        with tempfile.TemporaryDirectory() as tmp:
            deck = Path(tmp) / "deck.pptx"
            deck.write_bytes(pptx_bytes)
            out = Path(tmp) / "png"
            if not _render_pngs(deck, out):
                return None
            # dedupe by lowercased name — Windows' filesystem is case-insensitive, so *.png and
            # *.PNG would each match the same COM-exported files and double the list.
            uniq = {p.name.lower(): p for p in [*out.glob("*.png"), *out.glob("*.PNG")]}
            pngs = sorted(uniq.values(), key=_natkey)
            return [p.read_bytes() for p in pngs] or None
    except Exception as e:  # noqa: BLE001 — the gate must never break generation
        print(f"[qa-gate] rasterise failed ({e}); skipping visual QA", file=sys.stderr)
        return None


def _jpeg_b64(png_bytes: bytes) -> str:
    from PIL import Image
    im = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    if im.width > _MAX_W:
        im = im.resize((_MAX_W, round(im.height * _MAX_W / im.width)))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _digest(i: int, spec: dict) -> str:
    parts = [f"Slide {i}: layout={spec.get('layout')}"]
    b = spec.get("benefit")
    if b and b != "none":
        parts.append(f"benefit-icon={b}")
    cols = spec.get("columns") or []
    if cols:
        ic = [f"{(c.get('heading') or '?')[:18]}→{c.get('icon') or c.get('icon_generic') or 'none'}"
              for c in cols]
        parts.append("column icons: " + "; ".join(ic))
    return " | ".join(parts)


def review(client, images: list[bytes], plan: dict, *, model: str | None = None) -> list[dict]:
    """One vision call over all slide images → list of per-slide findings (dicts with slide/ok/
    issues/fix). Returns [] on any error (gate must not break generation)."""
    slides = plan.get("slides", [])
    n = min(len(images), len(slides))
    if n == 0:
        return []
    content: list[dict] = [{"type": "text", "text":
        "Review each of these rendered slides for visual defects and report via report_qa."}]
    for i in range(n):
        content.append({"type": "text", "text": _digest(i + 1, slides[i])})
        content.append({"type": "image", "source": {"type": "base64",
                        "media_type": "image/jpeg", "data": _jpeg_b64(images[i])}})
    try:
        msg = client.messages.create(
            model=model or GATE_MODEL, max_tokens=2000, system=_SYSTEM,
            tools=[{"name": "report_qa", "description": "Report per-slide visual QA findings.",
                    "input_schema": _SCHEMA}],
            tool_choice={"type": "tool", "name": "report_qa"},
            messages=[{"role": "user", "content": content}],
        )
        for block in msg.content:
            if block.type == "tool_use" and isinstance(block.input, dict):
                return block.input.get("slides", [])
    except Exception as e:  # noqa: BLE001
        print(f"[qa-gate] vision review failed ({e}); accepting deck as-is", file=sys.stderr)
    return []


def flagged(findings: list[dict]) -> list[dict]:
    """Findings that are not ok and carry an actionable fix (1-based slide + fix text)."""
    out = []
    for f in findings:
        if not f.get("ok", True) and (f.get("fix") or "").strip() and isinstance(f.get("slide"), int):
            out.append(f)
    return out
