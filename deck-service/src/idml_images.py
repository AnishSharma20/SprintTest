"""Theme matched photo swaps for InDesign whitepapers.

The templates' text is re-themed by `idml.py` / `idml_library.py`, but their PHOTOS were inherited
unchanged, so a joint health whitepaper still opened on a lifestyle cover chosen for healthy aging.
This module swaps the hero and atmosphere photos for ones that match the subject, taken from the
photo library the deck generator already ships (`assets/photo_*.jpg`) — small enough to bundle in
the delivered Links folder, so the designer relinks in one step.

ONLY photos are swappable. Certification marks (MSC, Friend of the Sea), UN SDG icons, the Area 48
map, product shots, the phospholipid/cell illustrations and the trial CHART images are all locked:
they are facts or brand assets, and swapping them would misrepresent the science — the same reason
the deck renderer refuses to put a heart icon on immune copy.

Geometry: a placed image carries its natural size (GraphicBounds, in points) and an ItemTransform
that scales and positions it inside its frame. Reverse engineering the designers' own covers showed
they use InDesign's "Fill Frame Proportionally": scale = max(frameW/imageW, frameH/imageH). We
reproduce exactly that, and keep the designer's crop bias on whichever axis still overflows, so a
swapped photo is cropped the way the original was rather than snapping to dead centre.
"""
from __future__ import annotations

import functools
import json
import re
from pathlib import Path
from xml.etree import ElementTree as ET

from . import config

PHOTOS_PATH = config.CONFIG_DIR / "idml_photos.json"


@functools.lru_cache(maxsize=None)
def load_photos() -> dict:
    return json.loads(PHOTOS_PATH.read_text(encoding="utf-8"))


def photo_path(name: str) -> Path:
    return (config.ASSETS_DIR / name).resolve()


# ---------------------------------------------------------------------------
# Choosing a photo
# ---------------------------------------------------------------------------

def photos_for_theme(theme: str) -> list[dict]:
    """Library photos tagged with this theme, best first (most specific tag wins)."""
    cat = load_photos()
    theme = (theme or "").strip().lower()
    exact = [p for p in cat["photos"] if theme and theme in p["themes"]]
    return exact or [p for p in cat["photos"] if "generic" in p["themes"]]


#: A replacement must reach this effective resolution or the designer's photo is kept. The library
#: was built for slides (~1600 px), so it simply cannot fill a full page frame at print quality —
#: silently dropping a cover to 72 ppi would be worse than not swapping at all.
MIN_PPI = 150


def achievable_ppi(slot: dict, photo: dict) -> float:
    """Effective resolution if this photo were made to fill this frame proportionally."""
    fw, fh = float(slot["w"]), float(slot["h"])
    if fw <= 0 or fh <= 0:
        return 0.0
    return 72.0 * min(photo["px_w"] / fw, photo["px_h"] / fh)


def pick_photos(theme: str, slots: list[dict], *,
                min_ppi: float = MIN_PPI) -> tuple[dict[str, dict], list[dict]]:
    """Assign a library photo to each swappable slot.

    A slot is left out (keeping the designed photo) when no candidate matches the theme or when the
    best candidate cannot reach `min_ppi` in that frame. Returns (assignments, skipped) so the
    caller can tell the designer WHY a photo was left alone.
    """
    candidates = photos_for_theme(theme)
    chosen: dict[str, dict] = {}
    skipped: list[dict] = []
    used: set[str] = set()
    for slot in slots:
        want = slot.get("orientation")
        pool = [p for p in candidates if not want or want == "square" or p["orientation"] == want]
        pool = pool or candidates
        pool = sorted(pool, key=lambda p: (p["file"] in used, -achievable_ppi(slot, p)))
        best = pool[0] if pool else None
        if best is None:
            skipped.append({"image": slot["image"], "reason": "no photo matches this subject"})
            continue
        ppi = achievable_ppi(slot, best)
        if ppi < min_ppi:
            skipped.append({"image": slot["image"],
                            "reason": (f"library photos reach only {ppi:.0f} ppi in this "
                                       f"{slot['w']}x{slot['h']} pt frame (needs {min_ppi:.0f})")})
            continue
        chosen[slot["image"]] = best
        used.add(best["file"])
    return chosen, skipped


# ---------------------------------------------------------------------------
# The swap itself
# ---------------------------------------------------------------------------

