# -*- coding: utf-8 -*-
"""Export a PNG preview of every slide layout for the About page's layout gallery.

Renders ONE deck holding one sample slide per layout (the same samples build_gallery.py
uses for the design-review decks), rasterises it THREE times — once as-is (Blue Ocean, the
dark default), once with every slide's `background` forced to "light" (White), and once
forced to "pastel" (Pastel Blue) — mirroring pipeline._apply_color_theme — and names each
PNG after its layout key:

    public/layout-gallery/<layout>.png          Blue Ocean (dark) — what the app served before
    public/layout-gallery-light/<layout>.png    White (light) — same content, white background
    public/layout-gallery-pastel/<layout>.png   Pastel Blue (pastel) — same content, mint background
    app/layout-gallery.json                     ordered manifest {key, kind, usage}

Verbatim splices (ingredient, the benefits overview) ignore `background` entirely, so their
light/pastel PNGs are identical to the dark one — expected, not a bug.

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

from src import brand as brand_theme                      # noqa: E402
from src import config, renderer                          # noqa: E402
from src.planner import LAYOUT_USAGE                      # noqa: E402
from build_gallery import SYNTH, TMPL, notes_for          # noqa: E402

APP_ROOT = ROOT.parent                                    # min-forste-app/
PNG_DIR = APP_ROOT / "public" / "layout-gallery"
PNG_DIR_LIGHT = APP_ROOT / "public" / "layout-gallery-light"
PNG_DIR_PASTEL = APP_ROOT / "public" / "layout-gallery-pastel"
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
        # Isolated profile per attempt + one retry — see deck-service/src/qa_gate.py's
        # _render_pngs for why (shared-profile lock contention, or a from-scratch profile
        # bootstrap itself, can make soffice exit 0 with no pdf written, or fail to write it).
        last_error = None
        for attempt in range(2):
            with tempfile.TemporaryDirectory() as tmp:
                profile = Path(tmp) / "lo_profile"
                result = subprocess.run(
                    [soffice, "--headless", "--norestore",
                     f"-env:UserInstallation=file://{profile.as_posix()}",
                     "--convert-to", "pdf:impress_pdf_Export", "--outdir", tmp, str(pptx)],
                    capture_output=True, text=True,
                )
                pdfs = list(Path(tmp).glob("*.pdf"))
                if not pdfs:
                    detail = result.stderr.strip() or result.stdout.strip() or "no output"
                    last_error = f"LibreOffice produced no PDF (exit {result.returncode}): {detail}"
                    continue
                import fitz  # PyMuPDF
                doc = fitz.open(pdfs[0])
                for n, page in enumerate(doc, 1):
                    page.get_pixmap(dpi=110).save(str(out_dir / f"Slide{n}.png"))
                doc.close()
                break
        else:
            raise RuntimeError(f"{last_error} (failed on both attempts)")
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


# The sample copy in build_gallery.py was written for Superba, and it is shared by every brand's
# gallery because the previews exist to show a layout's SHAPE, not to state facts. Left alone it
# put "Four reasons Superba performs" and "One Antarctic fishery" on Revervia's previews, which
# reads as a mistake rather than as placeholder text. These substitutions rewrite the brand-specific
# phrases per brand; anything not listed stays as written.
#
# This is a stopgap, not a substitute for real per-brand sample copy: it fixes the wording that
# names another product, not every krill-flavoured turn of phrase.
_SAMPLE_SUBS = {
    "revervia": [
        ("Superba krill", "Revervia"), ("Superba", "Revervia"),
        ("krill oil", "algal oil"), ("krill formulation", "algal formulation"),
        ("One Antarctic fishery", "One production site"),
        ("Antarctic fishery", "production site"),
        # not "Fully traceable" — that phrase already appears in the same sample card
        ("MSC-certified", "Third party audited"),
        ("Cold-processed at sea", "Fermented in closed tanks"),
        ("High phospholipid load", "High DHA concentration"),
        ("phospholipids", "triglycerides"), ("phospholipid", "triglyceride"),
    ],
}


def _localize(value, subs):
    """Apply the brand's sample-copy substitutions through nested sample slide structures."""
    if isinstance(value, str):
        for a, b in subs:
            value = value.replace(a, b)
        return value
    if isinstance(value, list):
        return [_localize(v, subs) for v in value]
    if isinstance(value, dict):
        return {k: _localize(v, subs) for k, v in value.items()}
    return value


