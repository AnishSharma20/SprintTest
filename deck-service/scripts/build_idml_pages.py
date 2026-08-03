"""Build config/idml_pages.json — the PAGE LIBRARY for cross-template whitepapers.

Where build_idml_manifest.py maps ONE template (Healthy Aging) end to end, this maps a library of
individually designed PAGES drawn from the three standard A4 Superba brochures (Sport Performance,
Sustainability, Superba Brochure) so `idml_compose.py` can assemble a document out of them and the
existing fill engine can pour text into the chosen pages.

The curated part is PAGES below: per page a semantic ROLE, an optional THEME, and — measured from
the template — a slot map of the text frames we may rewrite. Everything not listed as a slot is
LOCKED and inherited byte for byte, exactly like the pptx pipeline's verbatim ingredient slide.

Three classes of page, learned by inventorying every frame (scripts/inspect_idml.py):

  fill=True   Prose pages: a handful of large text frames (covers, narrative spreads, closings).
              Safe to re-theme, because nothing but words lives in them.

  fill=False  Reference pages used VERBATIM. Two reasons a page lands here:
              * its artwork is welded to its words — the benefit grid's hexagon ICONS depict
                specific benefits, so renaming "HEART SUPPORT" would leave a heart icon over immune
                copy (the same icon/topic mismatch the deck renderer forbids);
              * its numbers are product facts, not prose — the portfolio table's mg values.

  excluded    Data figure pages (e.g. Sport's middle spread, 61 frames of chart axis ticks). The
              charts are IMAGES we cannot regenerate, so re-theming the labels would caption one
              study's data with another study's story. Listed in EXCLUDED with the reason.

    python scripts/build_idml_pages.py
"""
from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from src.idml import line_text, payload_lines, payload_text  # noqa: E402
from src.idml_compose import Source, spread_images  # noqa: E402

OUT = ROOT / "config" / "idml_pages.json"

# The three standard A4 brochures. Fish Oil is excluded (different brand, different type system) and
# Healthy Aging is excluded here (US Letter and far longer than AKBM's standard brochure) — it keeps
# its own dedicated manifest in config/idml_manifest.json.
TEMPLATES = {
    "sport": "assets/whitepaper_sport.idml",
    "sustainability": "assets/whitepaper_sustainability.idml",
    "brochure": "assets/whitepaper_brochure.idml",
}

# --------------------------------------------------------------------------------------------
# Curated page library. Slot ids verified against frame geometry + current text.
# --------------------------------------------------------------------------------------------
PAGES = [
    {
        "id": "cover_sports", "template": "sport", "spread": "u10a81",
        "role": "cover", "theme": "sports", "fill": True,
        "hint": "Athletic cover photo (running shoes). Use for performance, muscle, recovery topics.",
        "slots": {"title": ("ufa5c", "single"), "subtitle": ("ufa75", "single"),
                  "hero": ("uf9fb", "prose")},
    },
    {
        "id": "cover_whole_body", "template": "brochure", "spread": "ud1",
        "role": "cover", "theme": "general", "fill": True,
        "hint": "Whole body wellness cover. The neutral default cover for any topic.",
        "slots": {"title": ("u1c4", "single"), "hero": ("u1ab", "prose")},
    },
    {
        "id": "cover_credentials", "template": "sustainability", "spread": "ud1",
        "role": "cover", "theme": "science", "fill": True,
        "hint": ("Scientific cover carrying FOUR headline figures (trials, studies, health domains, "
                 "EFSA claims). Use when the evidence base itself is the story."),
        "slots": {"eyebrow": ("u6dd", "single"), "title": ("u1c2", "single"),
                  "subtitle": ("u1db", "single"), "byline": ("u1a9", "single"),
                  "stat_1_value": ("u6f6", "single"), "stat_1_label": ("u70f", "single"),
                  "stat_2_value": ("u745", "single"), "stat_2_label": ("u72c", "single"),
                  "stat_3_value": ("u777", "single"), "stat_3_label": ("u75e", "single"),
                  "stat_4_value": ("u7ae", "single"), "stat_4_label": ("u795", "single")},
    },
    {
        "id": "narrative_four_sections", "template": "sustainability", "spread": "ue0",
        "role": "narrative", "theme": "any", "fill": True,
        "hint": ("Two page narrative spread: a lead paragraph plus FOUR heading and body sections. "
                 "The workhorse page for the argument of the whitepaper."),
        "slots": {"lead": ("u214", "prose"),
                  "heading_1": ("u2b9", "single"), "body_1": ("u2d2", "prose"),
                  "heading_2": ("u22e", "single"), "body_2": ("u261", "prose"),
                  "heading_3": ("u449", "single"), "body_3": ("u462", "prose"),
                  "heading_4": ("u3cf", "single"), "body_4": ("u3e8", "prose")},
        # u618/u65e/u47e/u69e are captions welded to the Antarctica / marine protected area
        # graphics, so they stay as designed.
        "locked_note": "Map graphic captions inherited unchanged.",
    },
    {
        "id": "closing_outlook", "template": "sustainability", "spread": "uee",
        "role": "closing", "theme": "any", "fill": True,
        "hint": ("Closing page: a long final section, a short forward looking block and the "
                 "reference list. Use as the last text page."),
        "slots": {"heading": ("u328", "single"), "body": ("u341", "prose"),
                  "outlook_heading": ("u360", "single"), "outlook_body": ("u379", "prose"),
                  "references": ("u50c", "prose")},
        "locked_note": "The superbakrill.com line is inherited unchanged.",
    },
    {
        "id": "narrative_with_charts", "template": "sport", "spread": "u10a9f",
        "role": "closing", "theme": "sports", "fill": True,
        "requires_matching_data": True,
        "hint": ("Narrative plus TWO published data charts (percent change after 6 months; WOMAC "
                 "pain score), then a conclusion band and references. The charts are fixed images "
                 "of real muscle and joint trial data, so only use this page when the source "
                 "actually reports those trials."),
        "slots": {"heading": ("u105a4", "single"), "body": ("u105bd", "prose"),
                  "conclusion_label": ("u10b8f", "single"), "conclusion": ("u1090c", "prose"),
                  "references": ("u10231", "prose")},
        "locked_note": "All Fig. 4 / Fig. 5 axis and value labels are locked to the chart artwork.",
    },
    {
        "id": "benefit_grid", "template": "brochure", "spread": "ue7",
        "role": "benefit_grid", "theme": "any", "fill": False,
        "hint": ("VERBATIM. The Scientifically Proven Benefits grid: 13 benefit tiles whose hexagon "
                 "icons and published trial counts are brand facts. Include it to substantiate the "
                 "product; never re-theme it."),
    },
    {
        "id": "composition_portfolio", "template": "brochure", "spread": "ue0",
        "role": "composition", "theme": "any", "fill": False,
        "hint": ("VERBATIM. Two page ingredient and portfolio spread: the phospholipid/choline/"
                 "astaxanthin diagram plus the Superba 2 vs Boost specification table (mg values are "
                 "product facts). The InDesign analog of the deck's verbatim ingredient slide."),
    },
]

