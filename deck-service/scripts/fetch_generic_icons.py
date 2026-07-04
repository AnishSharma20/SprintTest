"""Build the GENERIC fallback icon library (run occasionally; needs network).

The brand ships benefit icons for 11 HEALTH BENEFITS only. When a slide's columns aren't all
health benefits, the brand rule is "all icons on a slide share ONE source" — so such a slide
must fall back to a neutral, generic icon set for EVERY column (never mix a branded icon with a
generic one). This is the "take one from the PPTX standard icon library" fallback.

We can't read PowerPoint's cloud icon library programmatically, so we bundle an equivalent:
Lucide (ISC-licensed) line-art icons, recoloured to the exact AKBM brand red and thickened to
match the weight of the benefit icons, so a generic-icon slide looks of-a-piece with a
benefit-icon slide. Rendered to PNG here and committed under assets/generic_<keyword>.png;
build_manifest.py then catalogues whatever generic_*.png files exist.

    python scripts/fetch_generic_icons.py
"""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

import resvg_py
from PIL import Image

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
BRAND_RED = "#E30917"      # sampled from the AKBM Icon-Only Red set — match it exactly
STROKE = "2.4"             # Lucide default is 2; the AKBM icons read bolder
PX = 512
BASE = "https://unpkg.com/lucide-static@latest/icons/{}.svg"

# semantic keyword -> Lucide icon name. Keywords are what the planner selects (deck vocabulary),
# so they read as topics, not icon names. Includes body-part proxies (heart/brain/…) so a slide
# that MIXES a benefit with a non-benefit can render entirely from this one generic source.
GENERIC = {
    # body / benefit proxies (for mixed slides that must go all-generic)
    "heart": "heart", "brain": "brain", "joint": "bone", "muscle": "dumbbell",
    "eye": "eye", "immunity": "shield",
    # science & composition
    "science": "flask-conical", "research": "microscope", "molecule": "atom",
    "omega3": "droplet", "cell": "hexagon",
    # sourcing & sustainability
    "sustainability": "leaf", "ocean": "waves", "krill": "fish",
    "sourcing": "ship", "traceability": "route", "global": "globe",
    # quality & trust
    "purity": "sparkles", "quality": "badge-check", "award": "award", "safety": "shield-check",
    # usage & outcomes
    "dosage": "pill", "routine": "calendar", "energy": "zap", "growth": "trending-up",
    "absorption": "circle-arrow-down", "process": "workflow", "proven": "circle-check",
    "people": "users", "sleep": "moon",
}


def fetch(name: str) -> str | None:
    try:
        req = urllib.request.Request(BASE.format(name), headers={"User-Agent": "curl/8"})
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.read().decode("utf-8")
    except Exception as e:  # noqa: BLE001
        print(f"  MISS {name}: {e}")
        return None


def recolor(svg: str) -> str:
    return (svg.replace('stroke="currentColor"', f'stroke="{BRAND_RED}"')
               .replace('stroke-width="2"', f'stroke-width="{STROKE}"'))


def main() -> None:
    ASSETS.mkdir(exist_ok=True)
    for old in ASSETS.glob("generic_*.png"):
        old.unlink()
    ok, miss = 0, []
    for kw, name in GENERIC.items():
        svg = fetch(name)
        if not svg or "<svg" not in svg:
            miss.append(kw); continue
        png = resvg_py.svg_to_bytes(svg_string=recolor(svg), width=PX, height=PX)
        import io
        im = Image.open(io.BytesIO(bytes(png))).convert("RGBA")
        bb = im.getbbox()
        if bb:
            im = im.crop(bb)
        im.save(ASSETS / f"generic_{kw}.png")
        ok += 1
    print(f"Staged {ok} generic icons -> assets/generic_*.png")
    if miss:
        print(f"  missing ({len(miss)}): {', '.join(miss)}")


if __name__ == "__main__":
    main()
