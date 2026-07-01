"""The Superba layout catalog — defined in code (the renderer draws each).

Each layout lists the fields the planner may fill and guidance on what each is for and
how much text it holds. The python-pptx renderer in ``render.py`` has a drawing
function per layout keyed by these same names.
"""
from __future__ import annotations

LAYOUTS: dict[str, dict] = {
    "cover": {
        "master": "dark",
        "fields": ["TITLE", "SUBTITLE"],
        "guidance": "Opening cover. TITLE = benefit-led deck title. SUBTITLE = one supporting line.",
    },
    "section": {
        "master": "dark",
        "fields": ["KICKER", "SECTION_TITLE"],
        "guidance": "Section divider. KICKER = tiny overline (e.g. 'SECTION 02'). SECTION_TITLE = short heading.",
    },
    "content": {
        "master": "light",
        "fields": ["TITLE", "BULLET_1", "BULLET_2", "BULLET_3", "BULLET_4", "BULLET_5"],
        "guidance": "Benefit bullets. TITLE = benefit headline. BULLET_1..5 = short benefit statements (use as many as needed).",
    },
    "stat": {
        "master": "dark",
        "fields": ["TITLE", "STAT_1_VALUE", "STAT_1_LABEL", "STAT_2_VALUE", "STAT_2_LABEL",
                   "STAT_3_VALUE", "STAT_3_LABEL", "SOURCE"],
        "guidance": "Big-number callouts. TITLE + up to 3 STAT_n_VALUE (short, e.g. '-5.18', '235', '6 mo') each with a STAT_n_LABEL. SOURCE = citation.",
    },
    "evidence": {
        "master": "light",
        "fields": ["HEADLINE", "CLAIM", "BADGE_1", "BADGE_2", "BADGE_3", "SOURCE"],
        "guidance": "One study as proof. HEADLINE = benefit claim. CLAIM = one/two-sentence plain statement. BADGE_1..3 = tiny proof chips (e.g. '235 adults', '6-month RCT', journal). SOURCE = citation.",
    },
    "two_col": {
        "master": "light",
        "fields": ["TITLE", "LEFT_TITLE", "LEFT_BODY", "RIGHT_TITLE", "RIGHT_BODY"],
        "guidance": "Side-by-side compare. TITLE + LEFT_TITLE/LEFT_BODY and RIGHT_TITLE/RIGHT_BODY. Bodies are short (a sentence or two).",
    },
    "ending": {
        "master": "dark",
        "fields": ["CTA_TITLE", "CONTACT", "DISCLAIMER"],
        "guidance": "Closing call to action. CTA_TITLE = short. CONTACT = contact line. DISCLAIMER = small print (e.g. EFSA note).",
    },
}


def catalog() -> str:
    """Planner-facing catalog: one block per layout with its fields and guidance."""
    lines = []
    for name, meta in LAYOUTS.items():
        lines.append(f"- {name} [{meta['master']}]: {meta['guidance']}\n    fields: {', '.join(meta['fields'])}")
    return "\n".join(lines)
