"""Fill frozen hero-slide SVG templates with per-deck copy.

The layout is locked in the .tmpl file; only {{PLACEHOLDER}} text changes. Each text
slot also has a {{KEY_SIZE}} companion that we compute with a shrink-to-fit so
variable-length copy never overflows the frame — the failure that historically sank
template-fill. Values are XML-escaped. The vision quality gate is the backstop.
"""
from __future__ import annotations
import html
import pathlib

USABLE_W = 1152  # x from 64 to 1216 on a 1280-wide canvas

# Per-font advance factor (fraction of font-size per character). Conservative so we
# under-fill rather than clip; the gate catches anything that slips through.
ADVANCE = {"exo2": 0.56, "manrope": 0.50}

TEMPLATE_DIR = pathlib.Path(__file__).resolve().parent / "templates"

# Brand "deep sea gradient" background (brand guide §4.1) — the OFFICIAL AKBM raster
# gradient (bg_green-1, downscaled to bg_deep_sea.jpg), staged as a full-bleed <image>.
# This replaces the earlier pure-SVG _SEA_DEFS approximation.
BG_DARK = "bg_deep_sea.jpg"

# "Krill swarm" red glow (brand guide §4.2) — the OFFICIAL AKBM krill-swoosh graphic
# (visual-element-krillArtboard-4, cropped/downscaled to krill_swoosh.png), staged as a soft
# atmospheric accent bleeding off the bottom-left corner. Replaces the old pure-SVG glow.
_KRILL = ('  <image xlink:href="krill_swoosh.png" x="-60" y="540" width="420" height="392" '
          'preserveAspectRatio="xMidYMid meet" opacity="0.9"/>\n')


def bg_image(x: int = 0, y: int = 0, w: int = 1280, h: int = 720,
             par: str = "xMidYMid slice") -> str:
    """A full-bleed (or panel) <image> of the official deep-sea gradient."""
    return (f'  <image xlink:href="{BG_DARK}" x="{x}" y="{y}" width="{w}" height="{h}" '
            f'preserveAspectRatio="{par}"/>\n')


def fit_size(text: str, base: int, floor: int, font: str = "exo2") -> int:
    """Largest size <= base keeping `text` on one line within USABLE_W."""
    if not text:
        return base
    adv = ADVANCE.get(font, 0.52)
    est = len(text) * adv * base
    if est <= USABLE_W:
        return base
    return max(floor, int(USABLE_W / (len(text) * adv)))


def _wrap(text: str, max_chars: int) -> list[str]:
    """Greedy word-wrap into lines of at most `max_chars` characters."""
    words, lines, cur = text.split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > max_chars:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return lines


def wrapped_lines(text: str, *, x: int, y: int, size: int, lh: int, font: str, fill: str, max_chars: int) -> str:
    """Render `text` as stacked <text> lines (SVG has no auto-wrap)."""
    out = []
    for i, line in enumerate(_wrap(text, max_chars)):
        out.append(f'<text x="{x}" y="{y + i * lh}" font-family="{font}" font-size="{size}" '
                   f'fill="{fill}">{html.escape(line)}</text>')
    return "\n  ".join(out)


def fill_template(template_id: str, values: dict, fits: dict, wraps: dict | None = None) -> str:
    """Fill templates/<template_id>.svg.tmpl.

    values: {PLACEHOLDER: text}
    fits:   {PLACEHOLDER: (base_size, floor_size, font)} for single-line shrink-to-fit slots.
    wraps:  {PLACEHOLDER: {x,y,size,lh,font,fill,max_chars}} for multi-line wrapped blocks
            (replaces the token {{PLACEHOLDER_LINES}}). Use for long legal/disclaimer text.
    """
    svg = (TEMPLATE_DIR / f"{template_id}.svg.tmpl").read_text(encoding="utf-8")
    for key, (base, floor, font) in fits.items():
        svg = svg.replace(f"{{{{{key}_SIZE}}}}", str(fit_size(values.get(key, ""), base, floor, font)))
    for key, spec in (wraps or {}).items():
        svg = svg.replace(f"{{{{{key}_LINES}}}}", wrapped_lines(values.get(key, ""), **spec))
    for key, val in values.items():
        svg = svg.replace(f"{{{{{key}}}}}", html.escape(val or ""))
    return svg


