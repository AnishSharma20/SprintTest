# -*- coding: utf-8 -*-
"""Extract chart/graph figures AND tables from AKBM's supplied study PDFs, one per PMID.

The claims/findings review UI ("Evidence from this study") only ever showed the extracted TEXT
(assets/fulltext/<pmid>.txt) - reviewers asked to also see the actual charts, graphs and tables from
the paper, and download them as an image. Two different extraction paths, because the two are laid
out completely differently in a typeset PDF:
  - Figures/charts are embedded raster images placed on the page - extract_for_pdf() pulls them out
    directly, filtering logos/icons/tiny glyphs by size and dropping images that repeat across many
    pages (running headers, watermarks, journal crests).
  - Tables are drawn as text + ruled lines, not an image - there is nothing to "extract". Instead
    extract_tables_for_pdf() uses PyMuPDF's find_tables() to locate the grid, then RENDERS that
    region of the page to a PNG (expanded past the raw bbox so the caption above and footnotes below
    are included, capped by whatever comes next on the page so it doesn't bleed into unrelated content).

    python scripts/extract_figures.py <folder-of-pdfs> [--write] [--stats]

Without --write it only reports what it would do (dry run). Matching: filename -> PMID via
app/fulltext-studies.json's "pdf" field, plus CURATED_PDF_NAMES below for the 5 curated studies that
aren't in that file. A PDF whose filename doesn't match any known study is reported and skipped -
this script never guesses at a new PMID (unlike import_fulltext_pdfs.py, which resolves against
PubMed; figures are a lower-stakes visual, so a plain filename match is enough).

Writes:
    assets/figures/<pmid>/<NN>.<ext>      extracted figures + rendered tables, page order
    assets/figures/index.json             pmid -> [{file, page, width, height, kind}]
And mirrors both into the frontend (same pattern as write_app_list in import_fulltext_pdfs.py):
    min-forste-app/public/study-figures/<pmid>/<NN>.<ext>
    min-forste-app/app/study-figures.json
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parent.parent
OUTDIR = ROOT / "assets" / "figures"
APP_LIST = ROOT.parent / "app" / "fulltext-studies.json"
FIGURES_MANIFEST = ROOT.parent / "app" / "study-figures.json"
PUBLIC_DIR = ROOT.parent / "public" / "study-figures"

# The 5 curated studies (app/studies-data.ts) aren't in fulltext-studies.json, so they need their PDF
# filename spelled out here. Keys are PMIDs, values match the PDF filename stem (case-insensitive).
CURATED_PDF_NAMES = {
    "17353582": "Deutch 2007",  # Deutsch 2007 (AKBM's supplied copy is spelled "Deutch")
    "12777162": "Sampalis 2003",
    "35880828": "Stonehouse 2022",  # also in fulltext-studies.json's curated fallback path
}

MIN_W, MIN_H = 400, 260  # below this it's a logo/icon/CrossMark/ORCID badge, not a figure/chart/table
MAX_REPEATS = 2  # an image (by hash) appearing on more than this many pages is a running decoration
MAX_ASPECT = 6.0  # a real figure/table/photo is rarely more elongated than this; a wider/taller
# raster is a sliced row-strip of a chart split into several embedded objects (axis label, one bar...)
MAX_PER_STUDY = 12  # sanity cap; extraction bugs (e.g. mosaic'd forest plots) can otherwise dump dozens
MAX_PER_PAGE = 3  # a real page rarely has more than 2-3 distinct figures/tables; more is a sliced-up
# multi-panel chart (each strip/axis/legend embedded as its own image object) - keep only the largest
FULL_PAGE_COVERAGE = 0.85  # an image placed across this much of the page is a scan, not a discrete figure

# Tables aren't embedded raster images (they're drawn as text + ruled lines), so they need their own
# path: PyMuPDF's find_tables() locates the grid, then we RENDER (not extract) that region of the page
# to a raster. Its bbox only spans the "gridable" rows though (usually just the header) - the caption
# above and the footnote lines below are separate text objects it doesn't know belong to the table -
# so the render region is expanded past the raw bbox on all sides (see extract_tables_for_pdf).
MIN_TABLE_ROWS, MIN_TABLE_COLS = 2, 2  # a 1xN/Nx1 "table" is almost always a false-positive text run
MAX_AVG_ROW_HEIGHT = 60  # points; find_tables() occasionally unions two stacked tables (plus the gap
# between them) into one bogus wide detection - a real row is ~15-30pt, so a much taller average row
# means the "table" is actually spanning unrelated content, not a single grid
MAX_TABLES_PER_STUDY = 6
MAX_TABLES_PER_PAGE = 2  # more than this on one page is usually one table mis-split into pieces
TABLE_ZOOM = 3.0  # render resolution multiplier - tables are dense text, need to stay crisp
TABLE_PAD_TOP, TABLE_PAD_SIDE, TABLE_PAD_BOTTOM = 22, 10, 220  # points; bottom capped by the next
# object on the page (see extract_tables_for_pdf) so it doesn't bleed into unrelated following content


def stem_key(name: str) -> str:
    """Normalize a PDF filename for matching: drop extension/parens/'et al'/'loose_', fold case."""
    s = re.sub(r"\.pdf$", "", name, flags=re.I)
    s = re.sub(r"^loose_", "", s, flags=re.I)
    s = re.sub(r"\(\d+\)", "", s)  # "Rundblad 2018 (1)" -> "Rundblad 2018 "
    s = re.sub(r"\bet al\.?\b", "", s, flags=re.I)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def build_name_to_pmid() -> dict[str, str]:
    fulltext = json.loads(APP_LIST.read_text(encoding="utf-8"))
    out = {stem_key(v["pdf"]): pmid for pmid, v in fulltext.items()}
    for pmid, stem in CURATED_PDF_NAMES.items():
        out[stem_key(stem)] = pmid
    return out


def extract_for_pdf(path: Path) -> list[dict]:
    """Return the kept figures for one PDF: [{bytes, ext, page, width, height}]."""
    doc = fitz.open(path)
    seen_hashes: dict[str, int] = {}
    candidates: list[dict] = []
    for page_index in range(doc.page_count):
        if page_index == 0:
            continue  # page 1 is title/journal masthead/CrossMark banner, never a data figure
        page = doc[page_index]
        page_area = page.rect.width * page.rect.height
        for img in page.get_images(full=True):
            xref = img[0]
            try:
                info = doc.extract_image(xref)
            except Exception:  # noqa: BLE001
                continue
            w, h = info.get("width", 0), info.get("height", 0)
            if w < MIN_W or h < MIN_H:
                continue
            if max(w, h) / min(w, h) > MAX_ASPECT:
                continue
            # A raster covering most of the page is a scan/background, not a discrete figure/table.
            rects = page.get_image_rects(xref)
            if rects and page_area > 0:
                covered = max(r.width * r.height for r in rects)
                if covered / page_area >= FULL_PAGE_COVERAGE:
                    continue
            data = info["image"]
            h_hash = hashlib.sha256(data).hexdigest()
            seen_hashes[h_hash] = seen_hashes.get(h_hash, 0) + 1
            candidates.append({
                "bytes": data, "ext": info.get("ext", "png"),
                "page": page_index + 1, "width": w, "height": h, "hash": h_hash,
            })
    doc.close()
    repeated = {h for h, n in seen_hashes.items() if n > MAX_REPEATS}
    kept, dedupe = [], set()
    for c in candidates:
        if c["hash"] in repeated or c["hash"] in dedupe:
            continue
        dedupe.add(c["hash"])
        kept.append(c)
    kept.sort(key=lambda c: (c["page"], -c["width"] * c["height"]))

    per_page: dict[int, int] = {}
    capped = []
    for c in kept:
        n = per_page.get(c["page"], 0)
        if n >= MAX_PER_PAGE:
            continue
        per_page[c["page"]] = n + 1
        capped.append(c)
    for c in capped:
        c["kind"] = "figure"
    return capped[:MAX_PER_STUDY]


def extract_tables_for_pdf(path: Path) -> list[dict]:
    """Return the kept tables for one PDF: [{bytes, ext, page, width, height, kind}]."""
    doc = fitz.open(path)
    candidates: list[dict] = []
    for page_index in range(doc.page_count):
        if page_index == 0:
            continue
        page = doc[page_index]
        try:
            tabs = page.find_tables()
        except Exception:  # noqa: BLE001
            continue
        boxes = [
            fitz.Rect(t.bbox) for t in tabs.tables
            if t.row_count >= MIN_TABLE_ROWS and t.col_count >= MIN_TABLE_COLS
            and (t.bbox[3] - t.bbox[1]) / t.row_count <= MAX_AVG_ROW_HEIGHT
        ]
        # find_tables() sometimes reports overlapping/duplicate boxes for the same visual table;
        # keep the larger one when two overlap rather than rendering the same table twice.
        boxes.sort(key=lambda r: -r.width * r.height)
        deduped: list[fitz.Rect] = []
        for b in boxes:
            if not any((b & other).get_area() > 0.3 * b.get_area() for other in deduped):
                deduped.append(b)
        deduped.sort(key=lambda r: r.y0)

        # Other objects on the page (images, later tables) bound how far a table's render can bleed
        # downward, so a table's footnotes don't drag the next chart/table into the same crop.
        next_tops = sorted(
            [r.y0 for r in deduped] +
            [rect.y0 for img in page.get_images(full=True) for rect in page.get_image_rects(img[0])]
        )

        for b in deduped:
            bottom_limit = min([t for t in next_tops if t > b.y1 + 5] + [page.rect.height - 20])
            clip = fitz.Rect(
                max(b.x0 - TABLE_PAD_SIDE, 0), max(b.y0 - TABLE_PAD_TOP, 0),
                min(b.x1 + TABLE_PAD_SIDE, page.rect.width), min(b.y1 + TABLE_PAD_BOTTOM, bottom_limit),
            )
            if clip.height < 15 or clip.width < 50:
                continue
            pix = page.get_pixmap(clip=clip, matrix=fitz.Matrix(TABLE_ZOOM, TABLE_ZOOM))
            candidates.append({
                "bytes": pix.tobytes("png"), "ext": "png", "page": page_index + 1,
                "width": pix.width, "height": pix.height, "kind": "table",
            })
    doc.close()

    per_page: dict[int, int] = {}
    capped = []
    for c in candidates:
        n = per_page.get(c["page"], 0)
        if n >= MAX_TABLES_PER_PAGE:
            continue
        per_page[c["page"]] = n + 1
        capped.append(c)
    return capped[:MAX_TABLES_PER_STUDY]


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    stats = "--stats" in sys.argv
    if not args:
        print(__doc__)
        sys.exit(1)
    src = Path(args[0]).expanduser()
    pdfs = sorted(src.rglob("*.pdf"))
    if not pdfs:
        print(f"no PDFs under {src}")
        sys.exit(1)

    name_to_pmid = build_name_to_pmid()
    matched_pmids: set[str] = set()
    index: dict[str, list[dict]] = {}
    unmatched: list[str] = []

    for p in pdfs:
        key = stem_key(p.name)
        pmid = name_to_pmid.get(key)
        if not pmid:
            unmatched.append(p.name)
            continue
        if pmid in matched_pmids:
            continue  # duplicate copy of a PDF we already processed (e.g. supplied twice)
        matched_pmids.add(pmid)

        figs = extract_for_pdf(p) + extract_tables_for_pdf(p)
        figs.sort(key=lambda f: f["page"])
        print(f"  {pmid:<9} {p.name:<34} -> {len(figs)} figure(s)/table(s)" + (
            "  " + ", ".join(f"p{f['page']}:{f['kind']}:{f['width']}x{f['height']}" for f in figs) if stats else ""
        ))
        if not figs:
            continue
        entries = []
        for i, f in enumerate(figs, start=1):
            fname = f"{i:02d}.{f['ext']}"
            entries.append({
                "file": fname, "page": f["page"], "width": f["width"], "height": f["height"], "kind": f["kind"],
            })
            if write:
                d = OUTDIR / pmid
                d.mkdir(parents=True, exist_ok=True)
                (d / fname).write_bytes(f["bytes"])
        index[pmid] = entries

    print(f"\n  matched   : {len(matched_pmids)} studies, {sum(len(v) for v in index.values())} figures/tables total")
    print(f"  unmatched : {len(unmatched)} PDF(s) not in the study list, skipped: {unmatched}")

    if write:
        OUTDIR.mkdir(parents=True, exist_ok=True)
        (OUTDIR / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
        FIGURES_MANIFEST.write_text(json.dumps(index, indent=2), encoding="utf-8")
        print(f"  wrote {FIGURES_MANIFEST}")
        PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
        for pmid, entries in index.items():
            d = PUBLIC_DIR / pmid
            d.mkdir(parents=True, exist_ok=True)
            for e in entries:
                data = (OUTDIR / pmid / e["file"]).read_bytes()
                (d / e["file"]).write_bytes(data)
        print(f"  wrote {PUBLIC_DIR} ({sum(len(v) for v in index.values())} files)")
    else:
        print("  DRY RUN -- pass --write to save")


if __name__ == "__main__":
    main()
