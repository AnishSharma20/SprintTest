"""Deterministic clustered-column chart slide for the Superba pipeline.

All 9 charts in the real AKBM deck are clustered column, 1-2 series (Krill vs Placebo),
Ruby-Red treatment series, with a right-side numeric callout. We render that archetype
in pure Python from planner-supplied data — no LLM drawing — so bars, labels and callouts
are always geometrically correct (no overflow/collision, so it needs no gate retry).

data = {
  "title": str, "kicker": str (optional),
  "categories": [str, ...],
  "series": [ {"name": str, "values": [float,...], "role": "treatment"|"comparator"} , ... 1-2 ],
  "unit": str (optional, e.g. "kg", "%"),
  "callout": [ {"value": str, "label": str}, ... up to 3 ],
  "source": str (optional),
}
render_chart(data) -> SVG string (native colors/fonts, dark background).
"""
from __future__ import annotations
import html

W, H = 1280, 720
GREEN = "#163536"; POLAR = "#E9F7F8"; RED = "#E50A1A"; ALT_RED = "#BD393F"
TEAL = "#60A09B"; TEAL_L = "#A9DBD5"; SEA = "#175969"
SERIES_FILL = {"treatment": ALT_RED, "comparator": TEAL}


def _fmt(v: float) -> str:
    s = f"{v:.1f}".rstrip("0").rstrip(".")
    return s


def _esc(s: str) -> str:
    return html.escape(s or "")


def render_chart(data: dict) -> str:
    cats = data.get("categories", [])
    series = (data.get("series") or [])[:2]
    unit = data.get("unit", "")
    callout = (data.get("callout") or [])[:3]
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        f'<rect x="0" y="0" width="{W}" height="{H}" fill="{GREEN}"/>',
    ]
    # ---- header ----
    if data.get("kicker"):
        parts.append(f'<text x="64" y="92" font-family="Manrope" font-size="15" font-weight="700" '
                     f'fill="{RED}" letter-spacing="2">{_esc(data["kicker"])}</text>')
    parts.append(f'<text x="64" y="140" font-family="Exo 2" font-size="34" font-style="italic" '
                 f'font-weight="700" fill="{POLAR}">{_esc(data.get("title",""))}</text>')
    parts.append(f'<rect x="66" y="158" width="70" height="6" fill="{RED}"/>')

    # ---- plot area (left) ----
    PX0, PX1 = 120, 700          # x range of bars
    PY0, PY1 = 560, 240          # baseline y (bottom) and top y
    all_vals = [v for s in series for v in s.get("values", [])] or [1]
    vmax = max(all_vals) or 1
    # round vmax up to a "nice" number for headroom
    import math
    mag = 10 ** math.floor(math.log10(vmax)) if vmax > 0 else 1
    vmax = math.ceil(vmax / (mag / 2)) * (mag / 2) if mag else vmax
    parts.append(f'<line x1="{PX0}" y1="{PY0}" x2="{PX1}" y2="{PY0}" stroke="{TEAL}" stroke-width="1.5"/>')

    n_cat = max(1, len(cats))
    n_ser = max(1, len(series))
    group_w = (PX1 - PX0) / n_cat
    bar_w = min(70, group_w / (n_ser + 0.8))
    for ci, cat in enumerate(cats):
        gx = PX0 + ci * group_w + (group_w - bar_w * n_ser) / 2
        for si, s in enumerate(series):
            vals = s.get("values", [])
            v = vals[ci] if ci < len(vals) else 0
            bh = (v / vmax) * (PY0 - PY1)
            bx = gx + si * bar_w
            fill = SERIES_FILL.get(s.get("role", "comparator"), TEAL)
            parts.append(f'<rect x="{bx:.1f}" y="{PY0 - bh:.1f}" width="{bar_w - 6:.1f}" height="{bh:.1f}" rx="3" fill="{fill}"/>')
            parts.append(f'<text x="{bx + (bar_w - 6) / 2:.1f}" y="{PY0 - bh - 10:.1f}" font-family="Exo 2" '
                         f'font-size="18" font-style="italic" font-weight="700" fill="{POLAR}" '
                         f'text-anchor="middle">{_fmt(v)}{_esc(unit)}</text>')
        # category label under baseline
        parts.append(f'<text x="{PX0 + ci * group_w + group_w / 2:.1f}" y="{PY0 + 28}" font-family="Manrope" '
                     f'font-size="15" fill="{TEAL_L}" text-anchor="middle">{_esc(cat)}</text>')

    # ---- legend (top of plot) ----
    lx = PX0
    for s in series:
        fill = SERIES_FILL.get(s.get("role", "comparator"), TEAL)
        parts.append(f'<rect x="{lx}" y="200" width="16" height="16" rx="3" fill="{fill}"/>')
        name = _esc(s.get("name", ""))
        parts.append(f'<text x="{lx + 24}" y="213" font-family="Manrope" font-size="15" fill="{POLAR}">{name}</text>')
        lx += 40 + len(s.get("name", "")) * 9

    # ---- numeric callout (right) ----
    cx = 780
    parts.append(f'<line x1="{cx}" y1="240" x2="{cx}" y2="560" stroke="{SEA}" stroke-width="1"/>')
    cy = 300
    for item in callout:
        parts.append(f'<text x="{cx + 30}" y="{cy}" font-family="Exo 2" font-size="52" font-style="italic" '
                     f'font-weight="700" fill="{RED}">{_esc(item.get("value",""))}</text>')
        parts.append(f'<text x="{cx + 32}" y="{cy + 34}" font-family="Manrope" font-size="17" '
                     f'fill="{TEAL_L}">{_esc(item.get("label",""))}</text>')
        cy += 110

    # ---- source + footer logos ----
    if data.get("source"):
        parts.append(f'<text x="64" y="628" font-family="Manrope" font-size="13" fill="{TEAL}">{_esc(data["source"])}</text>')
    parts.append(f'<image xlink:href="superba_white.png" x="64" y="656" width="170" height="30" preserveAspectRatio="xMinYMid meet"/>')
    parts.append(f'<image xlink:href="aker_white.png" x="1080" y="658" width="136" height="28" preserveAspectRatio="xMaxYMid meet"/>')
    parts.append('</svg>')
    return "\n".join(parts)
