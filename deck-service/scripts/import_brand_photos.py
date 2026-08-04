"""Import high resolution brand photographs from the design team's InDesign packages.

The slide photo library (assets/photo_*.jpg, ~1600 px) is too small to fill an A4 page: a cover
frame came out at 124 ppi, so the resolution guard in src/idml_images.py kept the designed picture
and no cover could ever be re-themed. The design team's own packages hold the same photographs at
6000 to 37000 px, so this script takes a CURATED set, downsamples each to print sufficient size,
and writes them to assets/wp_photo_*.jpg where the swap engine can use them.

Sizing: short edge >= 2400 px so a near square cover frame (620 pt) lands around 280 ppi, long edge
capped at 3600 px to keep the repository sane. JPEG quality 86, metadata stripped.

Every photograph was viewed before being tagged — filenames alone are misleading (one "USV_Trondheim"
file is a person at a monitoring laptop, not a vessel; several "ABM_*"/"SQUEEZE" files are plain
gradient backgrounds). PORTRAITS OF IDENTIFIABLE PEOPLE ARE DELIBERATELY EXCLUDED: attaching a named
individual's photograph to auto generated marketing copy would imply they wrote or endorsed it.

    python scripts/import_brand_photos.py "C:/path/to/Whitepapers.zip"
"""
from __future__ import annotations

import io
import sys
import urllib.parse
import zipfile
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

SHORT_EDGE_MIN = 2400
LONG_EDGE_MAX = 3600
QUALITY = 86

# source filename -> (destination name, themes). Curated after viewing every candidate.
CURATED: dict[str, tuple[str, list[str]]] = {
    "Brabant_Island_pano_cred Aker BioMarine.jpg":
        ("wp_photo_antarctic_panorama.jpg", ["sustainability", "ocean", "sourcing", "generic"]),
    "AdobeStock_486365700 (1).jpeg":
        ("wp_photo_antarctica_from_space.jpg", ["sustainability", "ocean", "science"]),
    "USV_Trondheim-09.jpg":
        ("wp_photo_vessel_at_sea.jpg", ["sourcing", "supply", "ocean", "sustainability"]),
    "AdobeStock_558601707.jpeg":
        ("wp_photo_harvest_aerial.jpg", ["sourcing", "sustainability", "supply"]),
    "USV_Trondheim-31.jpg":
        ("wp_photo_traceability_monitor.jpg", ["traceability", "quality", "supply", "science"]),
    "Algae-18.jpg":
        ("wp_photo_algae_microscopy.jpg", ["science", "absorption", "formulation"]),
    "Krill_Visuals_5_cred Aker BioMarine copy.jpg":
        ("wp_photo_krill_deep_water.jpg", ["krill", "ocean", "generic"]),
    "Krill_Visuals_4_Extended copy.jpg":
        ("wp_photo_krill_single.jpg", ["krill", "science"]),
    "AdobeStock_64737097.jpeg":
        ("wp_photo_krill_swarm_silver.jpg", ["krill", "ocean", "sourcing"]),
    "AdobeStock_333720803.jpeg":
        ("wp_photo_krill_biomass.jpg", ["krill", "sustainability", "ocean"]),
    # NOT tagged "generic": a running shoe photograph turning up as the fallback on a
    # sustainability whitepaper is exactly the kind of mismatch this feature exists to remove.
    "AdobeStock_121166552.jpeg":
        ("wp_photo_athlete_shoes.jpg", ["sports", "performance", "recovery"]),
    "victor-freitas-WvDYdXDzkhs-unsplash.jpg":
        ("wp_photo_athlete_strength.jpg", ["sports", "performance", "muscle", "strength"]),
    "AdobeStock_458037537.jpeg":
        ("wp_photo_cyclist.jpg", ["sports", "performance", "endurance", "recovery"]),
    "Brain  and Doctor.jpeg":
        ("wp_photo_brain_science.jpg", ["brain", "cognitive", "science", "clinical"]),
    "Eye Health.jpeg":
        ("wp_photo_eye_health.jpg", ["eye", "clinical", "science"]),
    "Superba_01.jpg":
        ("wp_photo_capsules_teal.jpg", ["product", "supplement", "formulation"]),
    "Superba_07 EXTENDED.jpg":
        ("wp_photo_capsules_poured.jpg", ["product", "supplement", "generic"]),
}

# Viewed and rejected, recorded so they are not revisited.
REJECTED = {
    "Simon-20.jpg": "portrait of an identifiable person",
    "Matts-4 web.jpg": "portrait of an identifiable person",
    "ImportedImage_370_Blue.jpg": "abstract gradient, not a photograph",
    "SQUEEZE2.jpg": "abstract gradient, not a photograph",
    "ABM_RED_OPEN_LEFT_BRIGHT_.jpg": "abstract gradient, not a photograph",
    "Science Knee Joint.jpeg": "only 1000x500, far too small for a page frame",
    "Cell copy.jpg": "scientific illustration used as a diagram, not an atmosphere photo",
}


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__.strip().splitlines()[-1])
    src_zip = Path(sys.argv[1])
    if not src_zip.exists():
        raise SystemExit(f"Not found: {src_zip}")

    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None

    z = zipfile.ZipFile(src_zip)
    index: dict[str, str] = {}
    for member in z.namelist():
        if "/Links/" in member and not member.endswith("/"):
            index.setdefault(urllib.parse.unquote(member.split("/")[-1]), member)

    total = 0
    written = []
    for source, (dest, themes) in CURATED.items():
        if source not in index:
            print(f"  MISSING from the package: {source}")
            continue
        with Image.open(io.BytesIO(z.read(index[source]))) as im:
            im = im.convert("RGB")
            w, h = im.size
            # Scale so the short edge clears the minimum, then clamp the long edge.
            scale = max(SHORT_EDGE_MIN / min(w, h), 1e-6)
            if max(w, h) * scale > LONG_EDGE_MAX:
                scale = LONG_EDGE_MAX / max(w, h)
            scale = min(scale, 1.0)                     # never upscale
            new = (max(1, round(w * scale)), max(1, round(h * scale)))
            out = im.resize(new, Image.LANCZOS)
        buf = io.BytesIO()
        out.save(buf, "JPEG", quality=QUALITY, optimize=True, progressive=True)
        (ASSETS / dest).write_bytes(buf.getvalue())
        total += len(buf.getvalue())
        written.append((dest, new, len(buf.getvalue()), themes))
        print(f"  {source[:40]:42s} {w}x{h} -> {new[0]}x{new[1]}  "
              f"{len(buf.getvalue()) / 1e6:.2f} MB  {dest}")

    print(f"\n{len(written)} photographs, {total / 1e6:.1f} MB total")
    print(f"rejected after viewing: {len(REJECTED)} "
          f"({', '.join(sorted(set(REJECTED.values())))})")
    print("\nNow run: python scripts/build_idml_photos.py")


if __name__ == "__main__":
    main()
