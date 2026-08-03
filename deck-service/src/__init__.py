"""Superba deck generator — two-stage pipeline.

Stage 1 (planner.py): free text -> schema-validated JSON slide plan (Claude).
Stage 2 (renderer.py): JSON plan -> python-pptx fills the real Superba template.

The LLM never touches styling/colour/font/position — it only chooses a layout from a
fixed enum, writes text within character limits, and picks assets by id. All design is
inherited from the template's slide layouts.
"""
from __future__ import annotations

__all__ = ["generate", "generate_blog", "generate_whitepaper", "generate_whitepaper_idml",
           "generate_whitepaper_composed", "idml_page_library", "markdown_to_docx"]


def generate(*args, **kwargs):
    """Lazy entrypoint — imports the pipeline on first use so importing submodules
    (e.g. src.planner) doesn't require the whole renderer stack to be present."""
    from .pipeline import generate as _generate
    return _generate(*args, **kwargs)


def generate_blog(*args, **kwargs):
    """Lazy entrypoint for the blog-draft generator."""
    from .blog import generate_blog as _generate_blog
    return _generate_blog(*args, **kwargs)


def generate_whitepaper(*args, **kwargs):
    """Lazy entrypoint for the whitepaper generator (Markdown/Word draft)."""
    from .whitepaper import generate_whitepaper as _generate_whitepaper
    return _generate_whitepaper(*args, **kwargs)


def generate_whitepaper_idml(*args, **kwargs):
    """Lazy entrypoint for the InDesign (.idml) whitepaper generator."""
    from .whitepaper import generate_whitepaper_idml as _generate_whitepaper_idml
    return _generate_whitepaper_idml(*args, **kwargs)


def generate_whitepaper_composed(*args, **kwargs):
    """Lazy entrypoint — InDesign whitepaper assembled from pages across several brochures."""
    from .whitepaper import generate_whitepaper_composed as _generate_whitepaper_composed
    return _generate_whitepaper_composed(*args, **kwargs)


def idml_page_library():
    """The page library summary the UI needs for its manual page override."""
    from .idml_library import library_summary
    return library_summary()


def markdown_to_docx(*args, **kwargs):
    """Lazy entrypoint — convert a Markdown blog draft to a Word (.docx) byte string."""
    from .blog import markdown_to_docx as _markdown_to_docx
    return _markdown_to_docx(*args, **kwargs)
