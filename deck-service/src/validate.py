"""Hard schema validation — the enforcement layer the API's tool-use does NOT give us.

The Anthropic tool `input_schema` guides the model (it reads maxLength / required / the
layout enum), but non-strict tool use does no server-side validation, and strict mode
strips string-length constraints. So the char limits that prevent overflow are enforced
HERE with jsonschema before anything is rendered. A non-empty error list drives the
planner's one self-correction retry (spec Step 5); if it's still non-empty, the pipeline
fails loudly rather than rendering a broken deck.
"""
from __future__ import annotations

import jsonschema

from . import config

# Fixed-purpose slides: their layout is dictated by their ROLE (cover, contents, divider,
# closing beat), not chosen for the shape of a point, so they don't count toward "use the
# fuller synthetic catalog" variety — including them would let a deck satisfy the minimum
# on structural slides alone while the actual content stayed on text/two_columns throughout.
_STRUCTURAL_LAYOUTS = {"title", "agenda", "section", "highlight", "title_only", "closing", "ingredient",
                       "exec_summary"}


def _coverage_warnings(plan: dict, photo_level: str = "default") -> list[str]:
    """Soft nudges (never block generation) for two house-style preferences that are easy
    for the model to under-deliver on despite prompt guidance: reaching for the 31-layout
    synthetic catalog instead of repeating text/two_columns/key_points, and actually using
    the photo library rather than leaving asset_id off by default. Thresholds scale with the
    plan's OWN slide count (not the requested length) so a shorter-than-asked deck is judged
    fairly. Tagged VARIETY:/PHOTOS: so the pipeline's retry-then-warn split never raises on
    these — a deck that still falls short after one revision ships anyway."""
    slides = plan.get("slides", [])
    total = len(slides)
    if total < 3:
        return []

    warnings: list[str] = []

    content = [s for s in slides if s.get("layout") not in _STRUCTURAL_LAYOUTS]
    distinct = {s.get("layout") for s in content}
    min_layouts = min(len(content), max(3, total // 2))
    if content and len(distinct) < min_layouts:
        warnings.append(
            f"VARIETY: only {len(distinct)} distinct layout(s) used across the {len(content)} content "
            f"slides ({', '.join(sorted(distinct))}) — the catalog has 31 code-built layouts beyond "
            f"text/two_columns/three_columns/four_columns/key_points (chart, matrix, comparison, pillars, "
            f"cycle, roadmap, numbered_cards, icon_grid, cause_effect, breakdown, coverage_matrix, "
            f"metric_bars, takeaways, from_to, org_chart, decision_tree, gantt, team, kpi_dashboard, "
            f"implications, chart_bands, chart_takeaways, serpentine, funnel...). Rework some content "
            f"slides onto a structural layout that matches their shape so at least {min_layouts} distinct "
            f"layouts are used.")

    photo_slides = sum(1 for s in slides if s.get("asset_id"))
    # Scaled by the About page's photo density level — same formula the planner prompt uses.
    from .planner import photo_minimum
    min_photos = photo_minimum(total, photo_level)
    if photo_slides < min_photos:
        warnings.append(
            f"PHOTOS: only {photo_slides} slide(s) use a photo (asset_id) out of {total} — the photo "
            f"library (krill in the wild, Antarctic ocean/ice, product close-ups, lab and sourcing shots, "
            f"the team) is under-used. Add asset_id to at least {min_photos} slides total: use "
            f"text_with_picture or picture_full for a couple of breather beats, and set asset_id on a "
            f"photo_stats slide rather than leaving it off.")

    return warnings


# Slides that are spliced in verbatim (fixed AKBM slides and the team's own uploads) are emitted
# as bare {"layout": key} by contract — they are the only slides allowed to skip speaker notes.
def _needs_notes(slide: dict) -> bool:
    layout = slide.get("layout") or ""
    return layout != "ingredient" and not layout.startswith("custom_")


def _notes_warnings(plan: dict) -> list[str]:
    """Soft nudge: every generated slide must carry presenter-ready speaker_notes (a house
    requirement — the deck doubles as a talk script). Tagged NOTES: so the pipeline's
    retry-then-warn split never hard-fails a deck over it, and pipeline._ensure_notes backstops
    any slide still missing one after the retry."""
    missing = [f"slides/{i} ({s.get('layout')}: \"{(s.get('title') or '')[:60]}\")"
               for i, s in enumerate(plan.get("slides", []))
               if _needs_notes(s) and not (s.get("speaker_notes") or "").strip()]
    if not missing:
        return []
    return [f"NOTES: {len(missing)} slide(s) have no `speaker_notes`. Every slide needs a presenter "
            f"script (3 to 6 spoken sentences: takeaway, walk-through, supporting detail, bridge to "
            f"the next slide). Missing on: " + "; ".join(missing)]


def _summary_warning(plan: dict, disabled_layouts=None) -> list[str]:
    """Soft nudge: every deck opens with an executive summary as slide 2, right after the cover
    and before the agenda (skipped when the About page turned the exec_summary layout off).
    pipeline._ensure_exec_summary backstops a deck that still lacks one after the retry."""
    if "exec_summary" in (disabled_layouts or ()):
        return []
    slides = plan.get("slides", [])
    if len(slides) < 3 or any(s.get("layout") == "exec_summary" for s in slides):
        return []
    return ["SUMMARY: the deck has no `exec_summary` slide — every deck needs one as slide 2, "
            "right after the cover, with its 5 fields (source, key_finding, supporting_findings, "
            "relevance, contents)."]


_EXEC_SUMMARY_FIELDS = ("source", "key_finding", "supporting_findings", "relevance", "contents")
_EXEC_SUMMARY_WORD_TARGET = 110  # ceiling with headroom over the ~80-word prompt target


def _exec_summary_length_warning(plan: dict) -> list[str]:
    """Soft nudge: the executive summary's 5 rows together should read as ~80 words, a tight
    business-memo summary, not fill every field's generous schema maxLength ceiling. Tagged
    EXEC_LENGTH: so it never blocks generation."""
    for s in plan.get("slides", []):
        if s.get("layout") != "exec_summary":
            continue
        text = " ".join(str(s.get(f) or "") for f in _EXEC_SUMMARY_FIELDS)
        words = len(text.split())
        if words > _EXEC_SUMMARY_WORD_TARGET:
            return [f"EXEC_LENGTH: the executive summary is {words} words across its 5 rows — the "
                    f"target is about 80 words total. Tighten each row to the essential number and "
                    f"sentence; the full detail already lives on the deck's own slides and in "
                    f"speaker_notes."]
        return []
    return []


# Fields that intentionally stay short one-liners even when their maxLength happens to be
# generous (a caption reading a chart, a banner summary, contact details) — never nudged toward
# their limit; doing so would just pad a line that is supposed to stay a line.
_SHORT_BY_DESIGN = {"title", "caption", "note", "tagline", "contact", "bottom_note", "banner"}


def _long_text_paths(props: dict, prefix: tuple[str, ...] = (), min_len: int = 90) -> list[tuple]:
    """Every STRING field long enough to be real prose (or an array-of-objects field's such
    sub-fields), walked from one layout's schema conditional. A "*" in the returned path marks
    where `_read_path` should iterate a list rather than index a key."""
    out = []
    for key, sub in props.items():
        if key in _SHORT_BY_DESIGN:
            continue
        if sub.get("type") == "string" and sub.get("maxLength", 0) >= min_len:
            out.append((prefix + (key,), sub["maxLength"]))
        elif sub.get("type") == "array":
            item = sub.get("items", {})
            if item.get("type") == "object":
                out.extend(_long_text_paths(item.get("properties", {}), prefix + (key, "*"), min_len))
    return out


def _read_path(slide: dict, path: tuple) -> list[tuple[str, str]]:
    """Resolve a schema path (a "*" segment means iterate a list) against one slide instance.
    Returns (concrete_path, text) pairs with REAL indices (e.g. "columns/1/body"), not the
    wildcarded schema path, so a report can point the retry at the exact field."""
    cur = [("", slide)]
    for seg in path:
        nxt = []
        for cp, c in cur:
            if seg == "*":
                if isinstance(c, list):
                    nxt.extend((f"{cp}/{j}" if cp else str(j), v) for j, v in enumerate(c))
            elif isinstance(c, dict) and seg in c:
                nxt.append((f"{cp}/{seg}" if cp else seg, c[seg]))
        cur = nxt
    return [(cp, v) for cp, v in cur if isinstance(v, str) and v.strip()]


def _text_density_warnings(plan: dict) -> list[str]:
    """Soft nudge (never blocks) toward AKBM's own house style of filling a box with real
    supporting substance rather than a short fragment. Compares each long-form text field's
    actual length to its schema maxLength — the true room its box has, already measured from the
    real template geometry — and, if the deck is running noticeably short of that room on
    average, names the worst offenders so the retry knows exactly what to expand. Never fires on
    fewer than 4 qualifying fields (too little signal to judge a whole deck by)."""
    slides = plan.get("slides", [])
    if len(slides) < 3:
        return []

    long_paths_by_layout: dict[str, list[tuple]] = {}
    for cond in config.schema()["properties"]["slides"]["items"].get("allOf", []):
        sem = cond["if"]["properties"]["layout"]["const"]
        long_paths_by_layout[sem] = _long_text_paths(cond["then"].get("properties", {}))

    fields = []  # (path_str, actual_len, max_len)
    for i, slide in enumerate(slides):
        for path, max_len in long_paths_by_layout.get(slide.get("layout"), []):
            for concrete_path, text in _read_path(slide, path):
                fields.append((f"slides/{i}/{concrete_path}", len(text), max_len))

    if len(fields) < 4:
        return []
    avg_fill = sum(a / m for _, a, m in fields) / len(fields)
    if avg_fill >= 0.5:
        return []

    worst = sorted(fields, key=lambda f: f[1] / f[2])[:5]
    examples = "; ".join(f"{p} ({a}/{m} chars, {round(100 * a / m)}%)" for p, a, m in worst)
    return [f"TEXT: body and detail text is running short of the room available — averaging "
            f"{round(100 * avg_fill)}% of each field's actual limit across {len(fields)} fields. "
            f"AKBM's own decks fill these boxes with fuller sentences (a number, a mechanism, a "
            f"comparison, a consequence), not a short fragment. Worst examples: {examples}. Expand "
            f"these, and any similarly thin field elsewhere, toward their bracketed limit with real "
            f"substance — never by padding with filler."]


def _schema_with_extras(extra_layouts: list[str] | None,
                        extra_photo_ids: list[str] | None = None,
                        layout_overrides: list[dict] | None = None) -> dict:
    """The slide schema, with the team's own verbatim slide keys (custom_<id>) added to the
    layout enum, the team's photo ids (team_photo_<id>) added to every asset_id enum, and any
    overridden layout's conditional swapped to its text slots (planner.apply_layout_overrides,
    the same mutation the tool schema gets — guidance and enforcement can't drift). Verbatim
    slides need no if/then conditional — they carry no other fields."""
    if not extra_layouts and not extra_photo_ids and not layout_overrides:
        return config.schema()
    import copy
    s = copy.deepcopy(config.schema())
    if extra_layouts:
        enum = s["properties"]["slides"]["items"]["properties"]["layout"]["enum"]
        s["properties"]["slides"]["items"]["properties"]["layout"]["enum"] = enum + [
            k for k in extra_layouts if k not in enum]
    if extra_photo_ids:
        from .planner import extend_asset_enums
        extend_asset_enums(s, extra_photo_ids)
    if layout_overrides:
        from .planner import apply_layout_overrides
        apply_layout_overrides(s, layout_overrides)
    return s


def validate_plan(plan: dict, extra_layouts: list[str] | None = None,
                  extra_photo_ids: list[str] | None = None,
                  photo_level: str = "default",
                  disabled_layouts=None,
                  layout_overrides: list[dict] | None = None) -> list[str]:
    """Return a list of human-readable violations ('' if the plan is valid)."""
    errors: list[str] = []
    validator = jsonschema.Draft202012Validator(
        _schema_with_extras(extra_layouts, extra_photo_ids, layout_overrides))
    for e in sorted(validator.iter_errors(plan), key=lambda e: list(e.absolute_path)):
        where = "/".join(str(p) for p in e.absolute_path) or "(root)"
        # Precise, actionable message for the planner's retry: exact length, limit, and how
        # much to cut. jsonschema's default "'...' is too long" doesn't say by how much.
        if e.validator == "maxLength" and isinstance(e.instance, str):
            errors.append(f"{where}: text is {len(e.instance)} chars but the limit is "
                          f"{e.validator_value} — shorten it by at least {len(e.instance) - e.validator_value}")
        else:
            errors.append(f"{where}: {e.message}")

    # Semantic checks beyond the JSON Schema (asset_id must be a real, selectable photo;
    # the enum already covers this, but a clear message helps the retry).
    ids = {a["id"] for a in config.selectable_photos()} | set(extra_photo_ids or ())
    catalog = config.catalog()
    for i, slide in enumerate(plan.get("slides", []), 1):
        aid = slide.get("asset_id")
        if aid and aid not in ids:
            errors.append(f"slides/{i-1}/asset_id: '{aid}' is not a selectable photo id")
        layout = slide.get("layout")
        bg = slide.get("background")
        if layout in catalog and bg and bg not in catalog[layout]["backgrounds"]:
            errors.append(f"slides/{i-1}/background: '{bg}' not available for layout '{layout}'")

    # Always include the coverage nudges, even alongside real schema errors — revise_plan()
    # gives VARIETY:/PHOTOS: their own separate instruction block from schema fixes, so the one
    # retry a plan gets can act on both at once. Gating this behind "only when otherwise clean"
    # meant a plan with even one trivial residual overflow (which ships anyway) never got its
    # coverage checked at all, silently shipping under the photo/variety minimums.
    errors.extend(_coverage_warnings(plan, photo_level))
    errors.extend(_text_density_warnings(plan))
    errors.extend(_notes_warnings(plan))
    errors.extend(_summary_warning(plan, disabled_layouts))
    errors.extend(_exec_summary_length_warning(plan))

    return errors[:25]
