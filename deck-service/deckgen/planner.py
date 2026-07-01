"""Plan the deck: one Claude call that picks layouts and fills their fields."""
from __future__ import annotations

import anthropic

from .config import MAX_PLAN_ATTEMPTS, MAX_TOKENS, MODEL
from .layouts import LAYOUTS
from .prompts import PLAN_SCHEMA, SYSTEM_PROMPT


def _emit(client: anthropic.Anthropic, summary: str, catalog: str) -> dict:
    msg = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        tools=[{"name": "emit_deck_plan", "description": "Emit the deck plan.", "input_schema": PLAN_SCHEMA}],
        tool_choice={"type": "tool", "name": "emit_deck_plan"},
        messages=[{"role": "user", "content": f"SCIENCE SUMMARY:\n{summary}\n\nLAYOUT CATALOG:\n{catalog}"}],
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
        clean.append({"layout": layout, "fields": fields, "notes": slide.get("notes", "")})
    plan["slides"] = clean
    return plan


def build_plan(client: anthropic.Anthropic, summary: str, catalog: str) -> dict:
    last = None
    for _ in range(MAX_PLAN_ATTEMPTS):
        plan = _sanitize(_emit(client, summary, catalog))
        if plan["slides"]:
            return plan
        last = plan
    raise ValueError("Planner produced no usable slides.")
