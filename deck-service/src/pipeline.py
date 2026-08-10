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
                   "speaker_notes", "heading", "banner", "quote", "author", "x_axis", "y_axis",
                   "label", "note", "date", "value",
                   "study", "design", "result", "takeaway", "tagline", "contact"}


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


def _ensure_exec_summary(plan: dict, disabled_layouts=None) -> dict:
    """Every deck opens with an executive summary right after the agenda. The planner is
    instructed to write a proper `exec_summary` slide (and the SUMMARY: nudge drives the retry);
    this is the deterministic net for when it still doesn't — built as a takeaways-style slide
    from the deck's own ACTION TITLES, which already state each slide's takeaway as a full
    sentence, so the derived summary is real content, not boilerplate. Skipped when the About
    page turned exec_summary off (the requirement travels with the layout)."""
    disabled = set(disabled_layouts or ())
    slides = plan.get("slides", [])
    if ("exec_summary" in disabled or "takeaways" in disabled or len(slides) < 4
            or any(s.get("layout") == "exec_summary" for s in slides)):
        return plan
    skip = {"title", "agenda", "section", "highlight", "title_only", "closing", "ingredient"}
    items, seen = [], set()
    for s in slides:
        layout = s.get("layout") or ""
        t = (s.get("title") or "").strip()
        if layout in skip or layout.startswith("custom_") or not t:
            continue
        if t.lower() in seen:
            continue
        seen.add(t.lower())
        items.append({"heading": t[:90].rstrip()})
        if len(items) >= 5:
            break
    if len(items) < 2:
        return plan
    summary = {"layout": "takeaways", "title": "Executive summary", "items": items,
               "speaker_notes": " ".join(i["heading"] for i in items)}
    # Directly after the agenda (or the cover, or at the very front — whichever exists).
    at = 0
    for i, s in enumerate(slides[:3]):
        if s.get("layout") in ("title", "agenda"):
            at = i + 1
    return {**plan, "slides": slides[:at] + [summary] + slides[at:]}


# Plan fields whose values are (or contain) reader-facing prose worth echoing into a derived
# speaker note, in the order a presenter would read the slide.
_NOTE_FIELDS = ("subtitle", "banner", "body", "caption", "items", "columns", "points", "stats",
                "metrics", "quadrants", "stages", "phases", "criteria", "bubbles", "before",
                "after", "center", "total", "tagline", "contact")


def _note_lines(value) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        return [ln for v in value for ln in _note_lines(v)]
    if isinstance(value, dict):
        parts = [str(value[k]).strip() for k in ("date", "heading", "name", "role", "value",
                                                 "label", "body", "note", "implication", "bio")
                 if str(value.get(k) or "").strip()]
        return [": ".join(parts[:2]) + (". " + ". ".join(parts[2:]) if parts[2:] else "")] if parts else []
    return []


def _ensure_notes(plan: dict) -> dict:
    """Deterministic backstop for the every-slide speaker-notes requirement: any generated slide
    still missing `speaker_notes` after the planner's retry gets a note composed from the slide's
    own text (takeaway title, content in reading order, citations) — same language as the slide,
    no boilerplate. Verbatim slides (ingredient / team slides) are exempt by contract."""
    slides = []
    for s in plan.get("slides", []):
        layout = s.get("layout") or ""
        if (layout == "ingredient" or layout.startswith("custom_")
                or (s.get("speaker_notes") or "").strip()):
            slides.append(s)
            continue
        lines = _note_lines(s.get("title")) + [ln for f in _NOTE_FIELDS for ln in _note_lines(s.get(f))]
        if s.get("source_citations"):
            lines.append("; ".join(s["source_citations"]))
        note = "\n".join(lines).strip()[:1400]
        slides.append({**s, "speaker_notes": note} if note else s)
    return {**plan, "slides": slides}


def _strip_dashes_plan(plan: dict) -> dict:
    """Deterministic no-dash safety net over a validated plan, mutating only human-readable text."""
    def walk(obj, key=None):
        if isinstance(obj, str):
            return _strip_text(obj) if key in _DASH_TEXT_KEYS else obj
        if isinstance(obj, list):
            if key in ("items", "headers", "cells"):  # lists of plain strings
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


def _visual_gate(client, summary_text, plan, pptx, length, tone, _p, instructions="", study_meta=None,
                 custom_rules="", disabled_layouts=None, design=None, custom_slides=None,
                 custom_photos=None, preferred_layouts=None):
    """Polished mode: render → look at the slides → fix flagged ones → re-render. Bounded to
    DECK_QA_ROUNDS passes (default 1). No-op if no rasteriser is available. Never fails the deck —
    a gate error or a revision that breaks validation keeps the pre-gate deck."""
    extra = [c["key"] for c in planner.auto_custom_slides(custom_slides)]
    photo_ids = planner.custom_photo_ids(custom_photos)
    photo_level = (design or {}).get("photo_level", "default")
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
                                               length=length, tone=tone, instructions=instructions,
                                               custom_rules=custom_rules,
                                               disabled_layouts=disabled_layouts,
                                               custom_slides=custom_slides,
                                               custom_photos=custom_photos,
                                               preferred_layouts=preferred_layouts, design=design)
        # A visual fix can slip on a detail (e.g. an invalid icon enum); give it one schema-repair
        # pass rather than discarding all the good fixes over a single slip.
        errs = validate.validate_plan(candidate, extra_layouts=extra,
                                      extra_photo_ids=photo_ids, photo_level=photo_level,
                                      disabled_layouts=disabled_layouts)
        if errs:
            candidate = planner.revise_plan(client, summary_text, candidate, errs,
                                            length=length, tone=tone, instructions=instructions,
                                            custom_rules=custom_rules,
                                            disabled_layouts=disabled_layouts,
                                            custom_slides=custom_slides,
                                            custom_photos=custom_photos,
                                            preferred_layouts=preferred_layouts, design=design)
            errs = validate.validate_plan(candidate, extra_layouts=extra,
                                          extra_photo_ids=photo_ids, photo_level=photo_level,
                                          disabled_layouts=disabled_layouts)
        # Same soft-error tags as generate()'s split below — validate_plan() always appends
        # VARIETY:/PHOTOS:/TEXT: nudges now, and this second, separate hard/soft split had
        # fallen out of sync with that (missing the exemption), so a visual fix on an otherwise
        # fine deck would get discarded here for a nudge it was never asked to address.
        soft = ("shorten it by at least", "VARIETY:", "PHOTOS:", "TEXT:", "NOTES:", "SUMMARY:")
        hard = [e for e in errs if not any(s in e for s in soft)]
        if hard:
            print("[qa-gate] revision still invalid after repair; keeping pre-gate deck:\n- "
                  + "\n- ".join(hard), file=sys.stderr)
            break
        candidate = _ensure_notes(candidate)
        candidate = _strip_dashes_plan(candidate)
        plan, pptx = candidate, renderer.render_deck(candidate, study_meta=study_meta,
                                                     design=design, custom_slides=custom_slides,
                                                     custom_photos=custom_photos)
    return pptx, plan


