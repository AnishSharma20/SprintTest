# -*- coding: utf-8 -*-
"""Export thumbnails + a manifest of the BUILT-IN photo library for the About page.

The About page's Photo library section shows what the AI can already pick from (read only)
next to the team's own uploaded photos. Thumbs are small (480 px long edge, JPEG) so the
whole set adds well under a megabyte to the repo.

    python scripts/export_photo_library.py          # from deck-service/

Re-run after import_brand_photos.py or any asset_manifest change.
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent            # deck-service/
sys.path.insert(0, str(ROOT))

from src import config                                    # noqa: E402

APP_ROOT = ROOT.parent
THUMB_DIR = APP_ROOT / "public" / "photo-library"
MANIFEST = APP_ROOT / "app" / "photo-library.json"
LONG_EDGE = 480


def main() -> None:
    photos = config.selectable_photos()
    if THUMB_DIR.exists():
        for old in THUMB_DIR.glob("*.jpg"):
            old.unlink()
    THUMB_DIR.mkdir(parents=True, exist_ok=True)

    manifest = []
    for a in photos:
        src = config.resolve_asset(a["path"])
        if not src.exists():
            print(f"  SKIP {a['id']} (missing file {src})")
            continue
        im = Image.open(src).convert("RGB")
        scale = LONG_EDGE / max(im.size)
        if scale < 1:
            im = im.resize((round(im.width * scale), round(im.height * scale)))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=80)
        (THUMB_DIR / f"{a['id']}.jpg").write_bytes(buf.getvalue())
        manifest.append({"id": a["id"], "description": a.get("description", ""),
                         "bg_fit": a.get("bg_fit", "")})

    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8")
    print(f"WROTE {len(manifest)} thumbs to {THUMB_DIR}")
    print(f"WROTE {MANIFEST}")


if __name__ == "__main__":
    main()
