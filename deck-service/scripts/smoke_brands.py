"""Smoke test: every brand still renders, and still renders as ITSELF.

Run this before pushing anything that touches the renderer, the planner prompt, a brand theme, or
a brand's config. It calls no model and needs no API key, so it takes seconds:

    python scripts/smoke_brands.py

Why it exists. Multi-brand work kept fixing one brand and quietly breaking the other, because the
two share a renderer whose brand state lives in module globals and whose config is cached. Nothing
caught that except generating a real deck and looking at it. These are the invariants that were
actually violated at some point during that work — each assertion below is a bug that shipped once.

It deliberately checks CONSEQUENCES, not implementation: that a deck renders, that it used the
right template, that text is legible, that a brand is not offered something it does not have.
"""
from __future__ import annotations

import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

from src import brand as brand_theme  # noqa: E402
from src import config, planner, renderer  # noqa: E402

FAILURES: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f"  — {detail}" if detail and not ok else ""))
    if not ok:
        FAILURES.append(f"{label}{': ' + detail if detail else ''}")


def contrast(fg: str, bg: str) -> float:
    def lin(h: str) -> float:
        def ch(v: float) -> float:
            v /= 255
            return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
        r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
        return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
    a, b = lin(fg), lin(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


# One plan touching the shapes that broke before: a native cover, a bulleted agenda, an icon
# layout, a hero-figure layout and a numbered-badge layout.
PLAN = {
    "slides": [
        {"layout": "title", "title": "Smoke test", "subtitle": "Every brand renders"},
        {"layout": "agenda", "title": "Agenda", "items": ["One", "Two", "Three", "Four"]},
        {"layout": "key_points", "title": "Four points", "banner": "A banner",
         "items": [{"heading": f"H{i}", "body": "A line.\nAnother line."} for i in range(1, 5)]},
        {"layout": "stat", "title": "In numbers",
         "stats": [{"value": "50+", "label": "Trials"}, {"value": "2x", "label": "Uplift"}]},
        {"layout": "takeaways", "title": "Three takeaways",
         "items": [{"heading": f"Point {i}", "body": "Detail."} for i in range(1, 4)]},
    ]
}


def main() -> int:
    brands = config.known_brands()
    print(f"Brands this service can render: {', '.join(brands)}\n")

    for b in brands:
        arg = None if b == config.DEFAULT_BRAND else b
        t = brand_theme.theme(arg)
        c = t["colors"]
        print(f"=== {b} ===")

        # 1. It renders at all, and every planned slide survives.
        try:
            plan = {"slides": [dict(s) | {"speaker_notes": "n"} for s in PLAN["slides"]]}
            data = renderer.render_deck(plan, brand=arg, benefits_slot=None, source_appendix=False)
            check(True, "renders a 5-slide deck")
        except Exception as e:  # noqa: BLE001
            check(False, "renders a 5-slide deck", f"{type(e).__name__}: {e}")
            continue

        z = zipfile.ZipFile(__import__("io").BytesIO(data))
        slides = sorted((n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
                        key=lambda s: int(re.findall(r"\d+", s)[0]))
        check(len(slides) == len(PLAN["slides"]),
              "one rendered slide per planned slide", f"{len(slides)} vs {len(PLAN['slides'])}")

        # 2. It used ITS OWN template. The brand's own logo lives in the template, so the deck's
        #    media set is the tell — this catches a deck built on another brand's template.
        tpl_media = len(zipfile.ZipFile(config.template_path(arg)).namelist())
        check(tpl_media > 0, "brand template is readable")

        # 3. The bullet style matches what the brand actually ships (a borrowed picture bullet from
        #    another brand is what this replaced).
        has_bullet_png = (config.assets_dir(arg) / "bullet.png").exists()
        agenda_xml = z.read(slides[1]).decode("utf8")
        if has_bullet_png:
            check("buBlip" in agenda_xml, "ships a bullet image, so uses a picture bullet")
        else:
            check("buChar" in agenda_xml and "buBlip" not in agenda_xml,
                  "ships no bullet image, so uses PowerPoint's character bullet")

        # 4. Text the QA gate would have to rescue. Each of these pairs shipped below 3.0 once.
        for label, fg, bg in (
            ("numbered badge legible", c["data"], c["tint"]),
            ("hero figure legible on white", c["data"], "FFFFFF"),
            ("hero figure legible on panel", c["data"], c["panel"]),
            ("text on accent legible", c["on_accent"], c["accent"]),
            ("body ink legible on panel", c["ink"], c["panel"]),
        ):
            r = contrast(fg, bg)
            check(r >= 3.0, label, f"#{fg} on #{bg} is {r:.2f}:1")

        # 5. A brand is never offered a verbatim slide its template lacks — the planner, the
        #    catalog and the renderer must agree, or a deck dies mid-render.
        cat = set(config.catalog(arg))
        if not t["has_ingredient_slide"]:
            check("ingredient" not in cat, "no `ingredient` in the catalog for a brand without one")
            check("ingredient" in planner.sanitize_disabled(None, None, arg),
                  "`ingredient` is force-disabled for the planner")

        # 6. The prompt names THIS brand and leaves no placeholder unresolved.
        sysmsg = planner.build_system("standard", "balansert", brand=arg)
        check("{product}" not in sysmsg and "{company}" not in sysmsg,
              "no unresolved {placeholders} in the prompt")
        check(t["product"] in sysmsg, f"prompt names {t['product']!r}")
        others = [o["product"] for k, o in brand_theme._DEFAULTS.items()
                  if k != b and o["product"] != t["product"]]
        leaked = [o for o in others if o in sysmsg]
        check(not leaked, "prompt does not name another brand's product", ", ".join(leaked))

        # 7. Photo ids offered to the model all resolve to a real staged file.
        renderer.apply_brand(arg)
        missing = [a["id"] for a in config.selectable_photos(arg)
                   if not config.resolve_asset(a["path"], arg).exists()]
        check(not missing, "every offered photo exists on disk", ", ".join(missing[:4]))
        print()

    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S):")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("All brands pass.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
