"""Deterministic 'ingredient anatomy' slide — AKBM's standard product-overview layout.

A central krill-oil capsule with up to four nutrient callouts placed in the corners,
each linked to the capsule by a thin connector line. Rendered deterministically (no LLM),
so it is always perfectly aligned and on-brand. Converts to native PowerPoint.

data = {
  "title": str,                       # centred, top
  "top_note": str (optional),         # centred italic, above the capsule
  "bottom_note": str (optional),      # centred italic, below the capsule
  "nutrients": [ {"heading": str, "body": str}, ... up to 4 ],  # TL, TR, BL, BR order
  "source": str (optional),
}
render_anatomy(data) -> SVG string.
"""
from __future__ import annotations
import html

W, H = 1280, 720
POLAR = "#E9F7F8"; RED = "#E30917"; TEAL_L = "#A9DBD5"; SEA = "#175969"


def _esc(s):
    return html.escape(s or "")


def _wrap(text, max_chars):
    words, lines, cur = (text or "").split(), [], ""
    for w in words:
        if cur and len(cur) + 1 + len(w) > max_chars:
            lines.append(cur); cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return lines


def _lines(text, x, y, size, lh, *, anchor, fill, font="Manrope", weight=None, style=None, spacing=None, max_chars=40):
    a = f'font-family="{font}" font-size="{size}" fill="{fill}" text-anchor="{anchor}"'
    if weight: a += f' font-weight="{weight}"'
    if style: a += f' font-style="{style}"'
    if spacing: a += f' letter-spacing="{spacing}"'
    out = []
    for i, ln in enumerate(_wrap(text, max_chars)):
        out.append(f'<text x="{x}" y="{y + i*lh}" {a}>{_esc(ln)}</text>')
    return "\n  ".join(out)


def render_anatomy(data: dict) -> str:
    cx, cy, rx, ry = 640, 386, 116, 74           # central capsule
    nutrients = (data.get("nutrients") or [])[:4]
    # corner anchors: (heading_x, heading_y, text-anchor, connector start x,y -> toward capsule)
    slots = [
        (470, 330, "end",   (470, 342), (cx - rx, 360)),   # TL
        (810, 330, "start", (810, 342), (cx + rx, 360)),   # TR
        (470, 486, "end",   (470, 498), (cx - rx, 412)),   # BL
        (810, 486, "start", (810, 498), (cx + rx, 412)),   # BR
    ]
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        f'<image xlink:href="bg_deep_sea.jpg" x="0" y="0" width="{W}" height="{H}" preserveAspectRatio="xMidYMid slice"/>',
    ]
    # title (centred, up to 2 lines) + notes
    parts.append(_lines(data.get("title", ""), cx, 92, 33, 42, anchor="middle", fill=POLAR,
                        font="Exo 2", weight=700, style="italic", max_chars=52))
    if data.get("top_note"):
        parts.append(_lines(data["top_note"], cx, 232, 18, 25, anchor="middle", fill=TEAL_L,
                            style="italic", max_chars=44))
    if data.get("bottom_note"):
        parts.append(_lines(data["bottom_note"], cx, 556, 19, 26, anchor="middle", fill=TEAL_L,
                            style="italic", max_chars=44))
    # connector lines (drawn under the capsule)
    for i, n in enumerate(nutrients):
        _, _, _, (sx, sy), (ex, ey) = slots[i]
        parts.append(f'<line x1="{sx}" y1="{sy}" x2="{ex}" y2="{ey}" stroke="{TEAL_L}" '
                     f'stroke-width="1" opacity="0.45"/>')
    # capsule — real AKBM softgel photo (background cut out to transparent)
    cw, ch = 250, 174
    parts.append(f'<image xlink:href="capsule_single.png" x="{cx - cw // 2}" y="{cy - ch // 2}" '
                 f'width="{cw}" height="{ch}" preserveAspectRatio="xMidYMid meet"/>')
    # nutrient callouts
    for i, n in enumerate(nutrients):
        hx, hy, anchor, _, _ = slots[i]
        parts.append(f'<text x="{hx}" y="{hy}" font-family="Exo 2" font-size="20" font-weight="700" '
                     f'font-style="italic" fill="{POLAR}" text-anchor="{anchor}">{_esc(n.get("heading",""))}</text>')
        parts.append(_lines(n.get("body", ""), hx, hy + 30, 14, 20, anchor=anchor, fill=TEAL_L, max_chars=34))
    # source + footer logos (fixed brand positions)
    if data.get("source"):
        parts.append(f'<text x="64" y="628" font-family="Manrope" font-size="12" fill="{SEA}">{_esc(data["source"])}</text>')
    parts.append('<image xlink:href="superba_white.png" x="32" y="666" width="189" height="31" preserveAspectRatio="xMinYMid meet"/>')
    parts.append('<image xlink:href="aker_white.png" x="1096" y="674" width="139" height="17" preserveAspectRatio="xMaxYMid meet"/>')
    parts.append('</svg>')
    return "\n".join(parts)
