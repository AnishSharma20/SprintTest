"""Superba hybrid SVG deck pipeline (AKBM-native).

    from svcgen import generate
    result = generate(client, summary_text, base_name, length="standard", tone="balansert")
    # result = {"pptx": bytes, "filename": str, "wording_md": str, "slide_count": int}
"""
from __future__ import annotations

from .pipeline import generate

__all__ = ["generate"]
