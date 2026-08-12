"""Per-brand palette and typography for the CODE-BUILT layouts.

The 31 synthetic layouts are programs that draw their own shapes, so unlike the native
template layouts they inherit nothing from the .pptx — every colour and typeface is chosen
in renderer.py. This module is where those choices come from, one record per brand.

WHY A JSON FILE AND NOT DERIVED FROM THE TEMPLATE. The template's theme gives us a colour
SCHEME (dk1/lt2/accent1...), not colour ROLES. Nothing in a .pptx says "this is the colour
reserved for data and icons" or "this teal is for secondary panels". Worse, a template's
theme can drift from the brand guide: Revervia's carries #0D698B where its guide specifies
Marine Blue #19698A, omits the guide's primary Deep Sea Green entirely, and still has two
leftover default Office accents. So the roles are authored per brand from the guide, and
the template's own theme keeps governing the NATIVE layouts, exactly as before.

Superba's record is a verbatim extraction of the constants that were hardcoded in
renderer.py, so switching it on changes nothing about Superba's output.
"""
from __future__ import annotations

import functools
import json

from . import config

# Role -> hex. Every brand must define all of these; the renderer has no fallbacks, because a
# silently-missing colour would show up as a wrong-coloured shape rather than an error.
COLOR_ROLES = (
    "accent",      # data, icons and the logo. NEVER decorative (the anti-AI-look rule).
    "deep",        # primary dark panel/heading colour
    "deep2",       # secondary panel colour
    "panel",       # light panel fill
    "ink",         # body text on a LIGHT background
    "tint",        # pale tint: muted text on dark, chip fills, soft rules
    "on_deep",     # body text sitting ON a deep-coloured panel
    "table_line",  # table row rule (consumed as a hex string in raw XML)
)

