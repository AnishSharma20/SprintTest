"""Mixed-pages whitepaper generator — assemble from designed Superba brochure pages.

Composes a whitepaper from pages across the three standard A4 brochures (Sport, Sustainability,
Brochure). Claude picks an ordered page set based on the source, then fills the chosen pages with
text, respecting per-frame character budgets. Verbatim pages (benefit grid, ingredient spread)
are placed exactly as designed. The result is a `.zip` containing the `.idml` file + images +
preview markdown + designer note.
"""
from __future__ import annotations

import re

import anthropic

from . import config
from .planner import APPROVED_CLAIMS_RULE, CLAIM_RULES

WP_DISCLAIMER = ("*AI generated draft from the source material. Review all content, claims and figures, "
                 "and edit as needed before publishing.*")


def _selection_system(instructions: str) -> str:
    instr = f"\n\nUSER CONTEXT (high priority):\n\"\"\"\n{instructions.strip()}\n\"\"\"\n" \
        if (instructions or "").strip() else ""
    return f"""You are planning the STRUCTURE of an Aker BioMarine Superba whitepaper that will be
assembled from real, already designed brochure pages.

Choose the pages that fit the SOURCE MATERIAL, in reading order, via the choose_pages tool.

RULES:
- Start with exactly ONE cover. Match its theme to the source: the sports cover for performance,
  muscle or recovery topics; the credentials cover when the weight of evidence is the story; the
  whole body cover otherwise.
- Then the body pages, then ONE closing page last.
- Add a VERBATIM page only when it genuinely supports the story. You write no text for those.
- Keep it tight: prefer 3 to 5 pages. Do not pad.
{instr}
Choose the pages now via choose_pages."""


def _compose_fill_system(instructions: str, page_ids: list[str]) -> str:
    instr = f"\n\nUSER CONTEXT & INSTRUCTIONS (high priority — audience, angle, emphasis, output " \
            f"language):\n\"\"\"\n{instructions.strip()}\n\"\"\"\n" if (instructions or "").strip() else ""
    return f"""You are a scientific writer for Aker BioMarine's Superba Krill. Write the text for a
whitepaper that is being assembled from REAL designed brochure pages: {", ".join(page_ids)}.

This is a template FILL. Every field maps to an existing text frame in a finished InDesign page.
- RESPECT EVERY maxLength and the per line budgets in each field's description. The frames are a
  fixed physical size and CANNOT grow; text over budget is CUT OFF and lost. COUNT characters and
  aim a little UNDER each budget, never at or over it.
- Match the AMOUNT of text to the budget: a 2000 character body wants full paragraphs of real
  evidence, a 25 character heading wants two or three words.
- When a field is typeset over several lines, EVERY line has its own budget, and a 12 character
  line really does hold about one word. Count each line separately: a two line title of 12 plus 12
  means a two word title, not a four word phrase.
- Do NOT start any line with a dash, asterisk or bullet character; the design adds its own.

AUDIENCE: supplement brand owners, formulators and health professionals. Clinical, credible, B2B.

USING THE SCIENCE (critical):
- Ground everything ONLY in the source material; state study designs, sample sizes and the real
  figures AS GIVEN, and attribute author plus year.
- {CLAIM_RULES}
- {APPROVED_CLAIMS_RULE}
- Never invent studies, numbers or references. Any reference list must match your inline citations.

LANGUAGE: if the user context names an output language, write ALL text in it; otherwise match the
source. Keep brand names (Superba, Aker BioMarine) as-is.

TEXT STYLE (strict brand rule): NO dash characters anywhere. Never an em dash, en dash or a hyphen
between words; rephrase ("evidence based", "double blind", "Omega 3", "12 week").
{instr}
Write the whitepaper text now via emit_pages."""


