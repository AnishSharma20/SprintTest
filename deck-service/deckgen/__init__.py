"""Superba deck generator — fresh, on-brand sales decks from a science summary.

Claude plans the deck (benefit-first, science as proof); a python-pptx renderer draws
each slide with brand-styled, auto-fitting text frames, producing a native, editable
.pptx plus a Science-review wording document.

    from deckgen import generate_deck, DeckResult
"""
from __future__ import annotations

from dataclasses import dataclass

import anthropic

from .config import DEFAULT_LENGTH, DEFAULT_TONE
from .layouts import catalog
from .planner import build_plan
from .render import render_pptx, wording_document

__all__ = ["generate_deck", "DeckResult"]


@dataclass
class DeckResult:
    pptx: bytes           # the finished, natively-editable .pptx
    filename: str         # suggested download name, e.g. "krill_oil.pptx"
    wording_md: str       # Science-review wording document (claims + evidence)
    slide_count: int


def generate_deck(
    client: anthropic.Anthropic, summary_text: str, base_name: str,
    *, length: str = DEFAULT_LENGTH, tone: str = DEFAULT_TONE,
) -> DeckResult:
    """Generate one deck from one science summary (in-memory; no temp files).

    length: 'kort' | 'standard' | 'detaljert'  — target slide count.
    tone:   'salg' | 'balansert' | 'vitenskap' — how much evidence sits on-slide.
    """
    plan = build_plan(client, summary_text, catalog(), length=length, tone=tone)
    return DeckResult(
        pptx=render_pptx(plan),
        filename=f"{base_name}.pptx",
        wording_md=wording_document(plan),
        slide_count=len(plan["slides"]),
    )
