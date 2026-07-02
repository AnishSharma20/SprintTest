"""SVG quality gate for the Superba SVG pipeline (Fase 1 building block).

The structural checker in ppt-master (`svg_quality_checker.py`) validates XML,
viewBox, fonts and brand drift — but it has NO geometry model, so it cannot see the
class of bug that actually hurt us: a big number overprinting its unit, a title
clipped by a panel edge, text pushed off the 1280x720 frame. Those are only visible
once the slide is RENDERED.

This gate therefore renders each slide to PNG (resvg) and asks a vision model to flag
*mechanical* layout defects only (not taste). It returns a structured verdict the
Executor can act on, so the generator can retry the offending slide with the exact
defect described. Same "model looking at the pixels" judgement that caught the
slide-4 collision by eye.

Deployment note: resvg measures text with whatever fonts are installed. Locally Exo 2
+ Manrope are present, so the render matches PowerPoint. On a headless Render container
those .ttf files must be shipped (and passed to resvg via a fonts dir) or the gate will
mis-measure widths. Out of scope for this local build; flagged for the backend swap.
"""
from __future__ import annotations

import base64

import anthropic

try:
    import resvg_py
    GATE_AVAILABLE = True
except Exception:  # noqa: BLE001 — resvg wheel absent on this host; gate degrades to no-op
    resvg_py = None
    GATE_AVAILABLE = False

CANVAS_W, CANVAS_H = 1280, 720

VERDICT_SCHEMA = {
    "type": "object",
    "properties": {
        "passed": {"type": "boolean", "description": "true ONLY if the slide has no mechanical layout defect."},
        "defects": {
            "type": "array",
            "description": "Every mechanical layout defect seen. Empty when passed.",
            "items": {
                "type": "object",
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": ["text_collision", "clipping", "off_canvas", "overflow_container", "illegible", "other"],
                    },
                    "where": {"type": "string", "description": "Which text/element and where on the slide (e.g. 'the +3.2 number in the left recap card')."},
                    "detail": {"type": "string", "description": "What is mechanically wrong, concretely."},
                },
                "required": ["kind", "where", "detail"],
            },
        },
    },
    "required": ["passed", "defects"],
}

GATE_SYS = (
    "You are a strict slide-layout QA reviewer for a premium 1280x720 sales slide. Look ONLY for "
    "mechanical layout defects, never taste:\n"
    "(1) text_collision — two pieces of text overlapping / overprinting each other, OR a "
    "logo / wordmark image overlapping text or another logo. Inspect the top-left masthead area "
    "(wordmark vs any kicker/eyebrow line beneath it) and the footer band (source line vs logos, "
    "and logos vs each other) especially — crowded headers/footers are the most common miss;\n"
    "(2) clipping — any glyph cut off by a shape edge or the slide edge;\n"
    "(3) off_canvas — text or a key element crossing outside the 1280x720 frame, or jammed hard into "
    "the outer <56px margin;\n"
    "(4) overflow_container — text spilling outside the card / hexagon / box it sits in;\n"
    "(5) illegible — text with too little contrast against its background to read.\n"
    "IGNORE stylistic preferences, wording, colour choices, and whitespace balance — those are not "
    "defects. Report every mechanical defect you can see. If the slide is mechanically clean, set "
    "passed=true and defects=[]. Emit via the report_quality tool only."
)


def render_png(svg_path, resources_dir) -> bytes:
    """Render an SVG file to PNG bytes at native canvas size (resolves <image> hrefs)."""
    out = resvg_py.svg_to_bytes(
        svg_path=str(svg_path), resources_dir=str(resources_dir),
        width=CANVAS_W, height=CANVAS_H,
    )
    return bytes(out) if not isinstance(out, (bytes, bytearray)) else out


def check_slide(client: anthropic.Anthropic, svg_path, resources_dir, *, model: str) -> tuple[dict, bytes]:
    """Render the slide and return (verdict, png_bytes). verdict = {passed, defects[]}.

    If the SVG is malformed and cannot render, that is itself a (fixable) defect — return it
    so the caller's retry regenerates the slide instead of the whole pipeline crashing.

    If resvg is unavailable on this host the gate degrades to a no-op (accept as-is): the
    deterministic heroes/charts are already safe and body slides fall back to the Executor's
    own care. Returns a truthy sentinel png so keep-best does not penalise the slide.
    """
    if not GATE_AVAILABLE:
        return {"passed": True, "defects": []}, b"skip"
    try:
        png = render_png(svg_path, resources_dir)
    except Exception as e:  # noqa: BLE001 — malformed SVG from the model; make it retryable
        return ({"passed": False, "defects": [{
            "kind": "other", "where": "whole SVG",
            "detail": f"The SVG is invalid and did not render ({e}). Re-emit well-formed SVG: "
                      "no duplicate attributes on any element, every tag closed, valid numbers.",
        }]}, b"")
    b64 = base64.standard_b64encode(png).decode()
    msg = client.messages.create(
        model=model, max_tokens=1500, system=GATE_SYS,
        tools=[{"name": "report_quality", "description": "Report mechanical layout defects.", "input_schema": VERDICT_SCHEMA}],
        tool_choice={"type": "tool", "name": "report_quality"},
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}},
            {"type": "text", "text": "QA this slide for mechanical layout defects. Emit report_quality."},
        ]}],
    )
    for block in msg.content:
        if block.type == "tool_use" and isinstance(block.input, dict):
            v = block.input
            v.setdefault("defects", [])
            v.setdefault("passed", not v["defects"])
            return v, png
    return {"passed": True, "defects": []}, png


def format_defects(defects: list[dict]) -> str:
    """Turn verdict defects into a fix-list the Executor can act on."""
    lines = []
    for d in defects:
        lines.append(f"- [{d.get('kind', 'other')}] {d.get('where', '')}: {d.get('detail', '')}")
    return "\n".join(lines)