def _wrapped(text, x, y0, size, lh, font, fill, max_chars, *, weight=None, style=None, spacing=None):
    """Stacked wrapped <text> lines; returns (svg, last_baseline_y)."""
    attrs = f'font-family="{font}" font-size="{size}" fill="{fill}"'
    if weight:  attrs += f' font-weight="{weight}"'
    if style:   attrs += f' font-style="{style}"'
    if spacing: attrs += f' letter-spacing="{spacing}"'
    lines = _wrap(text, max_chars) or [""]
    parts = [f'<text x="{x}" y="{y0 + i * lh}" {attrs}>{html.escape(ln)}</text>' for i, ln in enumerate(lines)]
    return "\n  ".join(parts), y0 + (len(lines) - 1) * lh


def footer(*, dark: bool = True, superba: bool = True, aker: bool = True) -> str:
    """Fixed brand footer logos at the EXACT positions/sizes from the AKBM deck
    (measured off example slides 3 & 25): Superba bottom-left, Aker bottom-right.

    Omit a logo whose corner is covered by a photo: pass superba=False when an image
    occupies the bottom-left, aker=False when an image occupies the bottom-right.
    White logos on dark backgrounds, green on light.
    """
    sfx = "white" if dark else "green"
    out = []
    if superba:
        out.append(f'  <image xlink:href="superba_{sfx}.png" x="32" y="666" width="189" height="31" '
                   f'preserveAspectRatio="xMinYMid meet"/>')
    if aker:
        out.append(f'  <image xlink:href="aker_{sfx}.png" x="1096" y="674" width="139" height="17" '
                   f'preserveAspectRatio="xMaxYMid meet"/>')
    return ("\n".join(out) + "\n") if out else ""


# ---- AKBM signature hero layout: navy ellipse + left text panel + full-bleed right photo ----
# Built as functions (not static .tmpl) because the title wraps and the red bar + subtitle
# must flow beneath the actual last title line — dynamic vertical flow token-replace can't do.

def render_cover(title: str, subtitle: str, photo: str,
                 wordmark: str = "superba_white.png", aker: str = "aker_white.png") -> str:
    tsvg, tlast = _wrapped(title, 72, 300, 46, 54, "Exo 2", "#E9F7F8", 19, weight=700, style="italic")
    bar_y = tlast + 26
    ssvg, _ = _wrapped(subtitle, 72, bar_y + 44, 22, 30, "Manrope", "#A9DBD5", 45)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        'width="1280" height="720" viewBox="0 0 1280 720">\n'
        + bg_image() +
        f'  <image xlink:href="{photo}" x="600" y="-60" width="760" height="840" preserveAspectRatio="xMidYMid slice"/>\n'
        + bg_image(0, 0, 600, 720, "xMinYMid slice") +
        '  <ellipse cx="140" cy="360" rx="520" ry="430" fill="#003462" opacity="0.22"/>\n'
        + _KRILL +
        f'  {tsvg}\n'
        f'  {ssvg}\n'
        + footer(dark=True, superba=True, aker=False)  # photo on the right → Aker (bottom-right) hidden
        + '</svg>\n'
    )


def render_section(kicker: str, section_title: str, photo: str,
                   wordmark: str = "superba_white.png", aker: str = "aker_white.png") -> str:
    ksvg, _ = _wrapped(kicker, 72, 278, 16, 22, "Manrope", "#E30917", 40, weight=700, spacing=3)
    tsvg, _ = _wrapped(section_title, 72, 372, 44, 52, "Exo 2", "#E9F7F8", 19, weight=700, style="italic")
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        'width="1280" height="720" viewBox="0 0 1280 720">\n'
        + bg_image() +
        f'  <image xlink:href="{photo}" x="600" y="-60" width="760" height="840" preserveAspectRatio="xMidYMid slice"/>\n'
        + bg_image(0, 0, 600, 720, "xMinYMid slice") +
        '  <ellipse cx="140" cy="360" rx="520" ry="430" fill="#003462" opacity="0.22"/>\n'
        + _KRILL +
        f'  {ksvg}\n'
        f'  {tsvg}\n'
        + footer(dark=True, superba=True, aker=False)  # photo on the right → Aker (bottom-right) hidden
        + '</svg>\n'
    )


# Per-template placeholder + fit contract (the "fillable" surface of each hero slide).
HERO_FITS = {
    "cover":   {"TITLE": (60, 34, "exo2"), "SUBTITLE": (26, 18, "manrope")},
    "section": {"SECTION_TITLE": (46, 30, "exo2"), "KICKER": (16, 12, "manrope")},
    "ending":  {"CTA_TITLE": (52, 32, "exo2"), "CONTACT": (24, 16, "manrope")},
}
# Multi-line wrapped slots (long text that must never overflow on one line).
HERO_WRAPS = {
    "ending": {"DISCLAIMER": {"x": 64, "y": 548, "size": 13, "lh": 20,
                              "font": "Manrope", "fill": "#60A09B", "max_chars": 130}},
}
