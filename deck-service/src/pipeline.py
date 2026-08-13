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

from . import brand as _brand
from . import config
from . import planner, qa_gate, qa_geometry, renderer, rules_gate, validate

# Reader-facing text fields in a plan (the no-dash brand rule applies to these). Enum/id fields
# (layout, benefit, icon, icon_generic, asset_id, background, language) and `source_citations`
# (may contain DOIs/identifiers) are deliberately left untouched.
_DASH_TEXT_KEYS = {"deck_title", "title", "subtitle", "body", "eyebrow", "caption",
                   "speaker_notes", "heading", "banner", "quote", "author", "x_axis", "y_axis",
                   "label", "note", "date", "value",
                   "study", "design", "result", "takeaway", "tagline", "contact"}


# Findings that must never fail a deck: residual length overages the placeholders absorb, the
# coverage/notes/summary nudges, and team-rule breaches the one repair pass could not resolve. ONE
# definition — the two inline copies this replaces had already drifted apart once.
_SOFT_ERRORS = ("shorten it by at least", "VARIETY:", "PHOTOS:", "TEXT:", "NOTES:", "SUMMARY:",
                "EXEC_LENGTH:", "RULES:")


def _strip_text(s: str) -> str:
    s = re.sub(r"\s*[—–]\s*", ", ", s)        # em/en dash -> comma
    return re.sub(r"(?<=\w)-(?=\w)", " ", s)  # inter-word/number hyphen -> space (Omega-3 -> Omega 3)


# ---------------------------------------------------------------------------
# Structure rules — the deck's SHAPE, edited on the About page instead of hardcoded here.
#
# A rule is {slide, action, position}: action "position" pins a slide to an exact spot, action
# "always_include" guarantees it appears at all. Only the three slides the code can COMPOSE from
# the deck's own content (cover, executive summary, agenda) can be conjured when the model omits
# one; for any other layout "always_include" is a strong instruction to the planner plus the rule
# check, because a content slide's text has to be written, not invented here.
#
# Backwards compatible on purpose: passing no rules keeps exactly the old hardcoded behaviour
# (cover first, summary second, agenda third), so an unmigrated database generates as before.
# ---------------------------------------------------------------------------
_POSITION_SLOTS = ("first", "second", "third", "last", "second_to_last")
_COMPOSABLE = ("title", "exec_summary", "agenda")
_SLIDE_ACTIONS = ("position", "always_include")
# Deck-wide guarantees that are not about one slide's place: each was hardcoded and invisible
# until now, and each is a rule the team can switch off. `speaker_notes` and `no_dashes` are also
# asked of the model in the prompt, so deleting the rule drops both the ask and the backstop.
_DECK_ACTIONS = ("speaker_notes", "no_dashes", "source_appendix")
_DEFAULT_STRUCTURE = [
    {"slide": "title", "action": "position", "position": "first"},
    {"slide": "exec_summary", "action": "position", "position": "second"},
    {"slide": "agenda", "action": "position", "position": "third"},
    {"slide": "benefits_verbatim", "action": "position", "position": "second_to_last"},
    {"slide": None, "action": "speaker_notes", "position": None},
    {"slide": None, "action": "no_dashes", "position": None},
    {"slide": None, "action": "source_appendix", "position": None},
]


def sanitize_structure(structure_rules) -> list[dict]:
    """Only well-formed rules, and never two rules fighting over the same slide or the same
    deck-wide guarantee (first wins)."""
    out, seen = [], set()
    for r in structure_rules or []:
        if not isinstance(r, dict):
            continue
        slide = str(r.get("slide") or "").strip()
        action = str(r.get("action") or "").strip()
        if action in _DECK_ACTIONS:
            if action in seen:
                continue
            seen.add(action)
            out.append({"slide": None, "action": action, "position": None})
            continue
        if not slide or slide in seen or action not in _SLIDE_ACTIONS:
            continue
        pos = str(r.get("position") or "").strip()
        if action == "position" and pos not in _POSITION_SLOTS:
            continue
        seen.add(slide)
        out.append({"slide": slide, "action": action, "position": pos or None})
    return out


# Built in writing rules the pipeline itself guarantees a moment later: the no-dash rule is applied
# by _strip_dashes_plan and the notes rule is backstopped by _ensure_notes, so handing them to the
# rule check would surface "breaches" that are already on their way to being fixed.
_SELF_ENFORCED_BLOCKS = frozenset({"text_style", "speaker_notes"})


def _has_action(rules: list[dict] | None, action: str) -> bool:
    """Is this deck-wide guarantee in force? None (no rules reached us) keeps the old always-on
    behaviour, so an unmigrated database loses nothing."""
    if rules is None:
        return True
    return any(r.get("action") == action for r in rules)


# Slides whose structure rule the CODE really keeps: the three it can compose from the deck's own
# content, plus the verbatim brand benefits slide, which the renderer splices at whatever slot the
# rule names (`benefits_slot` below) and which the model never writes at all.
_CODE_PLACED = frozenset(_COMPOSABLE) | {"benefits_verbatim"}
_POSITION_PHRASE = {"first": "as the FIRST slide", "second": "as the SECOND slide",
                    "third": "as the THIRD slide", "last": "as the LAST slide",
                    "second_to_last": "second to last"}


