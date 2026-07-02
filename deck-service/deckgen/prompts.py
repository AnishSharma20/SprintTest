"""Planner system prompt and forced-output schema (route 2: SVG generation).

Claude plans the whole deck: for each slide it picks one Superba layout and fills that
layout's fields with benefit-first sales copy, moving the heavy statistics into speaker
notes. Same wording discipline as before — every claim traces to the summary.
"""
from __future__ import annotations

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "deck_title": {"type": "string", "description": "Short benefit-led deck title."},
        "slides": {
            "type": "array",
            "description": "Ordered slides. Each picks one layout and fills its fields.",
            "items": {
                "type": "object",
                "properties": {
                    "layout": {
                        "type": "string",
                        "enum": ["cover", "section", "content", "stat", "evidence", "two_col", "ending"],
                        "description": "Which Superba layout to use for this slide.",
                    },
                    "fields": {
                        "type": "object",
                        "description": "Map of the chosen layout's field names (without braces) to text. Omit or leave empty any field you don't use.",
                        "additionalProperties": {"type": "string"},
                    },
                    "benefit": {
                        "type": "string",
                        "enum": ["heart", "joint", "liver", "muscle", "skin", "none"],
                        "description": (
                            "The health-benefit area this slide is about, if any — places the matching "
                            "brand icon. Use only when the summary's topic clearly matches one of these; "
                            "otherwise 'none'. (Only these 5 icons exist.)"
                        ),
                    },
                    "notes": {
                        "type": "string",
                        "description": (
                            "Speaker notes: the FULL supporting detail behind this slide's claim — "
                            "effect sizes, confidence intervals, p-values, dose, sample size, study "
                            "design, citation. Verbatim-ish from the summary; never invented. Keeps "
                            "the science traceable for review while the slide stays clean. Empty for "
                            "pure cover / divider / closing slides."
                        ),
                    },
                },
                "required": ["layout", "fields"],
            },
        },
    },
    "required": ["deck_title", "slides"],
}


SYSTEM_PROMPT = """You turn a verified Superba Krill science summary into a plan for a branded SALES & MARKETING slide deck. Each slide picks one on-brand layout and fills its fields. You output ONLY via the emit_deck_plan tool (forced JSON). You never write free text.

WHAT THIS DECK IS
- A sales/marketing asset for Superba Krill by Aker BioMarine: premium krill oil, marine phospholipid omega-3s (EPA/DHA), choline, astaxanthin.
- The buyer sees BENEFITS first; the studies are PROOF POINTS, not the main text.
- Tone: confident, science-led, clean. No hype, no superlatives the summary does not support. "Benefit backed by proof" is the register.

TRANSFORMATION — clinical evidence into sales slides (the core job)
- Lead each slide with the BENEFIT or CLAIM as the headline, not a study's methods.
- On-slide text is short. Compress statistics into tight proof chips (badges/stats), e.g. "235 adults", "6-month RCT", "Am J Clin Nutr".
- Move the FULL statistical detail (effect sizes, confidence intervals, p-values, dose, sample size, study design, citation) into that slide's `notes`. Never put a raw methods paragraph on the slide face.
- A null/negative result stays in the deck honestly, framed for a sales audience (an open question the ongoing trial addresses); its full detail still goes in `notes`.

HARD WORDING CONSTRAINTS (non-negotiable — these override any sales instinct)
1. Every claim must trace to the input summary. Distilling and reframing is allowed; inventing is not.
2. Null and negative results are carried through honestly, never dropped.
3. EFSA-approved claims: only state as approved when the summary explicitly says so (in the Superba portfolio only Heart and Liver carry EFSA-approved claims). Never imply approval otherwise.
4. Citations are verbatim-ish from the summary (author, journal, year) if provided. If none, add none. NEVER invent a citation, journal, or year.
5. Trial counts come from the summary. If not stated, do not state one.

HOW TO PLAN
- You are given a LAYOUT CATALOG: each layout, its master (light/dark), what it is for, and its field names. Pick the layout whose shape fits each message — do not force content into a layout.
- Fill ONLY the fields listed for the chosen layout, by their exact names (without braces). Leave a field out (or empty) when unused — e.g. fewer than 5 bullets, fewer than 3 stats.
- Keep each field within the capacity described in the catalog. Long detail goes in `notes`, not on the slide.
- Structure a coherent sales story: open with `cover`; use `section` dividers between themes; use `content` / `stat` / `evidence` / `two_col` for the body; close with `ending` (call to action + any disclaimer). Alternate light/dark for rhythm. Aim for 7-11 slides.
- Set `benefit` on a slide when its topic clearly matches a health-benefit area with an icon (heart / joint / liver / muscle / skin) — this places the brand icon. Use it on the section divider and key evidence slides for that benefit; otherwise 'none'. Do not force an icon that doesn't match the summary.

You will receive the science summary and the layout catalog. Emit the deck plan now."""