# Pages deliberately kept out of the library, with the reason (so this is a decision, not an oversight).
EXCLUDED = {
    "sport/uf465": ("61 text frames that are almost entirely chart axis ticks, figure numbers and "
                    "significance markers bound to fixed chart images; re-theming the words would "
                    "mislabel real study data."),
}


def _cap(n: int, mode: str) -> int:
    """Per line budget MEASURED from the text the frame holds today.

    Deliberately conservative: the designer's own text is assumed to roughly FILL its frame, so
    adding headroom (an earlier version used n*1.1+10) guaranteed overset on any frame that was
    already full — the cover lost a whole title line that way. We therefore aim slightly UNDER the
    measured length. Erring short leaves a little white space; erring long silently hides text,
    and with no IDML renderer we cannot see which happened.
    """
    if mode == "prose":
        return max(int(n * 0.95), 30)
    return max(n, 6)
def _slot(src: Source, story: str, mode: str) -> dict:
    root = src.story_root(story)
    lines = payload_lines(root)
    return {
        "story": story, "mode": mode,
        "lines": [{"cap": _cap(len(payload_text(ln)), mode)} for ln in lines] or [{"cap": 80}],
        "sample": " ⏎ ".join(line_text(ln).strip() for ln in lines[:2])[:90],
    }


def main() -> None:
    missing = [t for t, rel in TEMPLATES.items() if not (ROOT / rel).exists()]
    if missing:
        raise SystemExit(f"Missing template files for {missing}. Copy the brochure .idml files into "
                         f"deck-service/assets/ first (see TEMPLATES).")

    srcs = {key: Source(key, ROOT / rel, "") for key, rel in TEMPLATES.items()}

    pages = []
    for spec in PAGES:
        src = srcs[spec["template"]]
        entry = {k: v for k, v in spec.items() if k != "slots"}
        entry["images"] = sorted(spread_images(src, spec["spread"]))
        if spec.get("fill"):
            entry["slots"] = {name: _slot(src, story, mode)
                              for name, (story, mode) in spec["slots"].items()}
        pages.append(entry)

    library = {
        "templates": TEMPLATES,
        "note": ("Page library for cross template composition. Pages with fill=false are placed "
                 "verbatim. Every frame not listed as a slot is inherited unchanged."),
        "excluded": EXCLUDED,
        "pages": pages,
    }
    OUT.write_text(json.dumps(library, indent=2, ensure_ascii=False), encoding="utf-8")

    n_fill = sum(1 for p in pages if p.get("fill"))
    n_slots = sum(len(p.get("slots", {})) for p in pages)
    print(f"Wrote {OUT}")
    print(f"  {len(pages)} pages ({n_fill} fillable, {len(pages) - n_fill} verbatim), "
          f"{n_slots} text slots, {len(EXCLUDED)} page(s) excluded by design")
    for p in pages:
        kind = f"{len(p.get('slots', {}))} slots" if p.get("fill") else "VERBATIM"
        print(f"    {p['id']:26s} {p['role']:13s} {p['theme']:8s} {kind:10s} "
              f"{len(p['images'])} images")


if __name__ == "__main__":
    main()
