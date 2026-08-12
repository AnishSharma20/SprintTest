"""Check a finished plan against the team's STANDING RULES, so a rule is verified rather than
merely requested.

The rules the team types on the About page reach the planner as a prompt block, and a prompt is a
request: the model usually follows it, and nobody ever looked. That put every rule in the weakest
of the three tiers this system actually has —

  enforced  the code does it and the model cannot get it wrong (fonts, colours, what is
            switched off, character limits)
  checked   the model does it, then the output is inspected and the model is made to fix what it
            missed (photo coverage, layout variety, speaker notes, summary length)
  asked     the model is told once and nothing verifies it

— and rules are exactly the kind of instruction that cannot be enforced mechanically ("bullets are
one sentence each", "always compare against fish oil where the source allows it") but CAN be
checked by reading the finished plan. This module is that check: one call over the plan's text,
returning concrete fix instructions tagged `RULES:` that ride the planner's existing revision
path (see planner.revise_plan's RULES bucket and pipeline.generate).

Deliberately conservative. It reports a violation only when the plan plainly breaks a rule, and it
never raises: no rules, no model, a malformed answer or any error at all yields [] and the deck
ships exactly as it would have before.
"""
from __future__ import annotations

import json
import sys

from . import config

GATE_MODEL = config.MODEL

# Fields worth showing the reviewer: everything reader-facing, per slide. Deliberately excludes
# ids/enums (layout, asset_id, icon) — a rule is about what the deck SAYS.
_TEXT_KEYS = ("title", "subtitle", "banner", "body", "eyebrow", "caption", "quote", "takeaway",
              "heading", "note", "tagline", "contact", "source", "key_finding",
              "supporting_findings", "relevance", "contents", "speaker_notes")
_LIST_KEYS = ("items", "columns", "points", "stats", "metrics", "quadrants", "stages", "phases",
              "criteria", "bubbles", "takeaways", "rows", "headers", "slots")

_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["findings"],
    "properties": {"findings": {"type": "array", "items": {
        "type": "object", "additionalProperties": False, "required": ["rule", "fix"],
        "properties": {
            "rule": {"type": "string", "maxLength": 200,
                     "description": "The team rule being broken, quoted or closely paraphrased."},
            "slides": {"type": "array", "items": {"type": "integer"},
                       "description": "1-based numbers of the slides that break it."},
            "fix": {"type": "string", "maxLength": 300,
                    "description": "One concrete instruction that makes those slides comply, "
                                   "naming what to change. No general advice."},
        }}}},
}

_SYSTEM = """You check a draft presentation against a team's own standing rules for their decks.

You are given the team's rules and the deck's full text, slide by slide. Report ONLY clear,
concrete breaches of those specific rules.

Rules for your judgement:
- Judge against the TEAM'S rules only. Never report your own preferences about structure, tone,
  persuasiveness or slide count, and never report anything no rule mentions.
- Report a breach only when the text plainly breaks the rule. If a rule is vague, or following it
  depends on source material you cannot see, leave it alone.
- A rule the deck cannot honour because the source lacks the material is NOT a breach.
- Group each rule into ONE finding listing every slide that breaks it, rather than repeating the
  same rule per slide.
- Every `fix` must be a specific, applicable instruction (which slides, what to change). Never
  "follow the rules" or "improve the writing".
- A compliant deck returns an empty findings list. That is the expected, common outcome."""


def _plan_text(plan: dict) -> str:
    """The deck as the reviewer sees it: numbered slides, reader-facing text only."""
    def walk(value) -> list[str]:
        if isinstance(value, str):
            return [value.strip()] if value.strip() else []
        if isinstance(value, list):
            return [ln for v in value for ln in walk(v)]
        if isinstance(value, dict):
            out = []
            for k, v in value.items():
                if k in _TEXT_KEYS or k in _LIST_KEYS:
                    out.extend(walk(v))
                elif isinstance(v, str) and k not in ("layout", "background", "asset_id", "icon",
                                                      "icon_generic", "benefit", "chart_type"):
                    out.extend(walk(v))
            return out
        return []

    lines = [f"DECK TITLE: {plan.get('deck_title', '')}"]
    for i, s in enumerate(plan.get("slides", []), 1):
        parts = [f"## Slide {i} ({s.get('layout', '?')})"]
        for key in _TEXT_KEYS:
            if isinstance(s.get(key), str) and s[key].strip():
                parts.append(f"{key}: {s[key].strip()}")
        for key in _LIST_KEYS:
            if s.get(key):
                got = walk(s[key])
                if got:
                    parts.append(f"{key}: " + " | ".join(got))
        lines.append("\n".join(parts))
    return "\n\n".join(lines)


def review(client, plan: dict, custom_rules: str, *, model: str | None = None) -> list[str]:
    """Findings as `RULES:`-tagged instructions for planner.revise_plan. [] when there are no
    rules, or on any failure — a rule check must never cost the user their deck."""
    rules = (custom_rules or "").strip()
    if not rules or not plan.get("slides"):
        return []
    try:
        msg = client.messages.create(
            model=model or GATE_MODEL, max_tokens=1500, system=_SYSTEM,
            tools=[{"name": "report_rule_findings",
                    "description": "Report which team rules the draft deck breaks.",
                    "input_schema": _SCHEMA}],
            tool_choice={"type": "tool", "name": "report_rule_findings"},
            messages=[{"role": "user", "content":
                       f"THE TEAM'S RULES:\n{rules}\n\nTHE DRAFT DECK:\n{_plan_text(plan)}\n\n"
                       "Report any clear breaches via report_rule_findings."}],
        )
        findings = []
        for block in msg.content:
            if block.type == "tool_use" and isinstance(block.input, dict):
                findings = block.input.get("findings") or []
                break
        out = []
        for f in findings:
            fix = str(f.get("fix") or "").strip()
            if not fix:
                continue
            rule = str(f.get("rule") or "").strip()
            slides = [n for n in (f.get("slides") or []) if isinstance(n, int)]
            where = f" (slide{'s' if len(slides) != 1 else ''} {', '.join(map(str, slides))})" if slides else ""
            out.append(f"RULES: the deck breaks the team rule \"{rule}\"{where}. {fix}")
        if out:
            print(f"[rules-gate] {len(out)} rule breach(es) found:\n- " + "\n- ".join(out),
                  file=sys.stderr)
        return out[:8]   # a long list would swamp the revision prompt
    except Exception as e:  # noqa: BLE001 — the check must never break generation
        print(f"[rules-gate] rule check skipped ({e}); shipping the deck as planned",
              file=sys.stderr)
        return []


def unmet(client, plan: dict, custom_rules: str, *, model: str | None = None) -> list[str]:
    """Same check, for AFTER the repair attempt — kept separate only for readability at the call
    site (pipeline logs what still fails rather than retrying again)."""
    return review(client, plan, custom_rules, model=model)


__all__ = ["review", "unmet", "GATE_MODEL"]


if __name__ == "__main__":  # tiny manual probe: python -m src.rules_gate '<rules>' plan.json
    if len(sys.argv) == 3:
        import anthropic
        print(json.dumps(review(anthropic.Anthropic(), json.load(open(sys.argv[2])), sys.argv[1]),
                         indent=2))
