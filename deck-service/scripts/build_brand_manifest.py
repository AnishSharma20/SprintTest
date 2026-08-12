"""Step 2, for a NON-DEFAULT brand — asset manifest from an already-staged assets folder.

build_manifest.py is Superba's curator: it hand-maps sources inside that brand's own
brand_assets/ tree, downscales them, tags each photo by eye and stages the result. That
provenance map cannot be reused for another brand, because no two brand packs are organised
alike.

This script does the OTHER half of the same job — cataloguing what has been staged — for any
brand whose runtime assets already sit in brands/<brand>/assets/ under the naming convention
Superba's staged folder uses:

    photo_<name>.jpg / .png      a selectable photo the planner may place
    icon_<benefit>.png           a benefit icon (its stem after "icon_" IS the benefit key)
    generic_<keyword>.png        a generic fallback icon
    bullet.png                   the picture-bullet glyph (catalogued, never selectable)

Per-photo TAGS and DESCRIPTIONS are what the planner reads to choose a photo, and they cannot
be derived from a filename. A sidecar brands/<brand>/assets/photos.json may supply them:

    {"photo_capsules_hand": {"tags": ["product", "capsule"], "description": "...",
                             "bg_fit": "light"}}

Anything absent from the sidecar is catalogued with an empty tag list and a description made
from its id, which is honest but weak guidance — fill the sidecar before relying on photo
choice quality.

    python scripts/build_brand_manifest.py --brand revervia
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from src import config as _cfg  # noqa: E402  (needs ROOT on the path first)


def orient(w: int, h: int) -> str:
    if not w or not h:
        return "unknown"
    r = w / h
    return "landscape" if r > 1.2 else "portrait" if r < 0.83 else "square"


def main(brand: str) -> None:
    assets = _cfg.assets_dir(brand)
    if not assets.exists():
        sys.exit(f"No assets directory for brand {brand!r}: {assets}")
    rel_root = _cfg.brand_root(brand)
    sidecar_path = assets / "photos.json"
    sidecar = json.loads(sidecar_path.read_text(encoding="utf-8")) if sidecar_path.exists() else {}

    entries: list[dict] = []
    untagged: list[str] = []

    for f in sorted(assets.glob("photo_*")):
        if f.suffix.lower() not in (".jpg", ".jpeg", ".png"):
            continue
        try:
            with Image.open(f) as im:
                w, h = im.size
        except Exception:  # noqa: BLE001  — a corrupt file must not abort the whole manifest
            print(f"  !! unreadable, skipped: {f.name}")
            continue
        meta = sidecar.get(f.stem, {})
        if not meta.get("tags"):
            untagged.append(f.stem)
        entries.append({
            "id": f.stem, "kind": "photo", "selectable": True,
            "path": f.relative_to(rel_root).as_posix(),
            "tags": meta.get("tags", []),
            "description": meta.get("description") or f.stem.replace("photo_", "").replace("_", " "),
            "bg_fit": meta.get("bg_fit", "any"),
            "width": w, "height": h, "orientation": orient(w, h),
        })

    benefits: list[str] = []
    for f in sorted(assets.glob("icon_*.png")):
        key = f.stem[len("icon_"):]
        benefits.append(key)
        entries.append({"id": f.stem, "kind": "icon", "selectable": False, "benefit": key,
                        "tags": ["benefit", key], "path": f.relative_to(rel_root).as_posix(),
                        "description": f"{key} benefit icon"})

    generic: list[str] = []
    for f in sorted(assets.glob("generic_*.png")):
        kw = f.stem[len("generic_"):]
        generic.append(kw)
        entries.append({"id": f.stem, "kind": "generic_icon", "selectable": False, "keyword": kw,
                        "tags": ["generic", kw], "path": f.relative_to(rel_root).as_posix(),
                        "description": f"generic '{kw}' icon — fallback source"})

    if (assets / "bullet.png").exists():
        entries.append({"id": "bullet", "kind": "bullet", "selectable": False,
                        "path": (assets / "bullet.png").relative_to(rel_root).as_posix(),
                        "tags": ["chrome"], "description": "picture-bullet glyph"})

    manifest = {
        "note": (f"{brand}: catalogued from staged files in {assets.relative_to(ROOT).as_posix()} "
                 "by scripts/build_brand_manifest.py. Paths are relative to this brand's root."),
        "benefits": benefits,
        "generic_icons": generic,
        "assets": entries,
    }
    out = _cfg.config_dir(brand) / "asset_manifest.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    photos = [e for e in entries if e["kind"] == "photo"]
    print(f"Wrote {out.relative_to(ROOT)}")
    print(f"  {len(photos)} photos, {len(benefits)} benefit icons, {len(generic)} generic icons")
    if untagged:
        print(f"  !! {len(untagged)} photo(s) have no tags/description in assets/photos.json — the "
              f"planner will choose these almost blind: {', '.join(untagged[:8])}"
              + (" ..." if len(untagged) > 8 else ""))
    if not photos:
        print("  !! no photos staged: layouts that require one cannot be planned for this brand yet")
    if not benefits:
        print("  !! no benefit icons staged: icon slots fall back to generic icons, or stay empty")


if __name__ == "__main__":
    argv = sys.argv[1:]
    if "--brand" not in argv:
        sys.exit(__doc__.strip().splitlines()[-1].strip())
    main(argv[argv.index("--brand") + 1])
