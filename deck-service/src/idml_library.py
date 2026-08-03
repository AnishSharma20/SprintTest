"""Composed whitepapers — pick designed pages from the library, then fill them.

Two stages, mirroring the deck pipeline (plan -> validate -> render):

  1. SELECT  Claude chooses an ordered set of page ids from config/idml_pages.json. The choice is
             then repaired deterministically by `validate_selection()`, so a sloppy pick can never
             produce a malformed document (exactly one cover first, a closing last, no duplicates,
             no data-bound page unless the source really carries that data).
  2. FILL    A forced-tool schema is generated from just the chosen pages' slot maps, Claude writes
             the text, and `idml.fill_idml`-style line mapping pours it into the composed package.

The user may override stage 1 entirely by passing explicit page ids.
"""
from __future__ import annotations

import functools
import io
import json
import re
import zipfile
from pathlib import Path

from . import config, idml
from .idml_compose import Composition, PageRef, compose

PAGES_PATH = config.CONFIG_DIR / "idml_pages.json"


@functools.lru_cache(maxsize=None)
def load_library() -> dict:
    return json.loads(PAGES_PATH.read_text(encoding="utf-8"))


def pages_by_id() -> dict[str, dict]:
    return {p["id"]: p for p in load_library()["pages"]}


def templates() -> dict[str, Path]:
    return {k: (config.ROOT / v) for k, v in load_library()["templates"].items()}


def library_summary() -> list[dict]:
    """What the UI needs to offer a manual override."""
    out = []
    for p in load_library()["pages"]:
        out.append({"id": p["id"], "role": p["role"], "theme": p["theme"],
                    "fill": bool(p.get("fill")), "hint": p.get("hint", ""),
                    "requires_matching_data": bool(p.get("requires_matching_data"))})
    return out


# ---------------------------------------------------------------------------
# Stage 1 — selection
# ---------------------------------------------------------------------------

def build_selection_schema() -> dict:
    lib = pages_by_id()
    described = []
    for pid, p in lib.items():
        bits = [f"{pid} [{p['role']}"]
        if p["theme"] != "any":
            bits.append(f", theme {p['theme']}")
        bits.append("]")
        if not p.get("fill"):
            bits.append(" VERBATIM (kept exactly as designed, you write no text for it)")
        if p.get("requires_matching_data"):
            bits.append(" ONLY if the source reports the muscle/joint trial data its charts show")
        described.append("".join(bits) + f": {p.get('hint', '')}")
    return {
        "type": "object", "additionalProperties": False,
        "required": ["pages", "rationale"],
        "properties": {
            "pages": {
                "type": "array", "minItems": 3, "maxItems": 8,
                "items": {"type": "string", "enum": sorted(lib)},
                "description": ("The pages to assemble, IN ORDER. Rules: start with exactly ONE "
                                "cover; then the body pages; end with a closing page. Include a "
                                "verbatim page only when it genuinely supports the story. Available "
                                "pages:\n" + "\n".join(described)),
            },
            "rationale": {"type": "string", "maxLength": 600,
                          "description": "One or two sentences: why this page set fits the source."},
        },
    }


def validate_selection(page_ids: list[str], *, allow_data_pages: bool = False) -> list[str]:
    """Repair a selection into something structurally sound. Deterministic, never raises."""
    lib = pages_by_id()
    picked = [p for p in dict.fromkeys(page_ids) if p in lib]        # dedupe, drop unknowns

    if not allow_data_pages:
        picked = [p for p in picked if not lib[p].get("requires_matching_data")]

    covers = [p for p in picked if lib[p]["role"] == "cover"]
    body = [p for p in picked if lib[p]["role"] not in ("cover", "closing")]
    closings = [p for p in picked if lib[p]["role"] == "closing"]

    if not covers:
        covers = ["cover_whole_body"]                                # the neutral default cover
    if not closings:
        closings = ["closing_outlook"]

    # A whitepaper must actually SAY something. Verbatim pages (benefit grid, portfolio spread)
    # occupy body positions but carry no generated prose, so require at least one FILLABLE body
    # page — otherwise the document is brochure pages with a cover and a closing bolted on.
    if not any(lib[p].get("fill") for p in body):
        body = ["narrative_four_sections", *body]

    return [covers[0], *body, closings[0]]


def default_selection() -> list[str]:
    return ["cover_whole_body", "narrative_four_sections", "closing_outlook"]


# ---------------------------------------------------------------------------
# Stage 2 — fill schema for the chosen pages
# ---------------------------------------------------------------------------

