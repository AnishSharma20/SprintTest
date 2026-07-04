"""Step 2 — asset manifest.

Curate the usable brand assets, tag them (tags verified by eye on a contact sheet, not
guessed from filenames), stage the runtime ones into a committed assets/ folder, and
write config/asset_manifest.json.

Design:
- PHOTOS + benefit ICONS are the only assets the renderer actually inserts, so they are
  copied (photos downscaled) into deck-service/assets/ and the manifest points there —
  brand_assets/ itself is large and gitignored, so runtime must not depend on it.
- LOGOS / GRADIENTS / KRILL-SWOSH are rendered by the template's own layouts, so they are
  catalogued for reference with selectable:false and are NOT staged or inserted.
- Paths are relative to the deck-service root (portable across machines / Render), not
  absolute — this is what makes the pipeline template-agnostic.

    python scripts/build_manifest.py
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from PIL import Image

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "brand_assets"
ASSETS = ROOT / "assets"          # committed, staged runtime assets
OUT = ROOT / "config" / "asset_manifest.json"
MAX_PHOTO_PX = 1600               # full-bleed at 1600x900 export needs no more

PR = "02. Images/02.01. Product"
KO = "02. Images/02.02. Krill oil (caps + oil)"
KA = "02. Images/02.03. Krill (animal)"
AN = "02. Images/02.05. Antarctica nature"
HO = "02. Images/02.04. Houston"

# (id, source-relative-to-brand_assets, tags, description, bg_fit)
PHOTOS = [
    ("photo_capsule_single",   f"{PR}/Softgel Capsules/Single Capsule On White.jpg",
     ["product", "capsule", "single", "minimal", "daily-dose", "white-bg"],
     "one red krill-oil softgel on white — minimal, clean product hero", "light"),
    ("photo_capsules_white",   f"{PR}/Softgel Capsules/Capsules On White.jpg",
     ["product", "capsules", "scatter", "hero", "white-bg"],
     "red softgels scattered on white marble — clean product hero", "light"),
    ("photo_capsules_glass",   f"{PR}/Softgel Capsules/Krill Oil Capsules In Glass.jpg",
     ["product", "capsules", "glass", "jar", "premium"],
     "softgels in a glass bowl on marble — premium product close-up", "light"),
    ("photo_capsules_daily",   f"{PR}/Softgel Capsules/Two Capsules (Daily Dose).jpg",
     ["product", "capsules", "daily-dose", "dosage", "two"],
     "two softgels on a wood block, soft background — the daily dose", "light"),
    ("photo_capsules_wood",    f"{PR}/Softgel Capsules/Capsules On Wood.jpg",
     ["product", "capsules", "wood", "natural", "warm"],
     "red softgels on warm wood — natural, everyday product", "neutral"),
    ("photo_capsules_heart",   f"{PR}/Softgel Capsules/Capsules In Heart Shape.jpg",
     ["product", "capsules", "heart", "heart-health", "cardiovascular"],
     "softgels arranged as a heart on marble — heart-health hero", "light"),
    ("photo_breakfast",        f"{KO}/Softgels/Capsules for breakfast.jpg",
     ["lifestyle", "breakfast", "wellness", "routine", "food"],
     "breakfast bowl with berries + a daily capsule on a dark table — everyday wellness", "dark"),
    ("photo_ingredients",      f"{KO}/Softgels/Capsules with fruits.jpg",
     ["lifestyle", "ingredients", "omega3", "food", "clean-label", "natural"],
     "capsules with avocado, blueberries and walnuts on wood — clean-label omega-3 foods", "neutral"),
    ("photo_jar_antarctic",    f"{KO}/Softgels/Softgels sea background.png",
     ["product", "jar", "antarctic", "origin", "sourcing"],
     "a jar of softgels on a snowy Antarctic rock — product meets pristine origin", "neutral"),
    ("photo_capsules_pattern", f"{KO}/Softgels/Capsules nice round shape.jpg",
     ["product", "capsules", "pattern", "arrangement", "white-bg"],
     "many softgels in a neat ring on white — product pattern", "light"),
    ("photo_oil_in_water",     f"{KO}/Bulkoil/Krill oil in water.png",
     ["oil", "water", "absorption", "bioavailability", "science", "dispersion"],
     "red krill oil dispersing in water on white — bioavailability / absorption", "light"),
    ("photo_oil_texture",      f"{KO}/Bulkoil/Krill oil texture.jpg",
     ["oil", "texture", "abstract", "red", "science"],
     "abstract red krill-oil texture — bold science/product backdrop", "neutral"),
    ("photo_oil_lab",          f"{KO}/Bulkoil/Krill oil liquid.png",
     ["oil", "lab", "science", "purity", "extraction", "glassware"],
     "red oil poured into lab glassware — extraction, purity, science", "light"),
    ("photo_krill_closeup",    f"{KA}/Krill_close_up.jpg",
     ["krill", "animal", "closeup", "nature", "raw-ingredient"],
     "a translucent Antarctic krill in close-up on blue — the raw ingredient", "dark"),
    ("photo_krill_blue_water", f"{KA}/Krill_in_blue_water.jpg",
     ["krill", "deep-sea", "blue-water", "origin", "calm"],
     "a single krill in deep blue water with light rays — deep-sea origin", "dark"),
    ("photo_krill_swarm",      f"{KA}/Krill_swarm_in_water.jpg",
     ["krill", "swarm", "biomass", "abundance", "macro"],
     "a dense red krill swarm (macro) — biomass, abundance, sustainable sourcing", "dark"),
    ("photo_krill_single",     f"{KA}/One_krill_in_water.jpg",
     ["krill", "single", "animal", "closeup", "clean"],
     "one translucent krill with bubbles on a clean ground — the species", "neutral"),
    ("photo_krill_ice",        f"{KA}/Krill_many_in_water.jpg",
     ["krill", "ice", "frozen", "blue", "many"],
     "krill embedded in blue Antarctic ice — cold, pristine origin", "dark"),
    ("photo_iceberg",          f"{AN}/Antacrtica_iceberg.jpg",
     ["antarctica", "iceberg", "ocean", "moody", "sustainability", "origin"],
     "a moody grey iceberg on the horizon — pristine origin, sustainability", "dark"),
    ("photo_antarctic_ocean",  f"{AN}/Antarctiba_bleu_ocean.jpg",
     ["antarctica", "ocean", "blue", "coast", "origin"],
     "blue Antarctic ocean with a distant coast — pristine sourcing", "neutral"),
    ("photo_antarctic_land",   f"{AN}/Antarctica_landscape.jpg",
     ["antarctica", "landscape", "ice", "calm", "horizon"],
     "a wide, calm icy Antarctic horizon — pristine, understated", "neutral"),
    ("photo_antarctic_bright", f"{AN}/Antarctica_icy_ocean.jpg",
     ["antarctica", "icy-ocean", "bright", "pristine", "icebergs", "sustainability"],
     "bright icebergs, blue ocean and snow peaks — pristine and optimistic", "light"),
    ("photo_antarctic_sunset", f"{AN}/Antarctica_sunset over mountains.jpg",
     ["antarctica", "mountain", "sunset", "dramatic", "dawn"],
     "orange sunset on an Antarctic peak — dramatic, aspirational", "dark"),
    ("photo_lab",              f"{HO}/Houston lab.jpg",
     ["lab", "science", "research", "quality", "testing", "hands"],
     "gloved hands testing oil in the Houston lab — research and quality control", "neutral"),
    ("photo_team",             f"{HO}/Houston_people.jpg",
     ["people", "team", "manufacturing", "credibility", "expertise"],
     "two experts in hard hats at the krill-oil plant — credibility and expertise", "neutral"),
    ("photo_warehouse",        f"{HO}/Warehouse.jpg",
     ["warehouse", "logistics", "scale", "supply-chain", "operations"],
     "a long warehouse aisle — scale, logistics, supply", "dark"),
]

# Benefit icons: (benefit-key, source filename stem). Staged in Red (for light slides) and
# Pastelle (for dark slides); referenced via the slide's `benefit` field, not asset_id.
ICON_DIR = "05. Superba Brand Identity/Health Benefit Logos/Icon Only"
ICONS = [
    ("heart", "Heart"), ("liver", "Liver"), ("joint", "Joint"), ("muscle", "Muscle"),
    ("skin", "Skin"), ("eye", "Eye"), ("cognitive", "Cognitive"), ("pms", "PMS"),
    ("sports", "Sports"), ("absorption", "Absorption"), ("whole_body", "Whole Body"),
]

# Catalogued for reference only — rendered by the template's own layouts, never inserted.
REFERENCE = [
    ("logo_superba_white", "05.01. SUPERBA_KRILL®/PNG/LANDSCAPE/SUPERBA_KRILL_WHITE_LANDSCAPE_®.png",
     "logo", ["logo", "superba", "white", "dark-bg"]),
    ("logo_superba_pos", "05.01. SUPERBA_KRILL®/PNG/LANDSCAPE/SUPERBA_KRILL_POS_LANDSCAPE_®.png",
     "logo", ["logo", "superba", "colour", "light-bg"]),
    ("logo_aker_white", "05. Logos/PNG/White/1_AkerBioMarine_Main_Logo_Horizontal_White.png",
     "logo", ["logo", "aker-biomarine", "white", "dark-bg"]),
    ("logo_aker_black", "05. Logos/PNG/Black/1_AkerBioMarine_Main_Logo_Horizontal_Black.png",
     "logo", ["logo", "aker-biomarine", "black", "light-bg"]),
    ("gradient_green", "05. Superba Brand Identity/Brand visuals/Color Gradients/bg_green-1.png",
     "gradient", ["gradient", "background", "green", "deep-sea"]),
    ("gradient_teal", "05. Superba Brand Identity/Brand visuals/Color Gradients/bg_teal-1.png",
     "gradient", ["gradient", "background", "teal"]),
    ("gradient_blue", "05. Superba Brand Identity/Brand visuals/Color Gradients/bg_blue-1.png",
     "gradient", ["gradient", "background", "blue"]),
    ("krill_swosh", "05. Superba Brand Identity/Brand visuals/Krill Swosh/visual-element-krillArtboard-2.png",
     "swosh", ["swosh", "krill", "accent", "decor"]),
]


def orient(w, h):
    r = w / h
    return "portrait" if r < 0.9 else "square" if r < 1.15 else "landscape"


def stage_photo(src: Path, dst: Path):
    im = Image.open(src).convert("RGB")
    if max(im.size) > MAX_PHOTO_PX:
        im.thumbnail((MAX_PHOTO_PX, MAX_PHOTO_PX))
    im.save(dst, "JPEG", quality=85)
    return im.size


def main():
    ASSETS.mkdir(exist_ok=True)
    entries = []
    missing = []

    for aid, rel, tags, desc, bg in PHOTOS:
        src = BRAND / rel
        if not src.exists():
            missing.append(rel); continue
        dst = ASSETS / f"{aid}.jpg"
        w, h = stage_photo(src, dst)
        entries.append({"id": aid, "kind": "photo", "selectable": True,
                        "path": f"assets/{dst.name}", "tags": tags, "description": desc,
                        "bg_fit": bg, "width": w, "height": h, "orientation": orient(w, h)})

    # Stage the "Icon Only" RED benefit icons — clean, label-free LINE-ART in the brand red.
    # One colourway that reads on both the dark deep-sea and the light master, and roughly square
    # so it drops cleanly into a column's icon slot. (The PNG/SVG "Vibrant" & "Pastelle" files are
    # the blob LOCKUPS — Vibrant even bakes the word label into the image — so they are wrong for
    # an icon slot; "Icon Only" is the standalone icon.)
    for old in ASSETS.glob("icon_*.png"):
        old.unlink()
    for key, stem in ICONS:
        src = BRAND / ICON_DIR / "Red" / f"{stem}.png"
        if not src.exists():
            missing.append(str(src.relative_to(BRAND))); continue
        im = Image.open(src).convert("RGBA")
        bb = im.getbbox()
        if bb:
            im = im.crop(bb)   # trim transparent padding so the icon centres in its box
        dst = ASSETS / f"icon_{key}.png"
        im.save(dst)
        entries.append({"id": f"icon_{key}", "kind": "icon", "selectable": False,
                        "benefit": key, "tags": ["benefit", key], "path": f"assets/{dst.name}",
                        "description": f"{stem} benefit icon (line-art, brand red)"})

    # Generic fallback icons (line-art, same brand red) — staged by scripts/fetch_generic_icons.py.
    # Catalogue whatever generic_*.png files are present; the keyword is the filename stem.
    generic_kw = []
    for f in sorted(ASSETS.glob("generic_*.png")):
        kw = f.stem[len("generic_"):]
        generic_kw.append(kw)
        entries.append({"id": f"generic_{kw}", "kind": "generic_icon", "selectable": False,
                        "keyword": kw, "tags": ["generic", kw], "path": f"assets/{f.name}",
                        "description": f"generic '{kw}' icon (line-art, brand red) — fallback source"})

    for aid, rel, kind, tags in REFERENCE:
        src = BRAND / rel
        entries.append({"id": aid, "kind": kind, "selectable": False,
                        "path": f"brand_assets/{rel}", "tags": tags, "present": src.exists(),
                        "description": "provided by the template's own layouts; reference only"})
        if not src.exists():
            missing.append(rel)

    # The tag vocabulary the planner may choose from (selectable assets only).
    photo_tags = sorted({t for e in entries if e["kind"] == "photo" for t in e["tags"]})
    manifest = {
        "note": "Paths are relative to the deck-service root. Only selectable=true assets are "
                "inserted by the renderer; logos/gradients/swosh come from the template layouts.",
        "photo_tag_vocabulary": photo_tags,
        "benefits": [k for k, _ in ICONS],
        "generic_icons": generic_kw,
        "assets": entries,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    photos = [e for e in entries if e["kind"] == "photo"]
    icons = [e for e in entries if e["kind"] == "icon"]
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(f"  {len(photos)} photos staged -> assets/  ({sum((ASSETS / Path(e['path']).name).stat().st_size for e in photos)//1024} KB)")
    print(f"  {len(icons)} benefit icons (Icon-Only line-art, brand red)")
    print(f"  {len([e for e in entries if not e['selectable'] and e['kind'] != 'icon'])} reference assets (logos/gradients/swosh)")
    print(f"  photo tag vocabulary ({len(photo_tags)}): {', '.join(photo_tags)}")
    if missing:
        print(f"\n  WARNING missing sources ({len(missing)}):")
        for m in missing:
            print(f"    - {m}")


if __name__ == "__main__":
    main()