_DEFAULTS: dict[str, dict] = {
    # ── Superba: verbatim from renderer.py's hardcoded constants ──────────────────────────
    "superba": {
        # Identity — what the PLANNER is told it is writing about. Wrong here and the deck is a
        # correctly-coloured deck about the wrong product.
        "company": "Aker BioMarine",
        "product": "Superba Krill",
        "photo_library": "krill in the wild, Antarctic ocean/ice, product close-ups, lab and "
                         "sourcing shots, the team",
        "comparison_example": "krill oil vs fish oil",
        "has_ingredient_slide": True,
        "has_benefits_slide": True,
        "colors": {
            "accent": "E50A1A", "deep": "185968", "deep2": "2C7482", "panel": "E4F1F1",
            "ink": "163536", "tint": "A9DBD5", "on_deep": "ECF5F5", "table_line": "C9D9D9",
        },
        # 4th chart colour has no named role — it exists only to extend the series palette.
        "chart_colors": ["E50A1A", "2C7482", "A9DBD5", "60A09B"],
        "fonts": {
            # body = the theme MINOR font reference, not a literal name: a hardcoded "Manrope"
            # can bind to a wrong or cursive installed variant instead of the embedded regular.
            "head": "Exo 2", "body": "+mn-lt", "title": "Exo 2 italic",
        },
        "sizes": {"title": 32, "body": 14, "small": 12, "hero": 60, "cover": 60, "subtitle": 16},
        "rounded": False,
        "light_only": False,   # Superba ships a dark master AND a light one
    },
    # ── Revervia: authored from Revervia_Brand_Guide.pdf (sections 2.1, 2.2, 3.1) ──────────
    # A LIGHT brand: its template has a single master (white to Alice Blue gradient), so the
    # renderer's light path is the only path. Colour roles follow the guide's own contrast
    # matrix on p14, which permits dark blue as a foreground on every pale background and
    # rules Neptune out as a background for anything but Ice Blue.
    "revervia": {
        "company": "Aker BioMarine",
        "product": "Revervia",
        "photo_library": "algae microscopy, product capsules alone and in use, people taking the "
                         "product, kitchen and daily-routine settings",
        "comparison_example": "algal oil vs fish oil",
        # No verbatim ingredient slide exists for this brand: Superba's is a real AKBM slide with
        # its own mg values, and splicing it into a Revervia deck would state another product's
        # composition as fact. The prompt block disappears entirely rather than inviting a layout
        # the renderer would have to refuse.
        "has_ingredient_slide": False,
        # Nor the verbatim "Proven health benefits" overview: it is a Superba slide carrying
        # Superba's own trial counts. Splicing it here used to abort the whole render.
        "has_benefits_slide": False,
        "colors": {
            "accent": "8AC757",      # Algae Green — the guide's accent, "used sparingly"
            "deep": "0C4554",        # Deep Sea Green — primary dark
            "deep2": "19698A",       # Marine Blue — secondary panel
            "panel": "E0F5FC",       # Ice Blue — light panel fill
            "ink": "0C4554",         # Deep Sea Green: the one foreground safe on every pale bg
            "tint": "C4E3E8",        # Light Teal
            "on_deep": "F2F9FA",     # Alice Blue — text on a deep panel
            "table_line": "C4E3E8",  # Light Teal
        },
        # Pale Yellow is the second accent; it earns a chart slot but not the `accent` role,
        # since yellow on a pale background fails the guide's own contrast matrix.
        "chart_colors": ["8AC757", "19698A", "80B2BF", "FFDB78"],
        "fonts": {"head": "Quicksand SemiBold", "body": "+mn-lt", "title": "Quicksand SemiBold"},
        # The template's own master styles: titles 28pt, body 14pt, small 12pt. `cover` is 36
        # (the template's own cover/section size) rather than Superba's 60: Revervia puts its
        # cover title in a narrow left-hand column, so 60pt would cap a cover title at ~10
        # characters. Stat figures keep a real hero size of 54.
        "sizes": {"title": 28, "body": 14, "small": 12, "hero": 54, "cover": 36, "subtitle": 16},
        # Square, exactly like Superba. The brand guide's own pages use large rounded cards, so an
        # earlier version set this True — but the layouts are meant to be Superba's, with only
        # colour and typography differing per brand. Shape is not a brand characteristic here.
        "rounded": False,
        # Declared, not inferred: the template has exactly one master and it is LIGHT, so every
        # slide must take the renderer's light path. Without this, layouts default to the dark
        # path and draw WHITE text onto a near-white background — invisible. Deciding this by
        # reading gradient XML would be guesswork; a brand states it.
        "light_only": True,
    },
}


def _validate(brand: str, theme: dict) -> dict:
    missing = [r for r in COLOR_ROLES if not theme.get("colors", {}).get(r)]
    if missing:
        raise ValueError(f"brand theme {brand!r} is missing colour role(s): {', '.join(missing)}")
    for key in ("chart_colors", "fonts", "sizes"):
        if not theme.get(key):
            raise ValueError(f"brand theme {brand!r} is missing {key!r}")
    for role, hx in theme["colors"].items():
        if len(hx) != 6 or any(c not in "0123456789ABCDEFabcdef" for c in hx):
            raise ValueError(f"brand theme {brand!r}: {role!r} is not a 6-digit hex: {hx!r}")
    return theme


@functools.lru_cache(maxsize=None)
def theme(brand: str | None = None) -> dict:
    """One brand's palette and typography.

    A brand may override the built-in record with its own config/brand_theme.json (a shallow
    per-key merge, so a file can restate just the colours). Unknown brands fall back to the
    default brand rather than raising: a deck rendering in the wrong palette is a visible,
    fixable problem, whereas a hard failure loses the user's generation."""
    key = brand or config.DEFAULT_BRAND
    base = _DEFAULTS.get(key) or _DEFAULTS[config.DEFAULT_BRAND]
    merged = {k: (dict(v) if isinstance(v, dict) else v) for k, v in base.items()}
    path = config.config_dir(key) / "brand_theme.json"
    if path.exists():
        for k, v in json.loads(path.read_text(encoding="utf-8")).items():
            if isinstance(v, dict) and isinstance(merged.get(k), dict):
                merged[k].update(v)
            else:
                merged[k] = v
    return _validate(key, merged)
