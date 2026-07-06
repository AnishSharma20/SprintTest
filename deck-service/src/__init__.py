"""Superba deck generator — two-stage pipeline.

Stage 1 (planner.py): free text -> schema-validated JSON slide plan (Claude).
Stage 2 (renderer.py): JSON plan -> python-pptx fills the real Superba template.

The LLM never touches styling/colour/font/position — it only chooses a layout from a
fixed enum, writes text within character limits, and picks assets by id. All design is
inherited from the template's slide layouts.
"""
from __future__ import annotations

__all__ = ["generate", "generate_blog"]


def generate(*args, **kwargs):
    """Lazy entrypoint — imports the pipeline on first use so importing submodules
    (e.g. src.planner) doesn't require the whole renderer stack to be present."""
    from .pipeline import generate as _generate
    return _generate(*args, **kwargs)


def generate_blog(*args, **kwargs):
    """Lazy entrypoint for the blog-draft generator."""
    from .blog import generate_blog as _generate_blog
    return _generate_blog(*args, **kwargs)
