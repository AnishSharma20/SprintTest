"""Build config/idml_photos.json — the photo catalogue used for theme matched image swaps.

Reads the real pixel dimensions of the photo library the deck generator already ships
(assets/photo_*.jpg) and merges in the curated THEMES below. Dimensions are measured, not
guessed, because the swap has to recompute a Fill Frame Proportionally transform from them.

Two pools are merged:

  photo_*.jpg     the slide library (~1600 px). Fine for small frames; too small for a full page,
                  so the resolution guard in src/idml_images.py keeps the designed picture there.
  wp_photo_*.jpg  high resolution brand photographs imported from the design team's own packages
                  by scripts/import_brand_photos.py (3600 px, ~280 ppi on a cover frame). These
                  also cover the sports, brain and eye subjects the slide library lacks entirely.

Themes for the imported pool are read straight from import_brand_photos.CURATED so the tags live
in exactly one place.

    python scripts/build_idml_photos.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "config" / "idml_photos.json"

# Curated themes per photo. "generic" is the safe fallback pool for any subject.
THEMES: dict[str, list[str]] = {
    "photo_antarctic_bright.jpg":   ["sustainability", "sourcing", "ocean", "generic"],
    "photo_antarctic_land.jpg":     ["sustainability", "sourcing", "ocean"],
    "photo_antarctic_ocean.jpg":    ["sustainability", "sourcing", "ocean", "generic"],
    "photo_antarctic_sunset.jpg":   ["sustainability", "ocean"],
    "photo_iceberg.jpg":            ["sustainability", "ocean", "sourcing"],
    "photo_krill_blue_water.jpg":   ["krill", "sourcing", "ocean", "generic"],
    "photo_krill_closeup.jpg":      ["krill", "science"],
    "photo_krill_ice.jpg":          ["krill", "sourcing", "sustainability"],
    "photo_krill_single.jpg":       ["krill", "science"],
    "photo_krill_swarm.jpg":        ["krill", "sourcing", "ocean"],
    "photo_capsule_single.jpg":     ["product", "supplement"],
    "photo_capsules_daily.jpg":     ["product", "supplement", "generic"],
    "photo_capsules_glass.jpg":     ["product", "supplement"],
    "photo_capsules_heart.jpg":     ["product", "supplement"],
    "photo_capsules_pattern.jpg":   ["product", "supplement"],
    "photo_capsules_white.jpg":     ["product", "supplement"],
    "photo_capsules_wood.jpg":      ["product", "supplement"],
    "photo_ingredients.jpg":        ["product", "formulation", "generic"],
    "photo_oil_in_water.jpg":       ["science", "absorption", "formulation"],
    "photo_oil_lab.jpg":            ["science", "quality", "formulation"],
    "photo_oil_texture.jpg":        ["science", "absorption"],
    "photo_lab.jpg":                ["science", "quality", "generic"],
    "photo_warehouse.jpg":          ["supply", "quality", "sourcing"],
    "photo_team.jpg":               ["company", "supply"],
    "photo_breakfast.jpg":          ["consumer", "supplement"],
    "photo_jar_antarctic.jpg":      ["product", "sourcing"],
}


def main() -> None:
    try:
        from PIL import Image
    except ImportError:                                        # noqa: BLE001
        raise SystemExit("Pillow is required (it is already in requirements.txt).")

    from import_brand_photos import CURATED

    all_themes = dict(THEMES)
    for dest, themes in CURATED.values():
        all_themes[dest] = themes

    photos = []
    missing = []
    for name, themes in all_themes.items():
        path = ROOT / "assets" / name
        if not path.exists():
            missing.append(name)
            continue
        with Image.open(path) as im:
            w, h = im.size
        photos.append({
            "file": name, "px_w": w, "px_h": h,
            "orientation": "landscape" if w > h else ("portrait" if h > w else "square"),
            "themes": themes,
            "pool": "brand" if name.startswith("wp_photo_") else "slides",
            "bytes": path.stat().st_size,
        })

    # Most specific first: fewer themes means a more deliberate tag, so it wins in pick_photos.
    photos.sort(key=lambda p: (len(p["themes"]), p["file"]))
    catalogue = {
        "note": ("Photo catalogue for theme matched image swaps. Dimensions measured from the "
                 "files. Two pools: wp_photo_* are high resolution brand photographs from the "
                 "design team's packages (large enough for covers); photo_* are the slide library "
                 "(fine for smaller frames). src/idml_images.py picks the highest resolution "
                 "candidate that matches the subject and keeps the designed photo when none can "
                 "fill the frame at print quality."),
        "photos": photos,
    }
    OUT.write_text(json.dumps(catalogue, indent=2, ensure_ascii=False), encoding="utf-8")
    total = sum(p["bytes"] for p in photos)
    print(f"Wrote {OUT}")
    brand = sum(1 for p in photos if p["pool"] == "brand")
    print(f"  {len(photos)} photos ({brand} high resolution brand, {len(photos) - brand} slide "
          f"library), {total / 1e6:.1f} MB total")
    if missing:
        print(f"  WARNING missing from assets/: {missing}")
    themes: dict[str, int] = {}
    for p in photos:
        for t in p["themes"]:
            themes[t] = themes.get(t, 0) + 1
    print("  themes:", ", ".join(f"{k}={v}" for k, v in sorted(themes.items())))


if __name__ == "__main__":
    main()
