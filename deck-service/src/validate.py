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
_STRUCTURAL_LAYOUTS = {"title", "agenda", "section", "highlight", "title_only", "closing", "ingredient"}


def _coverage_warnings(plan: dict) -> list[str]:
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
    min_photos = max(2, total // 4)
    if photo_slides < min_photos:
        warnings.append(
            f"PHOTOS: only {photo_slides} slide(s) use a photo (asset_id) out of {total} — the photo "
            f"library (krill in the wild, Antarctic ocean/ice, product close-ups, lab and sourcing shots, "
            f"the team) is under-used. Add asset_id to at least {min_photos} slides total: use "
            f"text_with_picture or picture_full for a couple of breather beats, and set asset_id on an "
            f"exec_summary or photo_stats slide rather than leaving it off.")

    return warnings


def validate_plan(plan: dict) -> list[str]:
    """Return a list of human-readable violations ('' if the plan is valid)."""
    errors: list[str] = []
    validator = jsonschema.Draft202012Validator(config.schema())
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
    ids = {a["id"] for a in config.selectable_photos()}
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
    errors.extend(_coverage_warnings(plan))

    return errors[:25]