def build_fill_schema(page_ids: list[str]) -> dict:
    """One object per FILLABLE chosen page, keyed by page id, sized to that page's real frames."""
    lib = pages_by_id()
    props: dict[str, dict] = {}
    for pid in page_ids:
        page = lib[pid]
        if not page.get("fill"):
            continue
        slot_props = {name: idml._slot_schema(slot, _describe(name))          # noqa: SLF001
                      for name, slot in page["slots"].items()}
        props[pid] = {"type": "object", "additionalProperties": False,
                      "required": list(slot_props), "properties": slot_props,
                      "description": page.get("hint", "")}
    return {
        "type": "object", "additionalProperties": False,
        "required": list(props),
        "properties": {**props,
                       "running_topic": {"type": "string", "maxLength": 40,
                                         "description": "Two or three words naming the subject area."}},
    }


_ROLE_HINTS = {
    "title": "Main headline of the page.",
    "subtitle": "Supporting line under the headline.",
    "hero": "One or two sentences stating the value proposition.",
    "eyebrow": "Tiny label above the title (e.g. \"Scientific Whitepaper\").",
    "byline": "Who prepared it.",
    "lead": "Opening paragraph that frames the topic.",
    "heading": "Section heading.",
    "body": "Section body. Write full paragraphs of evidence based prose.",
    "outlook_heading": "Short forward looking heading.",
    "outlook_body": "Short closing outlook paragraph.",
    "references": "Numbered reference list matching your inline citations.",
    "conclusion": "Closing summary of the evidence.",
    "conclusion_label": "The word introducing the conclusion.",
}


def _describe(slot_name: str) -> str:
    if slot_name in _ROLE_HINTS:
        return _ROLE_HINTS[slot_name]
    base = re.sub(r"_\d+$", "", slot_name)
    if base in _ROLE_HINTS:
        return _ROLE_HINTS[base]
    if base == "stat_value" or re.fullmatch(r"stat_\d+_value", slot_name):
        return "A short headline figure (e.g. \"60+\"). Use only figures the source supports."
    if re.fullmatch(r"stat_\d+_label", slot_name):
        return "What the figure counts, in a few words."
    return "Text for this frame."


# ---------------------------------------------------------------------------
# Compose + fill
# ---------------------------------------------------------------------------

def compose_and_fill(page_ids: list[str], plan: dict) -> tuple[bytes, set[str]]:
    """Assemble the chosen pages and pour the plan's text into them.

    Every slot of a fillable page is either written or BLANKED, so a page can never ship with the
    brochure's original wording still in it. Verbatim pages are untouched by construction.
    """
    lib = pages_by_id()
    refs = [PageRef(lib[pid]["template"], lib[pid]["spread"]) for pid in page_ids]
    comp: Composition = compose(refs, templates())

    zin = zipfile.ZipFile(io.BytesIO(comp.data))
    changed: dict[str, bytes] = {}

    def fill(story: str, texts: list[str], caps: list[int]) -> None:
        member = f"Stories/Story_{story}.xml"
        if member not in zin.namelist():
            return
        source = changed.get(member) or zin.read(member)
        changed[member] = idml._fill_story_texts(source, texts, caps)      # noqa: SLF001

    for pid in page_ids:
        page = lib[pid]
        if not page.get("fill"):
            continue
        values = plan.get(pid) or {}
        for name, slot in page["slots"].items():
            story = comp.story_id(page["template"], slot["story"])
            caps = [ln["cap"] for ln in slot["lines"]]
            texts = idml._slot_texts(slot, values.get(name))               # noqa: SLF001
            fill(story, texts or [""] * len(caps), caps if texts else [10] * len(caps))

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        names = zin.namelist()
        zout.writestr(zipfile.ZipInfo("mimetype"), zin.read("mimetype"),
                      compress_type=zipfile.ZIP_STORED)
        for name in names:
            if name == "mimetype":
                continue
            zout.writestr(name, changed.get(name, zin.read(name)))
    return out.getvalue(), comp.images


def plan_to_markdown(page_ids: list[str], plan: dict) -> str:
    """Plain text preview of the composed whitepaper (shipped next to the .idml)."""
    from .blog import strip_dashes
    lib = pages_by_id()
    parts: list[str] = []
    for pid in page_ids:
        page = lib[pid]
        if not page.get("fill"):
            parts.append(f"## [{page['role']}: {pid} — kept exactly as designed]")
            continue
        values = plan.get(pid) or {}
        for name, slot in page["slots"].items():
            val = values.get(name)
            if not val:
                continue
            text = "\n\n".join(val) if isinstance(val, list) else str(val)
            if name in ("title",):
                parts.append(f"# {text}")
            elif name.startswith("heading") or name in ("eyebrow", "subtitle", "outlook_heading"):
                parts.append(f"## {text}")
            else:
                parts.append(text)
    return strip_dashes("\n\n".join(p for p in parts if p.strip()))