def _structure_asks(rules: list[dict]) -> list[str]:
    """The half of a structure rule the code CANNOT keep, written out as an ordinary team rule.

    `position` and `always_include` are only true guarantees for the slides in `_CODE_PLACED`. For
    any other layout the code can move a slide it finds but cannot make one exist — a content
    slide's text has to be WRITTEN. Those rules used to be applied by nobody: not by the code, not
    named in the prompt, not seen by the rule check. So they land in the team's rules instead, which
    means the model is asked for them and the finished deck is read back against them
    (`rules_gate`) like any other rule.

    Composed from slide + action rather than the row's own wording on purpose: the layout key is the
    model's own vocabulary, while the team's text names the slide the way a person would.
    """
    out = []
    for r in rules:
        slide = r.get("slide")
        if not slide or slide in _CODE_PLACED:
            continue          # the deterministic nets and the renderer keep these ones for real
        where = _POSITION_PHRASE.get(r.get("position") or "") if r["action"] == "position" else ""
        out.append(f"Every deck includes a `{slide}` slide"
                   + (f", {where}" if where else "") + ".")
    return out


def _required_slides(rules: list[dict]) -> set[str]:
    """Slides a rule says every deck must have — a position rule implies the slide is wanted.
    Deck-wide rules (speaker notes, no dashes, appendix) carry no slide and are skipped."""
    return {r["slide"] for r in rules if r.get("slide")}


def _place(slides: list[dict], index: int, slot: str) -> int:
    """Target index for `slot`, given the slide currently at `index` is being moved out."""
    rest = len(slides) - 1  # length once the slide is lifted out
    if slot == "first":
        return 0
    if slot == "second":
        return min(1, rest)
    if slot == "third":
        return min(2, rest)
    if slot == "last":
        return rest
    return max(0, rest - 1)  # second_to_last


def _apply_structure(plan: dict, rules: list[dict]) -> dict:
    """Move every pinned slide to its slot, in the order the slots read left to right, so a deck
    whose model output drifted still opens the way the team decided it should."""
    if not rules:
        return plan
    order = {s: i for i, s in enumerate(_POSITION_SLOTS)}
    pinned = sorted((r for r in rules if r["action"] == "position"),
                    key=lambda r: order.get(r["position"], 99))
    slides = list(plan.get("slides", []))
    for r in pinned:
        at = next((i for i, s in enumerate(slides) if s.get("layout") == r["slide"]), None)
        if at is None:
            continue
        target = _place(slides, at, r["position"])
        slide = slides.pop(at)
        slides.insert(target, slide)
    return {**plan, "slides": slides}


def _ensure_title(plan: dict, required: set[str] | None = None) -> dict:
    """Compose a cover when the deck has none and a structure rule asks for one. Trivially
    composable from the deck's own title, which is why "the cover slide always comes first" can be
    a real guarantee rather than a request — without this, a rule could only REPOSITION a cover the
    model happened to write."""
    if required is not None and "title" not in required:
        return plan
    slides = plan.get("slides", [])
    if any(s.get("layout") == "title" for s in slides):
        return plan
    deck_title = (plan.get("deck_title") or "").strip()
    if not deck_title:
        return plan   # nothing honest to put on it
    cover = {"layout": "title", "title": _cap(deck_title, 60),
             "speaker_notes": f"Welcome. {deck_title}."}
    return {**plan, "slides": [cover] + slides}


def _cap_list_fields(plan: dict, brand: str | None = None) -> dict:
    """Trim over-long list fields to what their box can actually hold, in place.

    A layout's `maxItems` is not a style preference: it is how many rows the real placeholder fits
    at the enforced font size. An agenda box holds 7 lines, so a 10-item agenda cannot be rendered
    however the plan asks. That is a HARD validation error, which means one over-eager list costs
    the user the entire deck after a retry — for a slide whose extra rows would not have been
    visible anyway.

    Trimming keeps the first N, because a plan lists its sections in deck order and the earlier
    ones are the ones the deck actually opens with. Logged, never silent: a dropped agenda line is
    a real (if small) content loss, and it should be visible in the job output.
    """
    try:
        conds = config.schema(brand)["properties"]["slides"]["items"].get("allOf", [])
    except Exception:  # noqa: BLE001 — never fail a deck over the cap net itself
        return plan
    caps: dict[str, dict[str, int]] = {}
    for cond in conds:
        layout = cond.get("if", {}).get("properties", {}).get("layout", {}).get("const")
        if not layout:
            continue
        for field, spec in (cond.get("then", {}).get("properties") or {}).items():
            if isinstance(spec, dict) and spec.get("type") == "array" and spec.get("maxItems"):
                caps.setdefault(layout, {})[field] = spec["maxItems"]
    trimmed = []
    for i, slide in enumerate(plan.get("slides") or []):
        if not isinstance(slide, dict):
            continue
        for field, cap in caps.get(slide.get("layout"), {}).items():
            val = slide.get(field)
            if isinstance(val, list) and len(val) > cap:
                trimmed.append(f"slide {i + 1} {slide['layout']}.{field} {len(val)}->{cap}")
                slide[field] = val[:cap]
    if trimmed:
        print(f"[caps] trimmed {len(trimmed)} over-long list(s) to what the box holds: "
              + ", ".join(trimmed))
    return plan


# When a bare string has to become the object a layout's list expects, it becomes THIS field —
# the first of these the object actually declares. Ordered by how much of the slide the field
# carries: a one line item is a heading/label, not a body paragraph.
_ITEM_TEXT_KEYS = ("heading", "label", "name", "value", "text", "body", "cells")


