"""Import every image the page library links, sized for print, into assets/wp_links/.

Why: a delivered whitepaper linked 16 images but the zip shipped only the 5 photos we had
substituted, and every link still pointed at a designer's Mac Desktop. So the recipient opened a
document with no pictures. To hand over a package that just works, the service has to ship every
image the chosen pages reference, which means those images have to live in the repository.

The originals are 219 MB (one illustration is 65 MB), so each raster is downsampled to what its
frame actually needs at 300 ppi, measured from the template geometry rather than guessed. Vectors
(.ai/.eps/.svg) are copied untouched: they are small and rasterising a logo would be a downgrade.
PSDs become PNG, which keeps their transparency (verified: Pillow reads them as RGBA) and is a
format InDesign relinks to happily.

Writes config/idml_links.json mapping the ORIGINAL link filename to the shipped filename, because
the PSD to PNG change renames the file and the link URIs have to be rewritten to match.

    python scripts/import_brand_links.py "C:/path/to/Whitepapers.zip"
"""
from __future__ import annotations

import io
import json
import os
import sys
import urllib.parse
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from src.idml_compose import Source  # noqa: E402

OUT_DIR = ROOT / "assets" / "wp_links"
MANIFEST = ROOT / "config" / "idml_links.json"

TARGET_PPI = 300
LONG_EDGE_MAX = 3600
JPEG_QUALITY = 86
VECTOR_EXT = {".ai", ".eps", ".svg", ".pdf"}
#: Every element type that can hold a linked resource, enumerated from the templates.
#: Scanning only Image/PDF/EPS quietly dropped the three <SVG> brand logos.
GRAPHIC_TAGS = ("Image", "PDF", "EPS", "SVG")


def needed_images() -> dict[str, tuple[int, int]]:
    """Every linked image across the library pages, with the largest frame it has to fill (points)."""
    lib = json.loads((ROOT / "config" / "idml_pages.json").read_text(encoding="utf-8"))
    srcs = {k: Source(k, ROOT / v, "") for k, v in lib["templates"].items()}
    need: dict[str, tuple[int, int]] = {}
    for page in lib["pages"]:
        src = srcs[page["template"]]
        root = ET.fromstring(src.read(f"Spreads/Spread_{page['spread']}.xml"))
        parents = {c: p for p in root.iter() for c in p}
        for tag in GRAPHIC_TAGS:
            for graphic in root.iter(tag):
                uri = next((lk.get("LinkResourceURI") for lk in graphic.iter("Link")), None)
                if not uri:
                    continue
                name = urllib.parse.unquote(uri.rsplit("/", 1)[-1])
                xs, ys = [], []
                frame = parents.get(graphic)
                for pp in (frame.iter("PathPointType") if frame is not None else []):
                    ax, ay = (float(v) for v in pp.get("Anchor").split())
                    xs.append(ax)
                    ys.append(ay)
                w = round(max(xs) - min(xs)) if xs else 0
                h = round(max(ys) - min(ys)) if ys else 0
                prev = need.get(name, (0, 0))
                need[name] = (max(prev[0], w), max(prev[1], h))
    return need


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit('usage: python scripts/import_brand_links.py "C:/path/to/Whitepapers.zip"')
    src_zip = Path(sys.argv[1])
    if not src_zip.exists():
        raise SystemExit(f"Not found: {src_zip}")

    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None

    zf = zipfile.ZipFile(src_zip)
    available: dict[str, str] = {}
    for member in zf.namelist():
        if "/Links/" in member and not member.endswith("/"):
            available.setdefault(urllib.parse.unquote(member.split("/")[-1]), member)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for stale in OUT_DIR.glob("*"):
        stale.unlink()

    manifest: dict[str, str] = {}
    missing: list[str] = []
    total = 0

    for name, (fw, fh) in sorted(needed_images().items()):
        member = available.get(name)
        if not member:
            missing.append(name)
            continue
        ext = os.path.splitext(name)[1].lower()
        data = zf.read(member)

        if ext in VECTOR_EXT:
            shipped = name
            (OUT_DIR / shipped).write_bytes(data)
            total += len(data)
            manifest[name] = shipped
            print(f"  {name[:40]:42s} vector, copied         {len(data)/1e6:6.2f} MB")
            continue

        with Image.open(io.BytesIO(data)) as im:
            src_w, src_h = im.size
            keep_alpha = im.mode in ("RGBA", "LA") or "transparency" in im.info
            im = im.convert("RGBA" if keep_alpha else "RGB")
            # 300 ppi of the frame it fills, never upscaled, long edge capped.
            want_w = max(1, round(fw / 72 * TARGET_PPI))
            want_h = max(1, round(fh / 72 * TARGET_PPI))
            scale = min(max(want_w / src_w, want_h / src_h), 1.0)
            if max(src_w, src_h) * scale > LONG_EDGE_MAX:
                scale = LONG_EDGE_MAX / max(src_w, src_h)
            new = (max(1, round(src_w * scale)), max(1, round(src_h * scale)))
            out = im.resize(new, Image.LANCZOS) if new != (src_w, src_h) else im

            buf = io.BytesIO()
            if keep_alpha:
                shipped = os.path.splitext(name)[0] + ".png"
                out.save(buf, "PNG", optimize=True)
            else:
                shipped = os.path.splitext(name)[0] + ".jpg"
                out.save(buf, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)

        (OUT_DIR / shipped).write_bytes(buf.getvalue())
        total += len(buf.getvalue())
        manifest[name] = shipped
        note = "" if shipped == name else f"  -> {os.path.splitext(shipped)[1]}"
        print(f"  {name[:40]:42s} {src_w}x{src_h} -> {new[0]}x{new[1]}  "
              f"{len(buf.getvalue())/1e6:5.2f} MB{note}")

    MANIFEST.write_text(json.dumps({
        "note": ("Original link filename -> filename shipped in assets/wp_links/. Rasters are "
                 "downsampled to 300 ppi of the frame they fill; PSDs become PNG to keep "
                 "transparency, which is why some names change."),
        "missing_from_source": missing,
        "files": manifest,
    }, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n{len(manifest)} images, {total/1e6:.1f} MB total -> {OUT_DIR}")
    if missing:
        print(f"\nNOT in the design team's package ({len(missing)}) - these stay missing links:")
        for m in missing:
            print(f"  {m}")


if __name__ == "__main__":
    main()
