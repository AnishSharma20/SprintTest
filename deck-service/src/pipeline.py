"""Orchestrator — the drop-in `generate()` the FastAPI service calls.

plan (Claude) -> validate -> one self-correction retry on failure -> render (python-pptx).
Fast: the slow per-slide vision-gate/retry loop of the old pipeline is gone — cost/latency
is now just 1-2 planner calls plus deterministic rendering.
"""
from __future__ import annotations

import os
import re
import sys

import anthropic

from . import planner, qa_gate, renderer, validate

# Reader-facing text fields in a plan (the no-dash brand rule applies to these). Enum/id fields
# (layout, benefit, icon, icon_generic, asset_id, background, language) and `source_citations`
# (may contain DOIs/identifiers) are deliberately left untouched.
_DASH_TEXT_KEYS = {"deck_title", "title", "subtitle", "body", "eyebrow", "caption",
                   "speaker_notes", "heading"}


def _strip_text(s: str) -> str:
    s = re.sub(r"\s*[—–]\s*", ", ", s)        # em/en dash -> comma
    return re.sub(r"(?<=\w)-(?=\w)", " ", s)  # inter-word/number hyphen -> space (Omega-3 -> Omega 3)


def _ensure_agenda(plan: dict) -> dict:
    """Every deck must have an agenda slide (contents), on the picture-bearing 'agenda' layout with
    branded bullets. The planner is instructed to write one; this is the safety net for when it
    doesn't — it derives a contents list from the deck's section dividers (or slide titles)."""
    slides = plan.get("slides", [])
    if any(s.get("layout") == "agenda" for s in slides):
        return plan
    titles = [s.get("title", "").strip() for s in slides
              if s.get("layout") == "section" and s.get("title", "").strip()]
    if len(titles) < 2:
        titles = [s.get("title", "").strip() for s in slides
                  if s.get("layout") not in ("title", "agenda", "ingredient")
                  and s.get("title", "").strip()]
    items, seen = [], set()
    for t in titles:
        t = t[:26].rstrip()
        if t.lower() in seen:
            continue
        seen.add(t.lower())
        items.append(t)
        if len(items) >= 7:
            break
    if len(items) < 2:
        return plan  # nothing sensible to list — leave the deck as-is
    agenda = {"layout": "agenda", "title": "Agenda", "items": items}
    at = 1 if slides and slides[0].get("layout") == "title" else 0
    return {**plan, "slides": slides[:at] + [agenda] + slides[at:]}


def _strip_dashes_plan(plan: dict) -> dict:
    """Deterministic no-dash safety net over a validated plan, mutating only human-readable text."""
    def walk(obj, key=None):
        if isinstance(obj, str):
            return _strip_text(obj) if key in _DASH_TEXT_KEYS else obj
        if isinstance(obj, list):
            if key == "items":  # list of body strings
                return [_strip_text(x) if isinstance(x, str) else walk(x) for x in obj]
            return [walk(x) for x in obj]
        if isinstance(obj, dict):
            return {k: walk(v, k) for k, v in obj.items()}
        return obj
    return walk(plan)