def _coerce_item_shapes(plan: dict, brand: str | None = None) -> dict:
    """Repair list items the model wrote at the wrong shape, in place.

    Every code built layout's list is EITHER strings (an agenda's lines) or objects (a takeaways
    item's heading plus body), and the model occasionally writes the other one — usually strings
    where objects belong, because a list of bullet lines is the obvious reading of "items".

    That slip cost the whole deck twice over. It is a hard validation error, so a retry was the
    only chance to recover it; and if it ever reached the renderer anyway, every layout reads its
    items with `it.get(...)`, so a plain string raised `AttributeError: 'str' object has no
    attribute 'get'` and killed the render outright.

    Repaired rather than rejected, because no content is at stake: a string becomes the object's
    own lead text field, and an object collapses to its most meaningful text. The slide then
    renders with a heading and no body, which is exactly what the model actually supplied.
    """
    try:
        conds = config.schema(brand)["properties"]["slides"]["items"].get("allOf", [])
    except Exception:  # noqa: BLE001 — never fail a deck over the repair net itself
        return plan
    # layout -> field -> ("object", lead text key) | ("string", None) | ("text", None)
    # "text" is a plain (non-list) string field, e.g. an org chart's `center`.
    shapes: dict[str, dict[str, tuple[str, str | None]]] = {}
    for cond in conds:
        layout = cond.get("if", {}).get("properties", {}).get("layout", {}).get("const")
        if not layout:
            continue
        for field, spec in (cond.get("then", {}).get("properties") or {}).items():
            if not isinstance(spec, dict):
                continue
            if spec.get("type") == "string":
                shapes.setdefault(layout, {})[field] = ("text", None)
                continue
            if spec.get("type") != "array":
                continue
            item = spec.get("items") or {}
            if item.get("type") == "object":
                props = item.get("properties") or {}
                req = set(item.get("required") or ())
                # A REQUIRED text field first, so the wrapped item is a schema-valid object and
                # the deck never spends its one retry on a slip the code already understood.
                lead = (next((k for k in _ITEM_TEXT_KEYS if k in props and k in req), None)
                        or next((k for k in _ITEM_TEXT_KEYS if k in props), None))
                if lead:
                    shapes.setdefault(layout, {})[field] = ("object", lead)
            elif item.get("type") == "string":
                shapes.setdefault(layout, {})[field] = ("string", None)

    def to_text(v) -> str:
        """An object flattened for a list that wants plain strings: its lead text, then any
        second line joined on, so a heading plus body does not silently lose the body."""
        parts = [str(v[k]) for k in _ITEM_TEXT_KEYS if isinstance(v.get(k), str) and v[k].strip()]
        return ": ".join(parts[:2]) if parts else ""

    fixed = []
    for i, slide in enumerate(plan.get("slides") or []):
        if not isinstance(slide, dict):
            continue
        for field, (want, lead) in shapes.get(slide.get("layout") or "", {}).items():
            val = slide.get(field)
            if want == "text":
                # The mirror slip: an object or a list where one plain line belongs. Left the
                # renderer doing regex work on a dict (`TypeError: expected string or bytes-like
                # object`), which killed the deck just as dead.
                if isinstance(val, dict):
                    slide[field] = to_text(val)
                    fixed.append(f"slide {i + 1} {slide['layout']}.{field} -> text")
                elif isinstance(val, list):
                    slide[field] = " ".join(to_text(v) if isinstance(v, dict) else str(v)
                                            for v in val).strip()
                    fixed.append(f"slide {i + 1} {slide['layout']}.{field} -> text")
                continue
            if not isinstance(val, list):
                continue
            out, changed = [], False
            for v in val:
                if want == "object" and not isinstance(v, dict):
                    # `cells` is itself a list of strings, so the wrapped value must be a list too.
                    out.append({lead: [str(v)] if lead == "cells" else str(v)})
                    changed = True
                elif want == "string" and isinstance(v, dict):
                    out.append(to_text(v))
                    changed = True
                else:
                    out.append(v)
            if changed:
                fixed.append(f"slide {i + 1} {slide['layout']}.{field} -> {want}s")
                slide[field] = [v for v in out if v != ""]
    if fixed:
        print(f"[shapes] repaired {len(fixed)} list(s) written at the wrong shape: "
              + ", ".join(fixed[:6]) + (" ..." if len(fixed) > 6 else ""))
    return plan


def _sanitize_enums(plan: dict, brand: str | None = None,
                    extra_photo_ids: list[str] | None = None) -> dict:
    """Drop `background` and `asset_id` values the brand/layout does not actually offer, in place.

    A forced tool schema is not a hard guarantee: the model still occasionally emits a value from
    outside an enum, especially when the SOURCE material pulls it that way — a Revervia deck built
    from krill source material reached for `photo_krill_swarm`, and a light-only layout was given
    `background: dark`. Both are HARD validation errors, so one slip costs the whole deck after a
    retry, for two fields that are decoration rather than content.

    Dropped, not remapped: the layout then falls back to its own default background, and the slide
    simply has no photo. Both are correct-looking outcomes; substituting a different photo would
    put an unrelated image next to the text.
    """
    try:
        catalog = config.catalog(brand)
        photos = {a["id"] for a in config.selectable_photos(brand)} | set(extra_photo_ids or ())
    except Exception:  # noqa: BLE001 — never fail a deck over the net itself
        return plan
    dropped = []
    for i, slide in enumerate(plan.get("slides") or []):
        if not isinstance(slide, dict):
            continue
        cat = catalog.get(slide.get("layout") or "")
        bg = slide.get("background")
        if bg and cat:
            # "pastel" is a variant of the light master, so it needs the same availability.
            needed = "light" if bg in ("light", "pastel") else bg
            if needed not in (cat.get("backgrounds") or []):
                dropped.append(f"slide {i + 1} {slide['layout']} background={slide.pop('background')!r}")
        aid = slide.get("asset_id")
        if aid and aid not in photos:
            dropped.append(f"slide {i + 1} asset_id={slide.pop('asset_id')!r}")
    if dropped:
        print(f"[enums] dropped {len(dropped)} value(s) outside this brand's options: "
              + ", ".join(dropped[:6]) + (" ..." if len(dropped) > 6 else ""))
    return plan


