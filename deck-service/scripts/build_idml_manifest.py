"""Build config/idml_manifest.json from assets/whitepaper_template.idml.

The IDML analog of build_manifest/build_schema for the pptx template. The STORY MAP below
is the curated part: which stories of the Healthy Aging whitepaper are semantic slots
(curated once per template from scripts/inspect_idml.py output + frame geometry). Everything
NOT mapped stays locked — diagram labels, the "Scientifically Proven Benefits" grid, EFSA
stats, contact block, trademark and legal text are never touched by the fill.

All numeric budgets are MEASURED from the template: each slot records its payload lines
(bullet markers excluded) with a per-line char cap derived from the text the frame holds
today, so the planner cannot overflow a frame it cannot see.

    python scripts/build_idml_manifest.py
"""
from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:  # noqa: BLE001
    pass

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from src.idml import line_text, payload_lines, payload_text  # noqa: E402

TEMPLATE = ROOT / "assets" / "whitepaper_template.idml"
OUT = ROOT / "config" / "idml_manifest.json"

# ---------------------------------------------------------------------------
# Curated story map — Healthy Aging whitepaper (Superba_Healthy_Aging_Whitepaper_07Dec25).
# Card -> dose grouping verified against frame geometry (column x-positions) and the
# actual study dosages (Stonehouse 4 g/day, Suzuki 2 g/day, Deutsch 300 mg/day, ...).
# ---------------------------------------------------------------------------

COVER = {"title": ("u41a4", "single"), "subtitle": ("u41bb", "single"), "hero": ("u418d", "single")}

RUNNING_TOPIC = ["u4616", "u4660", "u473a", "u47a5"]   # "Healthy Aging Research" corners
EDITION = ["u4b59", "u1eb8"]                            # "White Paper – 2025" corners
DISCLAIMER = "u1809"                                    # legal note (AI note is prepended)

INTRO = {  # page 2: the mechanism/absorption story
    "title": ("u3ab", "single"),
    "lead": ("u3c2", "prose"),
    "body_1": ("u3d9", "prose"),
    "body_2": ("u57c", "prose"),
}

# Sections in template page order. Each: slots + trial cards (header, body, dose boxes).
SECTIONS = {
    "s1": {
        "topic_hint": "Largest section: pages 3 and 4, benefit theme #1 (heart health in the template). 8 trial cards.",
        "slots": {
            "benefits_title": ("u1a5a", "lines"),
            "benefits": ("u1a71", "lines"),
            "body": ("u645", "prose"),
            "trial_header": ("u94e", "single"),
            "trial_notes": ("u407a", "lines"),  # extra results column of card 8
        },
        "cards": [
            ("uda5", "udbd", ["udd9", "udf0"]),
            ("ue21", "ue38", ["ue55", "ue6c", "ue84"]),
            ("ueb3", "ueca", ["uee6", "uefd"]),
            ("u13e6", "u13fd", ["u141b", "u1432"]),
            ("u1462", "u1479", ["u1495", "u14ac"]),
            ("u14f2", "u1509", ["u1526", "u153d", "u1613"]),
            ("u3e8a", "u3ea1", []),
            ("u4015", "u402c", ["u405f", "u4096", "u40b2", "u40ce"]),
        ],
    },
    "s2": {
        "topic_hint": "Page 5, benefit theme #2 (cognitive health in the template). 1 trial card + a long deep-dive body.",
        "slots": {
            "page_topic": ("u462e", "single"),
            "benefits_title": ("u193a", "lines"),
            "benefits": ("u1951", "lines"),
            "lead": ("u19cb", "prose"),
            "body": ("u1ace", "prose"),
            "trial_header": ("u1c1b", "single"),
        },
        "cards": [("u1cf1", "u1d08", ["u1d24", "u1d3b", "u1d80"])],
    },
    "s3": {
        "topic_hint": "Pages 6 and 7, benefit theme #3 (muscle & mobility in the template). One preclinical card + one human trial card.",
        "slots": {
            "page_topic": ("u4677", "single"),
            "benefits_title": ("u1f06", "lines"),
            "benefits_box_1": ("u1f1d", "lines"),
            "benefits_box_2": ("u1fa8", "lines"),
            "body_1": ("u1f63", "prose"),
            "body_2": ("u1fcb", "prose"),
            "preclinical_header": ("u2e50", "single"),
            "preclinical_body": ("u2f1c", "prose"),
            "trial_header": ("u30d7", "single"),
        },
        "cards": [
            ("u2e84", "u2e9b", ["u2eb3"]),
            ("u3133", "u314b", ["u31b2", "u31c9"]),
        ],
    },
    "s4": {
        "topic_hint": "Page 8, benefit themes #4 (joint health: 3 cards) and #5 (metabolic/body composition: 1 card).",
        "slots": {
            "page_topic": ("u4752", "single"),
            "trial_header": ("u394f", "single"),
            "trial_header_2": ("u4bbd", "single"),
            "body": ("u3514", "prose"),
            "benefits": ("u4c7c", "lines"),
        },
        "cards": [
            ("u37e2", "u37f9", ["u3c8f", "u3cc4"]),
            ("u385b", "u3872", ["u388e", "u38a6"]),
            ("u38ed", "u3904", ["u3920", "u3937"]),
            ("u3cfe", "u3d15", ["u3d2d", "u3d44"]),
        ],
    },
    "s5": {
        "topic_hint": "Pages 9 and 10, benefit theme #6 (eye health in the template) + a broader research outlook body. 1 trial card.",
        "slots": {
            "page_topic": ("u47bc", "single"),
            "benefits_title": ("u31ef", "lines"),
            "benefits": ("u3206", "lines"),
            "body": ("u3220", "prose"),
            "outlook_body": ("u349e", "prose"),
            "trial_header": ("u33a8", "single"),
        },
        "cards": [("u33db", "u33f2", ["u340a", "u3421", "u3438"])],
    },
}

