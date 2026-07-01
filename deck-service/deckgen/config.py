"""Shared configuration for the Superba deck generator (python-pptx direct render).

Claude plans the deck; a python-pptx renderer draws each slide with brand-styled,
auto-fitting native text frames — so variable AI text never overflows, and content
lives on the slide. No SVG / svg_to_pptx step.
"""
from __future__ import annotations

from pathlib import Path

from pptx.dml.color import RGBColor

BASE = Path(__file__).resolve().parent.parent          # deck-service/

# Superba brand palette (verified hex)
GREEN = RGBColor(0x16, 0x35, 0x36)     # Deep Sea Green — primary dark bg
POLAR = RGBColor(0xE9, 0xF7, 0xF8)     # Polar Blue — primary light bg
SEA = RGBColor(0x17, 0x59, 0x69)       # Sea Blue
REGAL = RGBColor(0x00, 0x34, 0x62)     # Regal Blue
TURQ_D = RGBColor(0x60, 0xA0, 0x9B)    # Turquoise Dark
TURQ_L = RGBColor(0xA9, 0xDB, 0xD5)    # Turquoise Light
RED = RGBColor(0xE5, 0x0A, 0x1A)       # Superba Ruby Red — signature accent
ALT_RED = RGBColor(0xBD, 0x39, 0x3F)   # Alternate Red — only red allowed as a fill
PEACH = RGBColor(0xFF, 0xD1, 0xB0)     # Peach Orange
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

HEAD_FONT = "Exo 2"      # headings / titles / big numbers (italic bold)
BODY_FONT = "Manrope"    # body, labels, badges

# 16:9 canvas
SLIDE_W_IN = 13.333
SLIDE_H_IN = 7.5

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 8000
MAX_PLAN_ATTEMPTS = 2