def _sanitize_icons(plan: dict, brand: str | None = None) -> dict:
    """Drop icon names this brand has no icon for, in place.

    A brand's benefit-icon set is whatever its pack actually stages, so the schema enum can be as
    small as ["none"] — and then ONE invented icon name fails the whole plan and, after a retry,
    costs the user their deck. The prompt already withholds the benefit vocabulary from a brand
    with no benefit icons, but the model can still reach for a name it has seen elsewhere, and a
    decorative icon is never worth a lost deck.

    Dropped rather than remapped: guessing which generic keyword the model meant would put an icon
    whose meaning differs from the words next to them, which is the one thing the icon rules exist
    to prevent. The renderer's all-or-nothing rule then quietly clears the rest of that slide.
    """
    try:
        allowed = set(config.manifest(brand)["benefits"]) | {"none"}
        generic_ok = set(config.manifest(brand).get("generic_icons", [])) | {"none"}
    except Exception:  # noqa: BLE001 — never fail a deck over the icon net itself
        return plan
    dropped = []
    for i, slide in enumerate(plan.get("slides") or []):
        if not isinstance(slide, dict):
            continue
        if slide.get("benefit") and slide["benefit"] not in allowed:
            dropped.append(f"slide {i + 1} benefit={slide.pop('benefit')!r}")
        for item in slide.get("items") or []:
            if not isinstance(item, dict):
                continue
            if item.get("icon") and item["icon"] not in allowed:
                dropped.append(f"slide {i + 1} icon={item.pop('icon')!r}")
            if item.get("icon_generic") and item["icon_generic"] not in generic_ok:
                dropped.append(f"slide {i + 1} icon_generic={item.pop('icon_generic')!r}")
    if dropped:
        print(f"[icons] dropped {len(dropped)} icon name(s) this brand has no icon for: "
              + ", ".join(dropped[:6]) + (" ..." if len(dropped) > 6 else ""))
    return plan


def _ensure_agenda(plan: dict, required: set[str] | None = None) -> dict:
    """Compose an agenda slide (contents) when the deck has none, from its own section dividers or
    slide titles. Fires only when a structure rule asks for an agenda — delete that rule on the
    About page and a deck without one is a legitimate deck. `required=None` means "no rules
    supplied", which keeps the old unconditional behaviour."""
    slides = plan.get("slides", [])
    if required is not None and "agenda" not in required:
        return plan
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
    if len(slides) > at and slides[at].get("layout") == "exec_summary":
        at += 1   # the executive summary sits between the cover and the agenda
    return {**plan, "slides": slides[:at] + [agenda] + slides[at:]}


_EXEC_SUMMARY_CAPS = {"source": 110, "key_finding": 140, "supporting_findings": 140,
                      "relevance": 110, "contents": 90}
_EXEC_SUMMARY_SKIP = {"title", "agenda", "section", "highlight", "title_only", "closing",
                      "ingredient", "exec_summary"}