def generate(client: anthropic.Anthropic, summary_text: str, base_name: str, *,
             length: str = "standard", tone: str = "balansert", quality: str = "fast",
             instructions: str = "", on_progress=None,
             study_meta: list[dict] | None = None,
             custom_rules: str = "", disabled_layouts: list[str] | None = None,
             design: dict | None = None,
             custom_slides: list[dict] | None = None,
             custom_photos: list[dict] | None = None,
             preferred_layouts: list[str] | None = None) -> dict:
    """design / custom_slides / custom_photos / preferred_layouts: the About page's levers —
    deterministic design overrides, the team's verbatim slides ({key, name, description, mode,
    bytes, index, png} each), the team's photo library ({key, name, description, bytes} each)
    and the starred house-favourite layouts — see renderer/planner."""
    def _p(pct, step):
        if on_progress:
            try:
                on_progress(pct, step)
            except Exception:  # noqa: BLE001 — progress must never break generation
                pass

    extra = [c["key"] for c in planner.auto_custom_slides(custom_slides)]
    photo_ids = planner.custom_photo_ids(custom_photos)
    photo_level = (design or {}).get("photo_level", "default")

    _p(5, "Planning the deck")
    plan = planner.plan_deck(client, summary_text, length=length, tone=tone, instructions=instructions,
                             custom_rules=custom_rules, disabled_layouts=disabled_layouts,
                             custom_slides=custom_slides, custom_photos=custom_photos,
                             preferred_layouts=preferred_layouts, design=design)

    errors = validate.validate_plan(plan, extra_layouts=extra, extra_photo_ids=photo_ids,
                                    photo_level=photo_level, disabled_layouts=disabled_layouts)
    if errors:
        _p(40, "Refining copy to fit")
        plan = planner.revise_plan(client, summary_text, plan, errors, length=length, tone=tone,
                                   instructions=instructions, custom_rules=custom_rules,
                                   disabled_layouts=disabled_layouts, custom_slides=custom_slides,
                                   custom_photos=custom_photos,
                                   preferred_layouts=preferred_layouts, design=design)
        errors = validate.validate_plan(plan, extra_layouts=extra, extra_photo_ids=photo_ids,
                                        photo_level=photo_level, disabled_layouts=disabled_layouts)
        if errors:
            # Split structural violations (broken plan -> fail loudly) from residual length
            # overages and the VARIETY:/PHOTOS: coverage nudges. Title/heading/body placeholders
            # auto-fit, so a few chars over is cosmetically absorbed at render, and a deck that
            # still under-uses layouts/photos after one revision is still a valid deck — don't
            # deny a non-technical user their deck over either.
            soft = ("shorten it by at least", "VARIETY:", "PHOTOS:", "TEXT:", "NOTES:", "SUMMARY:")
            hard = [e for e in errors if not any(s in e for s in soft)]
            if hard:
                raise ValueError("Plan failed validation after one retry:\n- " + "\n- ".join(hard))
            print("[warn] minor overflows/coverage nudges remain after retry; shipping anyway:\n- "
                  + "\n- ".join(errors), file=sys.stderr)

    _p(70, "Rendering slides on the Superba template")
    plan = _ensure_agenda(plan)                             # guarantee a contents/agenda slide
    plan = _ensure_exec_summary(plan, disabled_layouts)     # guarantee an executive summary
    plan = _ensure_notes(plan)                              # guarantee speaker notes on every slide
    plan = _strip_dashes_plan(plan)  # enforce the no-dash brand rule deterministically
    pptx = renderer.render_deck(plan, study_meta=study_meta, design=design,
                                custom_slides=custom_slides, custom_photos=custom_photos)

    # Polished mode adds a visual QA pass (render → vision-check → fix flagged slides). Fast mode
    # (default) ships the first render — the schema + renderer already guarantee it's well-formed.
    if quality == "polished" or os.environ.get("DECK_QA_GATE"):
        pptx, plan = _visual_gate(client, summary_text, plan, pptx, length, tone, _p, instructions,
                                  study_meta=study_meta, custom_rules=custom_rules,
                                  disabled_layouts=disabled_layouts, design=design,
                                  custom_slides=custom_slides, custom_photos=custom_photos,
                                  preferred_layouts=preferred_layouts)

    _p(99, "Finalizing")
    return {"pptx": pptx, "filename": f"{base_name}.pptx", "plan": plan,
            "wording_md": _wording(plan), "slide_count": len(plan["slides"])}