def generate_whitepaper_composed(client: anthropic.Anthropic, source_text: str, base_name: str, *,
                                 length: str = "standard", tone: str = "balansert",
                                 instructions: str = "", pages: list[str] | None = None,
                                 on_progress=None) -> dict:
    """Assemble a whitepaper from library pages across the Superba brochures and fill it.

    `pages` overrides the automatic selection (the UI's manual page picker). Returns a dict with
    the `.idml` bytes, preview markdown, page list, and metadata for packaging as a ZIP."""
    from . import idml_library as lib

    def _p(pct, step):
        if on_progress:
            try:
                on_progress(pct, step)
            except Exception:  # noqa: BLE001
                pass

    _p(8, "Reading the source & studies")

    if pages:
        chosen = lib.validate_selection(list(pages), allow_data_pages=True)
        rationale = "Pages chosen manually."
        photo_theme = "keep_designed"
    else:
        _p(18, "Choosing which designed pages to use")
        msg = client.messages.create(
            # 2000 → 8000: the budget covers reasoning as well as the page pick, and running out
            # yields no tool_use block, which the `picked is None` branch below treats as "use the
            # default page set" — the page selection would quietly stop happening.
            model=config.MODEL, max_tokens=8000, system=_selection_system(instructions),
            tools=[{"name": "choose_pages", "description": "Pick the pages to assemble, in order.",
                    "input_schema": lib.build_selection_schema()}],
            tool_choice={"type": "tool", "name": "choose_pages"},
            messages=[{"role": "user", "content": f"SOURCE MATERIAL:\n{source_text}"}],
        )
        picked = next((b.input for b in msg.content
                       if b.type == "tool_use" and isinstance(b.input, dict) and b.input.get("pages")), None)
        if picked is None:
            chosen, rationale = lib.default_selection(), "Fell back to the default page set."
            photo_theme = "keep_designed"
        else:
            allow = bool(re.search(r"grip strength|muscle thickness|WOMAC|knee", source_text, re.I))
            chosen = lib.validate_selection(picked["pages"], allow_data_pages=allow)
            rationale = picked.get("rationale", "")
            photo_theme = picked.get("photo_theme", "keep_designed")

    _p(35, f"Writing text for {len(chosen)} designed pages")
    schema = lib.build_fill_schema(chosen)
    plan = None
    for attempt, budget in enumerate((24000, 32000)):
        with client.messages.stream(
            model=config.MODEL, max_tokens=budget,
            system=_compose_fill_system(instructions, chosen),
            tools=[{"name": "emit_pages", "description": "Write the text for every fillable page.",
                    "input_schema": schema}],
            tool_choice={"type": "tool", "name": "emit_pages"},
            messages=[{"role": "user", "content":
                       f"SOURCE MATERIAL:\n{source_text}\n\nWrite the whitepaper text now."}],
        ) as stream:
            msg = stream.get_final_message()
        candidate = next((b.input for b in msg.content
                          if b.type == "tool_use" and isinstance(b.input, dict)), None)
        if candidate is None:
            raise ValueError("The model did not write the whitepaper (no emit_pages tool call).")
        gaps: list[str] = []
        for pid, page_schema in schema["properties"].items():
            if pid == "running_topic":
                continue
            values = candidate.get(pid)
            if not values:
                gaps.append(pid)
                continue
            gaps += [f"{pid}.{s}" for s in page_schema["properties"] if not values.get(s)]
        if not gaps:
            plan = candidate
            break
        if attempt == 0:
            _p(45, "Filling in the remaining frames")
            continue
        raise ValueError(f"The whitepaper text came back incomplete (stop reason: "
                         f"{msg.stop_reason}; missing: {', '.join(gaps[:8])}).")

    _p(80, "Assembling the InDesign document")
    idml_bytes, images, photos = lib.compose_and_fill(chosen, plan, photo_theme=photo_theme)
    markdown = f"{WP_DISCLAIMER}\n\n{lib.plan_to_markdown(chosen, plan)}"
    first = next((p for p in chosen if (plan.get(p) or {}).get("title")), None)
    title = ((plan.get(first) or {}).get("title") if first else None) or base_name
    _p(95, "Packaging")
    return {"idml": idml_bytes, "plan": plan, "markdown": markdown, "pages": chosen,
            "rationale": rationale, "images": sorted(images), "photos": photos,
            "filename": f"{base_name}.idml", "title": title}