def _cap(text: str, n: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= n else text[:n].rstrip()


def _ensure_exec_summary(plan: dict, disabled_layouts=None, study_meta=None,
                         required: set[str] | None = None) -> dict:
    """Every deck opens with an executive summary as slide 2, right after the cover and before
    the agenda. The planner is instructed to write one (the SUMMARY:/EXEC_LENGTH: nudges drive
    the retry); this is the deterministic net for when it still doesn't — composed ONLY from the
    deck's OWN already generated content (its citations, action titles, and the picked studies'
    metadata), never a new claim, so a fallback summary stays as honest as a model-written one.
    Skipped when the About page turned exec_summary off (the requirement travels with the layout)."""
    if "exec_summary" in (disabled_layouts or ()):
        return plan
    if required is not None and "exec_summary" not in required:
        return plan   # the team deleted the rule that asks for one
    slides = plan.get("slides", [])
    if len(slides) < 3 or any(s.get("layout") == "exec_summary" for s in slides):
        return plan

    content_titles, citations = [], []
    for s in slides:
        layout = s.get("layout") or ""
        if layout in _EXEC_SUMMARY_SKIP or layout.startswith("custom_"):
            continue
        t = (s.get("title") or "").strip()
        if t:
            content_titles.append(t)
        citations.extend(s.get("source_citations") or [])
    seen, uniq_cites = set(), []
    for c in citations:
        if c and c.lower() not in seen:
            seen.add(c.lower())
            uniq_cites.append(c)

    if study_meta:
        source = "; ".join(m.get("cite", "") for m in study_meta[:2] if m.get("cite"))
    elif uniq_cites:
        source = "; ".join(uniq_cites[:2])
    else:
        source = "See the cited sources in the deck's own slides and speaker notes."

    key_finding = content_titles[0] if content_titles else \
        "See the deck's evidence slides for the primary result."
    supporting_findings = ". ".join(content_titles[1:3]) if len(content_titles) > 1 else \
        "See the deck for its full body of supporting evidence."
    relevance = "This strengthens Superba Krill's evidence based positioning in this area."
    contents = f"{len(slides)} slides: " + ", ".join(
        content_titles[:3] or ["study evidence", "mechanism", "positioning"])

    summary = {"layout": "exec_summary",
              "source": _cap(source, _EXEC_SUMMARY_CAPS["source"]),
              "key_finding": _cap(key_finding, _EXEC_SUMMARY_CAPS["key_finding"]),
              "supporting_findings": _cap(supporting_findings, _EXEC_SUMMARY_CAPS["supporting_findings"]),
              "relevance": _cap(relevance, _EXEC_SUMMARY_CAPS["relevance"]),
              "contents": _cap(contents, _EXEC_SUMMARY_CAPS["contents"]),
              "speaker_notes": _cap(f"{key_finding} {supporting_findings}", 1400)}
    at = 1 if slides and slides[0].get("layout") == "title" else 0
    return {**plan, "slides": slides[:at] + [summary] + slides[at:]}


# Plan fields whose values are (or contain) reader-facing prose worth echoing into a derived
# speaker note, in the order a presenter would read the slide.
_NOTE_FIELDS = ("subtitle", "banner", "body", "caption", "items", "columns", "points", "stats",
                "metrics", "quadrants", "stages", "phases", "criteria", "bubbles", "before",
                "after", "center", "total", "tagline", "contact",
                "source", "key_finding", "supporting_findings", "relevance", "contents")


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
        if isinstance(s.get("slots"), dict):   # a TEAM REDESIGNED layout's per-slot text
            lines.extend(str(v).strip() for v in s["slots"].values() if str(v or "").strip())
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
            if key == "slots":   # a TEAM REDESIGNED layout: every value is reader-facing text
                return {k: _strip_text(v) if isinstance(v, str) else walk(v, k)
                        for k, v in obj.items()}
            return {k: walk(v, k) for k, v in obj.items()}
        return obj
    return walk(plan)


# "auto" (default) leaves the AI's own per-slide light/dark rhythm choice alone. "dark"/"light"
# force EVERY slide to one theme deck-wide — a deterministic override applied after planning, not
# a prompt change, so it can never be second-guessed by the model. Named after the three real
# backgrounds (see the About page's "Color themes" card): dark = Blue Ocean, light = White,
# pastel = Pastel Blue (the light master with a solid mint override).
_COLOR_THEMES = {"dark", "light", "pastel"}


_SLIDE_COUNT_PREFIX = re.compile(r"^\s*(?:in\s+|across\s+|about\s+)?\d+\s*[-\s]?slides?\s*[:,;.\-–—]*\s*",
                                 re.IGNORECASE)


def _clean_exec_contents(plan: dict) -> dict:
    """Strip an invented slide count off the executive summary's `contents` line.

    The model writes the summary as part of the SAME plan whose length it is describing, and the
    deterministic nets and the revision pass then add and move slides — so any count it states is
    guessed and usually wrong (a real deck claimed "15 slides" while shipping 22). The prompt now
    asks for themes without a number; this is the backstop, the same ask-then-enforce shape the
    no-dash and photo-minimum rules use. Only a LEADING count phrase is removed, so a genuine
    mention further into the sentence survives, and a line that is nothing but a count is left
    alone rather than blanked."""
    for s in plan.get("slides") or []:
        if s.get("layout") != "exec_summary":
            continue
        txt = str(s.get("contents") or "")
        stripped = _SLIDE_COUNT_PREFIX.sub("", txt, count=1)
        if stripped and stripped != txt:
            s["contents"] = stripped[0].upper() + stripped[1:]
    return plan


def _apply_color_theme(plan: dict, color_theme: str | None,
                       override_keys: frozenset | set = frozenset(),
                       brand: str | None = None) -> dict:
    """Force every slide's `background` to the chosen theme, deck-wide. Verbatim slides (ingredient,
    custom_*, TEAM REDESIGNED layout overrides — they carry their own design) and the benefits/
    appendix splices have no `background` concept and are untouched — this only ever sets a field
    the renderer already reads."""
    if color_theme not in _COLOR_THEMES:
        return plan
    try:
        catalog = config.catalog(brand)
    except Exception:  # noqa: BLE001
        catalog = {}
    needed = "light" if color_theme in ("light", "pastel") else color_theme

    def keeps_own(s):
        layout = s.get("layout") or ""
        if layout.startswith("custom_") or layout == "ingredient" or layout in override_keys:
            return True
        # A layout that cannot render this background keeps its own: five layouts are light-only
        # (key_points, comparison, harvey_ball, coverage_matrix, chart_takeaways), and forcing a
        # dark deck onto them used to produce a slide the renderer has no dark variant for.
        cat = catalog.get(layout)
        return bool(cat) and needed not in (cat.get("backgrounds") or [])

    slides = [s if keeps_own(s) else {**s, "background": color_theme}
              for s in plan.get("slides", [])]
    return {**plan, "slides": slides}


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


def _log_geometry_issues(issues: list[dict]) -> None:
    """[qa-geometry] stderr trail for the deterministic pass — visible even in fast mode, where
    nothing else looks at the rendered deck at all."""
    if not issues:
        return
    fixed = sum(1 for i in issues if i.get("fixed"))
    print(f"[qa-geometry] {fixed}/{len(issues)} deterministic issue(s) found, {fixed} auto-fixed:\n- "
          + "\n- ".join(f"slide {i['slide']} [{i['category']}]: {i['detail']}" for i in issues),
          file=sys.stderr)


def _visual_gate(client, summary_text, plan, pptx, length, tone, _p, instructions="", study_meta=None,
                 custom_rules="", disabled_layouts=None, design=None, custom_slides=None,
                 custom_photos=None, preferred_layouts=None, disabled_photos=None,
                 preferred_photos=None, layout_overrides=None, required_slides=None,
                 benefits_slot="second_to_last", source_appendix=True, slide_map=None,
                 brand=None):
    """Polished mode: render → look at the slides → fix flagged ones → re-render. Bounded to
    DECK_QA_ROUNDS passes (default 1). Never fails the deck — a gate error or a revision that
    breaks validation keeps the pre-gate deck.

    Each round runs the deterministic geometry/contrast/asset pass FIRST (fixes margins/
    alignment/contrast in place so the vision call has less to flag, and surfaces any icon/photo/
    chart the plan called for that never actually rendered) and only then the vision review — the
    two sets of findings are merged before the single revision call. The vision half still
    degrades to a no-op without a rasteriser; the deterministic half never does."""
    extra = [c["key"] for c in planner.auto_custom_slides(custom_slides)]
    photo_ids = planner.custom_photo_ids(custom_photos)
    photo_level = (design or {}).get("photo_level", "default")
    override_keys = frozenset(o["layout"] for o in (layout_overrides or []))
    slot_layouts = planner.slot_entries(layout_overrides, custom_slides)
    rounds = max(1, int(os.environ.get("DECK_QA_ROUNDS", "1")))
    for _ in range(rounds):
        pptx, geo_issues = qa_geometry.review_and_fix(pptx, plan, slide_map=slide_map,
                                                      verbatim_layouts=override_keys)
        _log_geometry_issues(geo_issues)
        asset_flags = [{"slide": i["slide"], "issues": [i["category"]], "fix": i["detail"]}
                       for i in geo_issues if not i["fixed"] and i["category"] == "asset"]
        _p(80, "Reviewing the rendered slides")
        images = qa_gate.rasterize(pptx)
        if not images:
            print("[qa-gate] no rasteriser available (install LibreOffice); skipping vision QA",
                  file=sys.stderr)
        vision_flags = qa_gate.flagged(qa_gate.review(client, images, plan)) if images else []
        flags = vision_flags + asset_flags
        if not flags:
            break
        _p(90, f"Polishing {len(flags)} flagged slide(s)")
        candidate = planner.revise_plan_visual(client, summary_text, plan, flags,
                                               length=length, tone=tone, instructions=instructions,
                                               custom_rules=custom_rules,
                                               disabled_layouts=disabled_layouts,
                                               custom_slides=custom_slides,
                                               custom_photos=custom_photos,
                                               preferred_layouts=preferred_layouts, design=design,
                                               disabled_photos=disabled_photos,
                                               preferred_photos=preferred_photos,
                                               layout_overrides=layout_overrides,
                                               required_slides=required_slides, brand=brand)
        # A visual fix can slip on a detail (e.g. an invalid icon enum); give it one schema-repair
        # pass rather than discarding all the good fixes over a single slip.
        errs = validate.validate_plan(candidate, extra_layouts=extra,
                                      extra_photo_ids=photo_ids, photo_level=photo_level,
                                      disabled_layouts=disabled_layouts,
                                      layout_overrides=slot_layouts, brand=brand)
        if errs:
            candidate = planner.revise_plan(client, summary_text, candidate, errs,
                                            length=length, tone=tone, instructions=instructions,
                                            custom_rules=custom_rules,
                                            disabled_layouts=disabled_layouts,
                                            custom_slides=custom_slides,
                                            custom_photos=custom_photos,
                                            preferred_layouts=preferred_layouts, design=design,
                                            disabled_photos=disabled_photos,
                                            preferred_photos=preferred_photos,
                                            layout_overrides=layout_overrides,
                                            required_slides=required_slides, brand=brand)
            errs = validate.validate_plan(candidate, extra_layouts=extra,
                                          extra_photo_ids=photo_ids, photo_level=photo_level,
                                          disabled_layouts=disabled_layouts,
                                          layout_overrides=slot_layouts, brand=brand)
        # Same soft-error tags as generate()'s split below — validate_plan() always appends
        # VARIETY:/PHOTOS:/TEXT: nudges now, and this second, separate hard/soft split had
        # fallen out of sync with that (missing the exemption), so a visual fix on an otherwise
        # fine deck would get discarded here for a nudge it was never asked to address.
        hard = [e for e in errs if not any(s in e for s in _SOFT_ERRORS)]
        if hard:
            print("[qa-gate] revision still invalid after repair; keeping pre-gate deck:\n- "
                  + "\n- ".join(hard), file=sys.stderr)
            break
        candidate = _ensure_notes(candidate)
        candidate = _strip_dashes_plan(candidate)
        plan = candidate
        pptx, slide_map = renderer.render_deck(candidate, brand=brand, study_meta=study_meta,
                                               design=design, custom_slides=custom_slides,
                                               custom_photos=custom_photos,
                                               layout_overrides=layout_overrides,
                                               benefits_slot=benefits_slot,
                                               source_appendix=source_appendix,
                                               return_slide_map=True)
    return pptx, plan


def generate(client: anthropic.Anthropic, summary_text: str, base_name: str, *,
             length: str = "standard", tone: str = "balansert", quality: str = "polished",
             instructions: str = "", on_progress=None,
             study_meta: list[dict] | None = None,
             custom_rules: str = "", disabled_layouts: list[str] | None = None,
             design: dict | None = None,
             custom_slides: list[dict] | None = None,
             custom_photos: list[dict] | None = None,
             preferred_layouts: list[str] | None = None,
             disabled_photos: list[str] | None = None,
             preferred_photos: list[str] | None = None,
             color_theme: str | None = None,
             layout_overrides: list[dict] | None = None,
             structure_rules: list[dict] | None = None,
             managed_blocks: dict[str, str] | None = None,
             brand: str | None = None) -> dict:
    """design / custom_slides / custom_photos / preferred_layouts: the About page's levers —
    deterministic design overrides, the team's verbatim slides ({key, name, description, mode,
    bytes, index, png} each), the team's photo library ({key, name, description, bytes} each)
    and the starred house-favourite layouts — see renderer/planner. disabled_photos/
    preferred_photos: the same on/off + star switches, but for individual BUILT-IN photos.
    color_theme: None/"auto" keeps the AI's own per-slide light/dark rhythm; "dark", "light" or
    "pastel" forces every slide deck-wide (Blue Ocean / White / Pastel Blue) — see _apply_color_theme.
    layout_overrides: TEAM REDESIGNED layouts ({layout, bytes, index, slots, png} each) — the
    design is spliced verbatim while the planner writes fresh per-slot text on every use.
    structure_rules: the deck's SHAPE as the team set it on the About page ({slide, action,
    position} each) — which slides every deck must have and where they sit. None/[] keeps the
    old hardcoded shape (cover first, summary second, agenda third).
    managed_blocks: the writing rules the team now owns ({key: text}) — see
    planner.BUILTIN_BLOCKS. None means they never reached us and every default applies."""
    def _p(pct, step):
        if on_progress:
            try:
                on_progress(pct, step)
            except Exception:  # noqa: BLE001 — progress must never break generation
                pass

    extra = [c["key"] for c in planner.auto_custom_slides(custom_slides)]
    photo_ids = planner.custom_photo_ids(custom_photos)
    photo_level = (design or {}).get("photo_level", "default")
    # Sanitized ONCE (unknown/fixed-role/disabled keys dropped) and threaded everywhere —
    # planner prompt+schema, validation, and the renderer must all see the same set.
    # Computed up front: it decides both what the planner may switch off and which slides the
    # deterministic nets are allowed to compose.
    structure = (_DEFAULT_STRUCTURE if structure_rules is None
                 else sanitize_structure(structure_rules))
    required = _required_slides(structure)
    # A structure rule the code cannot guarantee becomes an ordinary team rule here, ONCE, before
    # any model call: from this point it rides `custom_rules` everywhere — into the prompt's TEAM
    # RULES block, into every revision, and into the rule check below — so it is asked and verified
    # instead of being silently inert. Rules the deterministic nets really keep are left out.
    asks = _structure_asks(structure)
    if asks:
        custom_rules = "\n".join([t for t in [(custom_rules or "").strip()] if t] + asks)
    layout_overrides = planner.sanitize_overrides(
        layout_overrides, planner.sanitize_disabled(disabled_layouts, required, brand))
    override_keys = frozenset(o["layout"] for o in layout_overrides)
    slot_layouts = planner.slot_entries(layout_overrides, custom_slides)

    _p(5, "Planning the deck")
    plan = planner.plan_deck(client, summary_text, length=length, tone=tone, instructions=instructions,
                             custom_rules=custom_rules, disabled_layouts=disabled_layouts,
                             custom_slides=custom_slides, custom_photos=custom_photos,
                             preferred_layouts=preferred_layouts, design=design,
                             disabled_photos=disabled_photos, preferred_photos=preferred_photos,
                             layout_overrides=layout_overrides, required_slides=required,
                             managed_blocks=managed_blocks, brand=brand)

    plan = _cap_list_fields(_sanitize_enums(_sanitize_icons(
        _coerce_item_shapes(plan, brand), brand), brand, photo_ids), brand)
    errors = validate.validate_plan(plan, extra_layouts=extra, extra_photo_ids=photo_ids,
                                    photo_level=photo_level, disabled_layouts=disabled_layouts,
                                    layout_overrides=slot_layouts, brand=brand)
    if errors:
        _p(40, "Refining copy to fit")
        plan = planner.revise_plan(client, summary_text, plan, errors, length=length, tone=tone,
                                   instructions=instructions, custom_rules=custom_rules,
                                   disabled_layouts=disabled_layouts, custom_slides=custom_slides,
                                   custom_photos=custom_photos,
                                   preferred_layouts=preferred_layouts, design=design,
                                   disabled_photos=disabled_photos, preferred_photos=preferred_photos,
                                   layout_overrides=layout_overrides, required_slides=required,
                                   managed_blocks=managed_blocks, brand=brand)
        plan = _cap_list_fields(_sanitize_enums(_sanitize_icons(
            _coerce_item_shapes(plan, brand), brand), brand, photo_ids), brand)
        errors = validate.validate_plan(plan, extra_layouts=extra, extra_photo_ids=photo_ids,
                                        photo_level=photo_level, disabled_layouts=disabled_layouts,
                                        layout_overrides=slot_layouts, brand=brand)
        if errors:
            # Split structural violations (broken plan -> fail loudly) from residual length
            # overages and the VARIETY:/PHOTOS: coverage nudges. Title/heading/body placeholders
            # auto-fit, so a few chars over is cosmetically absorbed at render, and a deck that
            # still under-uses layouts/photos after one revision is still a valid deck — don't
            # deny a non-technical user their deck over either.
            hard = [e for e in errors if not any(s in e for s in _SOFT_ERRORS)]
            if hard:
                raise ValueError("Plan failed validation after one retry:\n- " + "\n- ".join(hard))
            print("[warn] minor overflows/coverage nudges remain after retry; shipping anyway:\n- "
                  + "\n- ".join(errors), file=sys.stderr)

    # The team's own standing rules are the one kind of instruction that can be neither enforced in
    # code nor caught by the schema, so they used to be a request nobody verified. Read the finished
    # plan against them and give the model one chance to fix what it missed — the same
    # ask-then-check-then-repair shape the coverage/notes nudges already use. Never fatal: no rules,
    # no findings, or any failure in the check and the deck ships exactly as planned.
    # Everything the team can edit gets checked, not just what they typed from scratch: an edited
    # built in rule that nothing verified was the reason a deliberate edit could be ignored
    # (caught by generating a real deck). Two are left out because the code already applies them
    # moments later, so checking them here would only report breaches about to be fixed anyway.
    checkable = "\n".join(
        [t for t in [(custom_rules or "").strip()] if t]
        + [text for key, text in (managed_blocks or {}).items() if key not in _SELF_ENFORCED_BLOCKS]
    )
    if checkable.strip():
        _p(62, "Checking the deck against your rules")
        # A team slide appears in the plan as `custom_<id>`, but a team RULE calls it by the name they
        # gave it ("the thank you slide"). Without this map the checker sees two different names for
        # the same slide and every rule about a team slide passes silently — and a verbatim team slide
        # has no text at all, so its layout line is the only thing a rule can be checked against.
        slide_names = {c["key"]: c["name"] for c in (custom_slides or [])
                       if c.get("key") and c.get("name")}
        breaches = rules_gate.review(client, plan, checkable, slide_names=slide_names)
        if breaches:
            candidate = planner.revise_plan(client, summary_text, plan, breaches, length=length,
                                            tone=tone, instructions=instructions,
                                            custom_rules=checkable,
                                            disabled_layouts=disabled_layouts,
                                            custom_slides=custom_slides, custom_photos=custom_photos,
                                            preferred_layouts=preferred_layouts, design=design,
                                            disabled_photos=disabled_photos,
                                            preferred_photos=preferred_photos,
                                            layout_overrides=layout_overrides,
                                            required_slides=required,
                                            managed_blocks=managed_blocks, brand=brand)
            errs = validate.validate_plan(candidate, extra_layouts=extra, extra_photo_ids=photo_ids,
                                          photo_level=photo_level, disabled_layouts=disabled_layouts,
                                          layout_overrides=slot_layouts, brand=brand)
            hard = [e for e in errs if not any(s in e for s in _SOFT_ERRORS)]
            if hard:
                print("[rules-gate] the rule fix broke validation; keeping the pre-fix plan:\n- "
                      + "\n- ".join(hard), file=sys.stderr)
            else:
                plan = candidate

    _p(70, f"Rendering slides on the {_brand.theme(brand)['product']} template")
    plan = _ensure_title(plan, required)
    plan = _ensure_exec_summary(plan, disabled_layouts, study_meta, required)
    plan = _clean_exec_contents(plan)   # after the net, so a composed fallback is cleaned too
    plan = _ensure_agenda(plan, required)
    plan = _apply_structure(plan, structure)                # pin each slide to its slot
    if _has_action(structure, "speaker_notes"):
        plan = _ensure_notes(plan)                          # backstop the every-slide notes rule
    plan = _apply_color_theme(plan, color_theme, override_keys, brand)  # deck-wide theme override, if requested
    if _has_action(structure, "no_dashes"):
        plan = _strip_dashes_plan(plan)   # the no-dash brand rule, applied deterministically
    benefits_slot = next((r["position"] for r in structure
                          if r.get("slide") == "benefits_verbatim" and r["action"] == "position"),
                         "second_to_last" if structure_rules is None else None)
    source_appendix = _has_action(structure, "source_appendix")
    pptx, slide_map = renderer.render_deck(plan, brand=brand, study_meta=study_meta, design=design,
                                           custom_slides=custom_slides, custom_photos=custom_photos,
                                           layout_overrides=layout_overrides,
                                           benefits_slot=benefits_slot,
                                           source_appendix=source_appendix,
                                           return_slide_map=True)

    # Polished mode (now the DEFAULT) adds a visual QA pass: render → vision-check → fix flagged
    # slides. Fast mode ships the first render — the schema + renderer already guarantee it is
    # well-formed, but only a look at the pixels catches overflow, collision and icon mismatch.
    #
    # DECK_QA_GATE is a deploy-level override so the gate can be turned off WITHOUT a code deploy:
    # "off"/"0"/"false"/"no" force it off (the kill switch if the rasteriser misbehaves on the host —
    # LibreOffice on the 512 MB instance has a history), any other non-empty value forces it on
    # regardless of `quality`, which preserves how this variable behaved before.
    _gate_env = os.environ.get("DECK_QA_GATE", "").strip().lower()
    if _gate_env in ("0", "off", "false", "no"):
        run_gate = False
    elif _gate_env:
        run_gate = True
    else:
        run_gate = quality == "polished"
    if run_gate:
        pptx, plan = _visual_gate(client, summary_text, plan, pptx, length, tone, _p, instructions,
                                  brand=brand,
                                  study_meta=study_meta, custom_rules=custom_rules,
                                  disabled_layouts=disabled_layouts, design=design,
                                  custom_slides=custom_slides, custom_photos=custom_photos,
                                  preferred_layouts=preferred_layouts,
                                  disabled_photos=disabled_photos, preferred_photos=preferred_photos,
                                  layout_overrides=layout_overrides, required_slides=required,
                                  benefits_slot=benefits_slot, source_appendix=source_appendix,
                                  slide_map=slide_map)
    else:
        # Fast mode never runs the vision gate (no LLM/rasteriser call), but the deterministic
        # margin/alignment/contrast/asset pass is nearly free — run it here too so every deck gets
        # it, not just polished ones. Polished mode already ran this inside _visual_gate.
        pptx, geo_issues = qa_geometry.review_and_fix(pptx, plan, slide_map=slide_map,
                                                      verbatim_layouts=override_keys)
        _log_geometry_issues(geo_issues)

    _p(99, "Finalizing")
    return {"pptx": pptx, "filename": f"{base_name}.pptx", "plan": plan,
            "wording_md": _wording(plan), "slide_count": len(plan["slides"])}
