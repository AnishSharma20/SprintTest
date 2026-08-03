"""Build config/idml_photos.json — the photo catalogue used for theme matched image swaps.

Reads the real pixel dimensions of the photo library the deck generator already ships
(assets/photo_*.jpg) and merges in the curated THEMES below. Dimensions are measured, not
guessed, because the swap has to recompute a Fill Frame Proportionally transform from them.

Honest limitation, recorded here so it is not rediscovered later: this library was assembled for
SLIDES. It is rich in krill, Antarctic, product and laboratory imagery but contains NO sports,
joint, brain or eye photography, and the files are ~1600 px, which on a full bleed A4 cover works
out around 185 ppi (fine for a digital PDF, soft for print). So there is deliberately no mapping
for the health condition themes: for those the designers' own photograph is the better choice and
the swap simply leaves it alone.

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

    photos = []
    missing = []
    for name, themes in THEMES.items():
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
            "bytes": path.stat().st_size,
        })

    # Most specific first: fewer themes means a more deliberate tag, so it wins in pick_photos.
    photos.sort(key=lambda p: (len(p["themes"]), p["file"]))
    catalogue = {
        "note": ("Photo catalogue for theme matched image swaps. Dimensions measured from the "
                 "files. No sports / joint / brain imagery exists here on purpose: for those "
                 "subjects the template's own photograph is kept."),
        "photos": photos,
    }
    OUT.write_text(json.dumps(catalogue, indent=2, ensure_ascii=False), encoding="utf-8")
    total = sum(p["bytes"] for p in photos)
    print(f"Wrote {OUT}")
    print(f"  {len(photos)} photos, {total / 1e6:.1f} MB total (bundled into the delivered Links)")
    if missing:
        print(f"  WARNING missing from assets/: {missing}")
    themes: dict[str, int] = {}
    for p in photos:
        for t in p["themes"]:
            themes[t] = themes.get(t, 0) + 1
    print("  themes:", ", ".join(f"{k}={v}" for k, v in sorted(themes.items())))


if __name__ == "__main__":
    main()