def _export_set(slides: list[dict], keys: list[str], out_dir: Path, label: str,
                brand: str | None = None) -> None:
    """Render the given sample slides to one deck and export each to `out_dir/<key>.png`."""
    has_benefits = brand_theme.theme(brand).get("has_benefits_slide")
    data = renderer.render_deck({"deck_title": "Layout gallery", "language": "en",
                                 "slides": slides}, brand=brand)
    with tempfile.TemporaryDirectory() as tmp:
        pptx = Path(tmp) / "layout_gallery.pptx"
        pptx.write_bytes(data)
        raw = _render_pngs(pptx, Path(tmp) / "png")
        # render_deck splices the verbatim "Proven Health Benefits" slide in as the second-to-last
        # slide — but only for a brand whose template HAS that slide, so the render is one longer
        # than the plan for Superba and exactly as long for Revervia.
        expected = len(keys) + (1 if has_benefits else 0)
        if len(raw) != expected:
            raise SystemExit(f"[{label}] Rendered {len(raw)} PNGs for {len(keys)} plan slides "
                             f"(expected {expected}) — aborting.")
        benefits_png = raw.pop(-2) if has_benefits else None
        if out_dir.exists():
            for old in out_dir.glob("*.png"):
                old.unlink()
        out_dir.mkdir(parents=True, exist_ok=True)
        for key, png in zip(keys, raw):
            shutil.copyfile(png, out_dir / f"{key}.png")
        if benefits_png:
            shutil.copyfile(benefits_png, out_dir / "benefits_verbatim.png")
    print(f"WROTE {len(keys)} {label} previews to {out_dir}")


def main(brand: str | None = None) -> None:
    bname = brand or config.DEFAULT_BRAND
    bt = brand_theme.theme(brand)

    # One sample slide per layout, cover first (it doubles as the `title` layout's preview).
    slides = [{"layout": "title", "title": f"{bt['product']} by {bt['company']}",
               "subtitle": "Science backed ingredient"}] + SYNTH + TMPL

    # Only what THIS brand's catalog actually has. Revervia's template offers 8 of the 11 native
    # layouts, so the samples for the three it lacks are dropped rather than rendered onto a
    # layout that does not exist.
    catalog = set(config.catalog(brand))
    dropped = [s["layout"] for s in slides if s["layout"] not in catalog]
    slides = [s for s in slides if s["layout"] in catalog]
    if dropped:
        print(f"skipped (not in {bname}'s catalog): {', '.join(sorted(dropped))}")

    subs = _SAMPLE_SUBS.get(bname)
    if subs:
        # `layout` is a key, never prose — localize everything else.
        slides = [{**_localize({k: v for k, v in s.items() if k != "layout"}, subs),
                   "layout": s["layout"]} for s in slides]

    keys = [s["layout"] for s in slides]
    assert len(keys) == len(set(keys)), "a layout appears twice in the sample lists"

    missing = sorted(catalog - set(keys))
    if missing:
        print(f"WARNING: no sample slide for {missing} — they get no preview image")

    for s in slides:
        s.setdefault("speaker_notes", notes_for(s["layout"]))

    # A brand whose template has a single (light) master gets ONE preview set: rendering three
    # identical ones would just be three copies of the same picture.
    if bt.get("light_only"):
        light = [{**s, "background": "light"} for s in slides]
        _export_set(light, keys, PNG_DIR / bname, f"{bt['product']} (single light master)", brand)
    else:
        _export_set(slides, keys, PNG_DIR / bname, "Blue Ocean (dark)", brand)
        # Same content, forced light/pastel — mirrors pipeline._apply_color_theme (verbatim splices
        # like ingredient/benefits ignore `background`, so those PNGs are identical, by design).
        light_slides = [{**s, "background": "light"} for s in slides]
        _export_set(light_slides, keys, PNG_DIR_LIGHT / bname, "White (light)", brand)
        pastel_slides = [{**s, "background": "pastel"} for s in slides]
        _export_set(pastel_slides, keys, PNG_DIR_PASTEL / bname, "Pastel Blue (pastel)", brand)

    manifest = [{
        "key": k,
        "kind": "template" if k in TEMPLATE_KEYS else "synthetic",
        "usage": LAYOUT_USAGE.get(k, ""),
    } for k in keys]
    if bt.get("has_benefits_slide"):
        manifest.append({
        "key": "benefits_verbatim",
        "kind": "verbatim",
        "usage": "AKBM's standard Proven Health Benefits overview, spliced in unchanged as the "
                 "second to last slide of every generated deck. It is a fixed brand slide, not a "
                 "layout the AI can pick or that can be turned off here.",
        })
    # Keyed by brand, MERGED not replaced: exporting one brand must not wipe another's entries
    # (a bare write here overwrote Superba's 43 with Revervia's 38 the first time round).
    all_brands: dict = {}
    if MANIFEST.exists():
        existing = json.loads(MANIFEST.read_text(encoding="utf-8"))
        # A pre-multi-brand bare list migrates into the keyed shape on first run.
        all_brands = existing if isinstance(existing, dict) else {config.DEFAULT_BRAND: existing}
    all_brands[bname] = manifest
    MANIFEST.write_text(json.dumps(all_brands, indent=2, ensure_ascii=False) + chr(10),
                        encoding="utf-8")
    print(f"WROTE {len(keys)} previews for {bname} "
          f"(manifest holds: {', '.join(sorted(all_brands))})")
    print(f"WROTE {MANIFEST}")


if __name__ == "__main__":
    argv = sys.argv[1:]
    main(argv[argv.index("--brand") + 1] if "--brand" in argv else None)