CONCLUSION = {"para_1": ("u2df6", "prose"), "para_2": ("u2e0d", "prose")}
CTA = {"text": ("u1835", "single")}


def _story_root(z: zipfile.ZipFile, sid: str) -> ET.Element:
    return ET.fromstring(z.read(f"Stories/Story_{sid}.xml").decode("utf-8"))


def _cap(n: int, mode: str) -> int:
    """Per-line budget from the measured length: a little headroom for prose, floors for
    short labels so the planner is not squeezed into 10-char titles."""
    if mode == "prose":
        return max(int(n * 1.1) + 10, 60)
    return max(n, 24)


def _slot(z: zipfile.ZipFile, sid: str, mode: str) -> dict:
    root = _story_root(z, sid)
    lines = payload_lines(root)
    sample = " / ".join(line_text(ln).strip() for ln in lines[:2])[:90]
    return {"story": sid, "mode": mode,
            "lines": [{"cap": _cap(len(payload_text(ln)), mode)} for ln in lines] or [{"cap": 80}],
            "sample": sample}


def _group(z: zipfile.ZipFile, mapping: dict) -> dict:
    return {"slots": {k: _slot(z, sid, mode) for k, (sid, mode) in mapping.items()}}


def main() -> None:
    z = zipfile.ZipFile(TEMPLATE)

    sections = {}
    for skey, sec in SECTIONS.items():
        cards = []
        for header, body, doses in sec["cards"]:
            cards.append({
                "header": _slot(z, header, "single"),
                "body": _slot(z, body, "card"),
                "doses": [_slot(z, d, "single") for d in doses],
            })
        sections[skey] = {"topic_hint": sec["topic_hint"],
                          "slots": _group(z, sec["slots"])["slots"], "cards": cards}

    rt_root = _story_root(z, RUNNING_TOPIC[0])
    rt_lines = payload_lines(rt_root)
    rt_cap = max((len(payload_text(rt_lines[0])) + 6) if rt_lines else 28, 28)

    manifest = {
        "template": "assets/whitepaper_template.idml",
        "source_document": "Superba_Healthy_Aging_Whitepaper_07Dec25 (AKBM design team, 2026-07)",
        "edition_stories": EDITION,
        "disclaimer_story": DISCLAIMER,
        "groups": {
            "cover": _group(z, COVER),
            "running_topic": {"stories": RUNNING_TOPIC, "cap": rt_cap,
                              "sample": line_text(rt_lines[0]).strip() if rt_lines else ""},
            "intro": _group(z, INTRO),
            "sections": {"sections": sections},
            "conclusion": _group(z, CONCLUSION),
            "cta": _group(z, CTA),
        },
    }
    OUT.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    n_slots = sum(1 for _ in _walk(manifest))
    print(f"Wrote {OUT} — {len(sections)} sections, "
          f"{sum(len(s['cards']) for s in sections.values())} trial cards, {n_slots} slots total.")


def _walk(manifest: dict):
    g = manifest["groups"]
    for name in ("cover", "intro", "conclusion", "cta"):
        yield from g[name]["slots"].values()
    for sec in g["sections"]["sections"].values():
        yield from sec["slots"].values()
        for c in sec["cards"]:
            yield c["header"]
            yield c["body"]
            yield from c["doses"]


if __name__ == "__main__":
    main()
