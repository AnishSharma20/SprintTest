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

    return errors[:25]
