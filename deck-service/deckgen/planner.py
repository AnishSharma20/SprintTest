"""Plan the deck: one Claude call that picks layouts and fills their fields."""
from __future__ import annotations

import anthropic

from .config import (
    DEFAULT_LENGTH, DEFAULT_TONE, MAX_PLAN_ATTEMPTS, MAX_TOKENS, MODEL,
    resolve_length, resolve_tone,
)
from .layouts import LAYOUTS
from .prompts import PLAN_SCHEMA, SYSTEM_PROMPT


def _emit(client: anthropic.Anthropic, summary: str, catalog: str, brief: str) -> dict:
    msg = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        tools=[{"name": "emit_deck_plan", "description": "Emit the deck plan.", "input_schema": PLAN_SCHEMA}],
        tool_choice={"type": "tool", "name": "emit_deck_plan"},
        messages=[{"role": "user", "content": f"SCIENCE SUMMARY:\n{summary}\n\nLAYOUT CATALOG:\n{catalog}\n\n{brief}"}],
    )
    for block in msg.content:
        if block.type == "tool_use" and isinstance(block.input, dict):
            plan = block.input
            if isinstance(plan.get("slides"), list) and plan["slides"]:
                return plan
    if msg.stop_reason == "max_tokens":
        raise ValueError("Plan was truncated (hit max_tokens); raise MAX_TOKENS.")
    raise ValueError("Claude returned an invalid deck plan.")


def _sanitize(plan: dict) -> dict:
    """Drop unknown layouts and field keys that don't belong to the chosen layout,
    so the renderer only ever fills real placeholders."""
    clean = []
    for slide in plan.get("slides", []):
        layout = slide.get("layout")
        if layout not in LAYOUTS:
            continue
        allowed = set(LAYOUTS[layout]["fields"])
        fields = {k: v for k, v in (slide.get("fields") or {}).items() if k in allowed}
        clean.append({
            "layout": layout, "fields": fields,
            "benefit": slide.get("benefit", "none"), "notes": slide.get("notes", ""),
        })
    plan["slides"] = clean
    return plan


def build_plan(
    client: anthropic.Anthropic, summary: str, catalog: str,
    *, length: str = DEFAULT_LENGTH, tone: str = DEFAULT_TONE,
) -> dict:
    brief = (
        f"BRIEF FOR THIS DECK:\n- Target about {resolve_length(length)} slides.\n"
        f"- Tone: {resolve_tone(tone)}"
    )
    for _ in range(MAX_PLAN_ATTEMPTS):
        plan = _sanitize(_emit(client, summary, catalog, brief))
        if plan["slides"]:
            return plan
    raise ValueError("Planner produced no usable slides.")