def _frame_bounds(frame: ET.Element) -> tuple[float, float, float, float]:
    xs, ys = [], []
    for pp in frame.iter("PathPointType"):
        ax, ay = (float(v) for v in pp.get("Anchor").split())
        xs.append(ax)
        ys.append(ay)
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def _swap_one(frame: ET.Element, image: ET.Element, photo: dict) -> bool:
    """Repoint one placed image at `photo` and refit it. Returns True if it changed."""
    transform = [float(v) for v in image.get("ItemTransform", "").split()]
    if len(transform) != 6:
        return False
    a, _b, _c, d, tx, ty = transform

    gb = next(iter(image.iter("GraphicBounds")), None)
    if gb is None:
        return False
    old_w = float(gb.get("Right")) - float(gb.get("Left"))
    old_h = float(gb.get("Bottom")) - float(gb.get("Top"))

    fx, fy, fw, fh = _frame_bounds(frame)
    # Natural size in points. Library photos carry no meaningful resolution, so treat them as
    # 72 ppi: the pixel count then IS the point size and the fill scale falls out of it.
    ppi = 72.0
    iw = photo["px_w"] / ppi * 72.0
    ih = photo["px_h"] / ppi * 72.0
    if iw <= 0 or ih <= 0:
        return False

    scale = max(fw / iw, fh / ih)          # Fill Frame Proportionally, as the designers used
    sx = -1.0 if a < 0 else 1.0            # frames can be mirrored; keep the sign pattern
    sy = -1.0 if d < 0 else 1.0

    def fitted(axis_len_new: float, axis_len_old: float, frame_len: float,
               frame_min: float, sign: float, old_t: float, old_scale: float) -> float:
        """Place the scaled image on one axis, preserving the designer's crop bias."""
        centre = frame_min + frame_len / 2
        overflow_new = axis_len_new * scale - frame_len
        overflow_old = axis_len_old * abs(old_scale) - frame_len
        bias = 0.0
        if overflow_old > 0.5 and overflow_new > 0.5:
            old_centre = old_t + sign * abs(old_scale) * axis_len_old / 2
            bias = (old_centre - centre) / (overflow_old / 2)
            bias = max(-1.0, min(1.0, bias)) * (overflow_new / 2)
        return centre + bias - sign * scale * axis_len_new / 2

    new_tx = fitted(iw, old_w, fw, fx, sx, tx, a)
    new_ty = fitted(ih, old_h, fh, fy, sy, ty, d)

    image.set("ItemTransform",
              f"{sx * scale:.10g} 0 0 {sy * scale:.10g} {new_tx:.10g} {new_ty:.10g}")
    gb.set("Left", "0")
    gb.set("Top", "0")
    gb.set("Right", f"{iw:.10g}")
    gb.set("Bottom", f"{ih:.10g}")
    image.set("ActualPpi", "72 72")
    image.set("EffectivePpi", f"{round(72 / scale)} {round(72 / scale)}")
    fmt = "$ID/PNG" if photo["file"].lower().endswith(".png") else "$ID/JPEG"
    image.set("ImageTypeName", fmt)

    for link in image.iter("Link"):
        old_uri = link.get("LinkResourceURI") or ""
        prefix = old_uri.rsplit("/", 1)[0] if "/" in old_uri else "file:"
        link.set("LinkResourceURI", f"{prefix}/{photo['file']}")
        link.set("LinkResourceFormat", fmt)

    # Drop the stale embedded preview so InDesign cannot render the OLD photo.
    for props in list(image.iter("Properties")):
        for contents in list(props.findall("Contents")):
            props.remove(contents)
    return True


def swap_photos_in_spread(xml: str, assignments: dict[str, dict]) -> tuple[str, set[str]]:
    """Apply {image_id: photo} to one spread. Returns (xml, filenames actually placed)."""
    if not assignments:
        return xml, set()
    root = ET.fromstring(xml)
    parents = {child: parent for parent in root.iter() for child in parent}
    placed: set[str] = set()
    for image in list(root.iter("Image")):
        photo = assignments.get(image.get("Self"))
        if not photo:
            continue
        frame = parents.get(image)
        if frame is None:
            continue
        if _swap_one(frame, image, photo):
            placed.add(photo["file"])
    if not placed:
        return xml, set()
    body = ET.tostring(root, encoding="unicode")
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + body), placed
