# -*- coding: utf-8 -*-
"""Export a PNG preview of every slide layout for the About page's layout gallery.

Renders ONE deck holding one sample slide per layout (the same samples build_gallery.py
uses for the design-review decks), rasterises it, and names each PNG after its layout key:

    public/layout-gallery/<layout>.png     what the Next app serves
    app/layout-gallery.json                ordered manifest {key, kind, usage}

Re-run after adding/removing a layout or changing the renderer's look:

    python scripts/export_layout_gallery.py          # from deck-service/

Rasterising uses PowerPoint COM on Windows / LibreOffice elsewhere (same as scripts/qa.py).
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

ROOT = Path(__file__).resolve().parent.parent            # deck-service/
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from src import config, renderer                          # noqa: E402
from src.planner import LAYOUT_USAGE                      # noqa: E402
from build_gallery import SYNTH, TMPL, notes_for          # noqa: E402

APP_ROOT = ROOT.parent                                    # min-forste-app/
PNG_DIR = APP_ROOT / "public" / "layout-gallery"
MANIFEST = APP_ROOT / "app" / "layout-gallery.json"

# The template's own placeholder layouts; everything else in the catalog is code built.
TEMPLATE_KEYS = {"title", "section", "agenda", "highlight", "title_only", "text",
                 "text_with_picture", "picture_full", "two_columns", "three_columns",
                 "four_columns"}


def _render_pngs(pptx: Path, out_dir: Path) -> list[Path]:
    """Export every slide to PNG and return them in slide order. PowerPoint names the files
    Slide1.PNG / Lysbilde1.PNG / ... depending on UI language, so sort on the number."""
    out_dir.mkdir(parents=True, exist_ok=True)
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if soffice:
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir", tmp,
                            str(pptx)], check=True, capture_output=True)
            pdf = next(Path(tmp).glob("*.pdf"))
            import fitz  # PyMuPDF
            doc = fitz.open(pdf)
            for n, page in enumerate(doc, 1):
                page.get_pixmap(dpi=110).save(str(out_dir / f"Slide{n}.png"))
    elif sys.platform.startswith("win"):
        ps = (f'$pp=New-Object -ComObject PowerPoint.Application;'
              f'$pres=$pp.Presentations.Open("{pptx}",$true,$true,$false);'
              f'$pres.Export("{out_dir}","PNG",1280,720);$pres.Close();$pp.Quit()')
        subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                       check=True, capture_output=True)
    else:
        raise SystemExit("No rasteriser available (need PowerPoint on Windows or LibreOffice).")

    def slide_no(p: Path) -> int:
        m = re.search(r"(\d+)", p.stem)
        return int(m.group(1)) if m else 0

    pngs = sorted([p for p in out_dir.iterdir() if p.suffix.lower() == ".png"], key=slide_no)
    return pngs


def main() -> None:
    # One sample slide per layout, cover first (it doubles as the `title` layout's preview).
    slides = [{"layout": "title", "title": "Superba by Aker BioMarine",
               "subtitle": "Science backed krill oil"}] + SYNTH + TMPL
    keys = [s["layout"] for s in slides]
    assert len(keys) == len(set(keys)), "a layout appears twice in the sample lists"

    missing = sorted(set(config.catalog()) - set(keys))
    if missing:
        print(f"WARNING: no sample slide for {missing} — they get no preview image")

    for s in slides:
        s.setdefault("speaker_notes", notes_for(s["layout"]))
    data = renderer.render_deck({"deck_title": "Layout gallery", "language": "en",
                                 "slides": slides})

    with tempfile.TemporaryDirectory() as tmp:
        pptx = Path(tmp) / "layout_gallery.pptx"
        pptx.write_bytes(data)
        raw = _render_pngs(pptx, Path(tmp) / "png")
        # render_deck splices AKBM's verbatim "Proven Health Benefits" slide in as the
        # second-to-last slide of EVERY deck, so the render is one slide longer than the plan.
        if len(raw) != len(keys) + 1:
            raise SystemExit(f"Rendered {len(raw)} PNGs for {len(keys)} plan slides "
                             f"(+1 verbatim benefits slide expected) — aborting.")
        benefits_png = raw.pop(-2)
        if PNG_DIR.exists():
            for old in PNG_DIR.glob("*.png"):
                old.unlink()
        PNG_DIR.mkdir(parents=True, exist_ok=True)
        for key, png in zip(keys, raw):
            shutil.copyfile(png, PNG_DIR / f"{key}.png")
        shutil.copyfile(benefits_png, PNG_DIR / "benefits_verbatim.png")

    manifest = [{
        "key": k,
        "kind": "template" if k in TEMPLATE_KEYS else "synthetic",
        "usage": LAYOUT_USAGE.get(k, ""),
    } for k in keys]
    manifest.append({
        "key": "benefits_verbatim",
        "kind": "verbatim",
        "usage": "AKBM's standard Proven Health Benefits overview, spliced in unchanged as the "
                 "second to last slide of every generated deck. It is a fixed brand slide, not a "
                 "layout the AI can pick or that can be turned off here.",
    })
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
    print(f"WROTE {len(keys)} previews to {PNG_DIR}")
    print(f"WROTE {MANIFEST}")


if __name__ == "__main__":
    main()