def _wording(plan: dict) -> str:
    lines = [f"# {plan.get('deck_title', 'Superba deck')} — wording review", "",
             f"_Language: {plan.get('language', '?')} · {len(plan.get('slides', []))} slides._", ""]
    for i, s in enumerate(plan.get("slides", []), 1):
        lines.append(f"## Slide {i}: {s.get('title') or s.get('layout')}")
        lines.append(f"*layout: {s['layout']}*  ")
        if s.get("subtitle"):
            lines.append(s["subtitle"])
        if s.get("body"):
            lines.append(s["body"])
        for it in s.get("items", []):
            lines.append(f"- {it}")
        for c in s.get("columns", []):
            lines.append(f"- **{c.get('heading', '')}** — {c.get('body', '')}")
        if s.get("speaker_notes"):
            lines += ["", f"**Notes:** {s['speaker_notes']}"]
        if s.get("source_citations"):
            lines += ["", "**Sources:** " + "; ".join(s["source_citations"])]
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def _visual_gate(client, summary_text, plan, pptx, length, tone, _p, instructions=""):
    """Polished mode: render → look at the slides → fix flagged ones → re-render. Bounded to
    DECK_QA_ROUNDS passes (default 1). No-op if no rasteriser is available. Never fails the deck —
    a gate error or a revision that breaks validation keeps the pre-gate deck."""
    rounds = max(1, int(os.environ.get("DECK_QA_ROUNDS", "1")))
    for _ in range(rounds):
        _p(80, "Reviewing the rendered slides")
        images = qa_gate.rasterize(pptx)
        if not images:
            print("[qa-gate] no rasteriser available (install LibreOffice); skipping visual QA",
                  file=sys.stderr)
            break
        flags = qa_gate.flagged(qa_gate.review(client, images, plan))
        if not flags:
            break
        _p(90, f"Polishing {len(flags)} flagged slide(s)")
        candidate = planner.revise_plan_visual(client, summary_text, plan, flags,
                                               length=length, tone=tone, instructions=instructions)
        # A visual fix can slip on a detail (e.g. an invalid icon enum); give it one schema-repair
        # pass rather than discarding all the good fixes over a single slip.
        errs = validate.validate_plan(candidate)
        if errs:
            candidate = planner.revise_plan(client, summary_text, candidate, errs,
                                            length=length, tone=tone, instructions=instructions)
            errs = validate.validate_plan(candidate)
        hard = [e for e in errs if "shorten it by at least" not in e]
        if hard:
            print("[qa-gate] revision still invalid after repair; keeping pre-gate deck:\n- "
                  + "\n- ".join(hard), file=sys.stderr)
            break
        candidate = _strip_dashes_plan(candidate)
        plan, pptx = candidate, renderer.render_deck(candidate)
    return pptx, plan


def generate(client: anthropic.Anthropic, summary_text: str, base_name: str, *,
             length: str = "standard", tone: str = "balansert", quality: str = "fast",
             instructions: str = "", on_progress=None) -> dict:
    def _p(pct, step):
        if on_progress:
            try:
                on_progress(pct, step)
            except Exception:  # noqa: BLE001 — progress must never break generation
                pass

    _p(5, "Planning the deck")
    plan = planner.plan_deck(client, summary_text, length=length, tone=tone, instructions=instructions)

    errors = validate.validate_plan(plan)
    if errors:
        _p(40, "Refining copy to fit")
        plan = planner.revise_plan(client, summary_text, plan, errors, length=length, tone=tone,
                                   instructions=instructions)
        errors = validate.validate_plan(plan)
        if errors:
            # Split structural violations (broken plan -> fail loudly) from residual length
            # overages. Title/heading/body placeholders auto-fit, so a few chars over is
            # cosmetically absorbed at render — don't deny a non-technical user their deck.
            hard = [e for e in errors if "shorten it by at least" not in e]
            if hard:
                raise ValueError("Plan failed validation after one retry:\n- " + "\n- ".join(hard))
            print("[warn] minor text overflows remain after retry; auto-fit will absorb them:\n- "
                  + "\n- ".join(errors), file=sys.stderr)

    _p(70, "Rendering slides on the Superba template")
    plan = _ensure_agenda(plan)      # guarantee a contents/agenda slide
    plan = _strip_dashes_plan(plan)  # enforce the no-dash brand rule deterministically
    pptx = renderer.render_deck(plan)

    # Polished mode adds a visual QA pass (render → vision-check → fix flagged slides). Fast mode
    # (default) ships the first render — the schema + renderer already guarantee it's well-formed.
    if quality == "polished" or os.environ.get("DECK_QA_GATE"):
        pptx, plan = _visual_gate(client, summary_text, plan, pptx, length, tone, _p, instructions)

    _p(99, "Finalizing")
    return {"pptx": pptx, "filename": f"{base_name}.pptx", "plan": plan,
            "wording_md": _wording(plan), "slide_count": len(plan["slides"])}
