"""Normalise the product brand marks in public/logos/ so they sit consistently in a tile.

Why this exists: each brand ships its logo on its own canvas, with its own amount of blank space
baked around the artwork. Dropped into equal-sized tiles they look misaligned and randomly sized,
because the browser centres the FILE, not the ink. This crops every mark to its own ink bounding
box, so "centre it" and "make it this tall" finally mean the same thing for all of them.

  - SVG: only the viewBox is rewritten. Paths, colours and geometry are untouched, so the mark
    stays vector and stays exactly the artwork the brand drew.
  - PNG: transparent margins are cropped away.

It also reports, per mark, how much of the cropped height is LETTERING. Those fractions are what
`logoH` in app/products.ts is derived from: these wordmarks devote very different proportions of
their height to text, so equal box heights would render the text at unequal sizes.

Run from the repo root, after adding or replacing a file in public/logos/:

    python scripts/normalize_logos.py            # report only
    python scripts/normalize_logos.py --write     # rewrite the files in place

Needs PyMuPDF + Pillow (both already in deck-service/requirements.txt).
"""
from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

import fitz
from PIL import Image

LOGOS = Path("public/logos")
ALPHA = 20          # a pixel counts as ink above this alpha
RENDER_W = 2400     # render width used for measuring

# Per mark: the x-range (as a fraction of the CROPPED width) where its lettering sits, and how to
# recognise a lettering pixel. Needed because "ink" includes the icon, which is not what the eye
# compares between two logos — the size of the text is.
LETTERING = {
    "superba.png":  ((0.34, 1.00), lambda p: p[3] > ALPHA and max(p[:3]) < 90),
    "revervia.svg": ((0.30, 1.00), lambda p: p[3] > ALPHA),
    "lysoveta.svg": ((0.28, 1.00), lambda p: p[3] > ALPHA and abs(p[0] - 0x25) < 40
                                             and abs(p[1] - 0x34) < 40 and abs(p[2] - 0x5D) < 40),
    "pl-plus.svg":  ((0.00, 1.00), lambda p: p[3] > ALPHA and min(p[:3]) > 200),
}


def _inline_classes(svg: str) -> str:
    """PyMuPDF ignores CSS classes, so fills declared in a <style> block would all render black.
    Inlining them as fill attributes is for MEASUREMENT ONLY — never written back to the file."""
    cmap = dict(re.findall(r"\.([A-Za-z0-9_-]+)\s*\{\s*fill:\s*(#[0-9A-Fa-f]{3,6})", svg))
    cmap.update(dict(re.findall(r"\.([A-Za-z0-9_-]+)\s*\{\s*fill:\s*(#[0-9A-Fa-f]{3,6})", svg)))
    return re.sub(r'class="([A-Za-z0-9_-]+)"',
                  lambda m: f'fill="{cmap[m.group(1)]}"' if m.group(1) in cmap else m.group(0), svg)


def _render(svg_text: str, scale: float) -> Image.Image:
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "m.svg"
        p.write_text(svg_text, encoding="utf-8")
        pm = fitz.open(str(p))[0].get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=True)
        out = Path(td) / "m.png"
        pm.save(str(out))
        return Image.open(str(out)).copy().convert("RGBA")


def _ink_bbox(im: Image.Image) -> tuple[int, int, int, int]:
    bbox = im.getchannel("A").point(lambda a: 255 if a > ALPHA else 0).getbbox()
    if not bbox:
        raise SystemExit("no ink found")
    return bbox


def _lettering(im: Image.Image, name: str) -> tuple[float, float]:
    """Returns (height of the lettering / height of the mark, centre of the lettering / height).

    The second number is why `logoNudge` exists. Centring a mark's ink does NOT centre its text
    when the mark is vertically lopsided — Revervia's droplet rises far above its wordmark, so its
    text lands below everyone else's on a row of tiles. Anything away from 0.5 needs nudging."""
    (x0f, x1f), pred = LETTERING[name]
    W, H = im.size
    px = im.load()
    x0, x1 = int(W * x0f), int(W * x1f)
    step = max(1, (x1 - x0) // 300)
    ys = [y for y in range(H) if any(pred(px[x, y]) for x in range(x0, x1, step))]
    if not ys:
        return 1.0, 0.5
    return (max(ys) - min(ys) + 1) / H, (min(ys) + max(ys)) / 2 / H


def process(name: str, write: bool) -> tuple[float, float, float]:
    path = LOGOS / name
    if name.endswith(".png"):
        im = Image.open(path).convert("RGBA")
        box = _ink_bbox(im)
        cropped = im.crop(box)
        if write and box != (0, 0, im.width, im.height):
            cropped.save(path)
        measured = cropped
    else:
        svg = path.read_text(encoding="utf-8")
        vb = [float(v) for v in re.search(r'viewBox="([-\d.eE\s]+)"', svg).group(1).split()]
        vx, vy, vw, vh = vb
        scale = RENDER_W / vw
        im = _render(_inline_classes(svg), scale)
        x0, y0, x1, y1 = _ink_bbox(im)
        nvx, nvy = vx + x0 / scale, vy + y0 / scale
        nvw, nvh = (x1 - x0) / scale, (y1 - y0) / scale
        new = re.sub(r'viewBox="[-\d.eE\s]+"',
                     f'viewBox="{nvx:.3f} {nvy:.3f} {nvw:.3f} {nvh:.3f}"', svg, count=1)
        # A stale enable-background referencing the OLD box confuses some renderers once the
        # viewBox no longer matches it.
        new = re.sub(r'\s*style="enable-background:[^"]*"', "", new)
        if write:
            path.write_text(new, encoding="utf-8")
        measured = _render(_inline_classes(new), RENDER_W / nvw)
    ratio = measured.width / measured.height
    frac, mid = _lettering(measured, name)
    return ratio, frac, mid


def main() -> None:
    write = "--write" in sys.argv
    if not LOGOS.is_dir():
        raise SystemExit("run me from the repo root (public/logos not found)")
    print(f"{'mark':15s} {'ratio':>6s} {'lettering':>10s} {'logoH':>7s} {'width':>7s} {'logoNudge':>10s}")
    for name in LETTERING:
        if not (LOGOS / name).exists():
            print(f"{name:15s} (missing, skipped)")
            continue
        ratio, frac, mid = process(name, write)
        h = 11.0 / frac                      # height that shows ~11px of lettering
        nudge = -(mid - 0.5) * h             # shift that puts the LETTERING on the box centre
        print(f"{name:15s} {ratio:6.2f} {frac*100:9.1f}% {h:6.0f}px {h*ratio:6.0f}px "
              f"{round(nudge):+9d}px")
    print("\nwrote files" if write else "\nreport only; pass --write to rewrite")


if __name__ == "__main__":
    main()
