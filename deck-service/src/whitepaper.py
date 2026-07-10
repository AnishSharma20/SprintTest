"""Whitepaper generator — long-form, science-heavy content in Superba's whitepaper style
(distilled from AKBM's InDesign whitepapers: a hero benefit statement + title, numbered
"Human Clinical Trial Summaries", problem/context and mechanism sections, then references).

Claude emits a STRUCTURED plan via a forced tool call. That plan is rendered to Markdown/Word
now, and — crucially — it is also the exact object that will later fill a Superba .idml template
(SimpleIDML), once the design team provides one. So no rework: `plan` is the single source of truth,
`plan_to_markdown` is today's renderer, and a future `fill_idml(plan, template)` is the only piece
that waits on the .idml file.
"""
from __future__ import annotations

import anthropic

from . import config
from .blog import markdown_to_docx, strip_dashes  # reuse the converter + no-dash net
from .planner import APPROVED_CLAIMS_RULE, CLAIM_RULES

# Whitepapers run long; word bands are per whole document.
WORDS = {"kort": "800–1200", "standard": "1500–2500", "detaljert": "3000–5000"}

# Prepended to every draft (italic note above the title); the reviewer removes it before publishing.
WP_DISCLAIMER = ("*AI generated draft from the source material. Review all content, claims and figures, "
                 "and edit as needed before publishing.*")

# Structured whitepaper the model must emit. Kept semantic (content, not page geometry) so it maps
# cleanly onto named text frames in an .idml template later.
SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["title", "hero_statement", "intro", "trial_summaries", "sections", "references"],
    "properties": {
        "title": {"type": "string", "maxLength": 120},
        "hero_statement": {"type": "string", "maxLength": 300},
        "intro": {"type": "string", "maxLength": 1600},
        "trial_summaries": {
            "type": "array", "minItems": 1, "maxItems": 8,
            "items": {"type": "object", "additionalProperties": False,
                      "required": ["heading", "body"],
                      "properties": {"heading": {"type": "string", "maxLength": 180},
                                     "body": {"type": "string", "maxLength": 2200}}}},
        "sections": {
            "type": "array", "minItems": 1, "maxItems": 8,
            "items": {"type": "object", "additionalProperties": False,
                      "required": ["heading", "body"],
                      "properties": {"heading": {"type": "string", "maxLength": 120},
                                     "body": {"type": "string", "maxLength": 2600}}}},
        "key_benefits": {"type": "array", "maxItems": 8, "items": {"type": "string", "maxLength": 180}},
        "references": {"type": "array", "maxItems": 40, "items": {"type": "string", "maxLength": 400}},
        "cta": {"type": "string", "maxLength": 500},
    },
}


def build_system(length: str, tone: str, instructions: str = "") -> str:
    words = WORDS.get(length, WORDS["standard"])
    instr = ""
    if (instructions or "").strip():
        instr = ("\n\nUSER CONTEXT & INSTRUCTIONS (high-priority guidance on audience, angle, emphasis, "
                 "terminology, what to include/avoid — follow it unless it conflicts with the claim-fidelity "
                 "rules):\n\"\"\"\n" + instructions.strip() + "\n\"\"\"\n")
    return f"""You are a scientific writer for Aker BioMarine's Superba Krill. Produce a STRUCTURED
WHITEPAPER via the emit_whitepaper tool, in the exact style of AKBM's clinical whitepapers, based
ONLY on the source material provided (scientific study summaries and/or documents).

AUDIENCE: supplement brand owners, formulators and health professionals. Clinical, credible,
thoroughly referenced, B2B — heavier and more evidence-dense than a blog.

LENGTH: about {words} words across all sections combined.

WHAT EACH FIELD IS:
- title: a benefit-led whitepaper title (e.g. "Unlock Peak Performance: How Superba Krill Supports Athletes").
- hero_statement: ONE bold sentence stating the value proposition.
- intro: 1 to 2 paragraphs framing the problem, market context or reader need.
- trial_summaries: ONE entry per human clinical trial in the source. heading like "Human Clinical Trial
  Summary: <the finding>"; body states the design (population, n, dose, duration, design), the results WITH
  the real numbers stated in the source (%, effect sizes, p-values), and attributes author + year.
- sections: the supporting narrative — the problem/context, HOW Superba works (phospholipid-bound EPA/DHA,
  choline, astaxanthin, superior absorption), broader benefits, and safety/tolerability. Each is a heading +
  a body. A body may put a few short points on their OWN lines to render as bullets.
- key_benefits (optional): a few very short benefit lines.
- references: numbered list of the studies actually cited (author, year, journal if given).
- cta: a short closing call to action (contact Aker BioMarine / request the data / next steps).

USING THE SCIENCE (critical):
- Ground everything in the studies present in the source; name study types, sample sizes and the real
  figures AS STATED. Attribute with author + year.
- {CLAIM_RULES}
- {APPROVED_CLAIMS_RULE}
- Do NOT invent studies, numbers, quotes or references. If the source is thin on a point, keep it general.

LANGUAGE: if the user context specifies an output language, write the ENTIRE whitepaper in that language;
otherwise match the source language. Keep brand names (Superba, Aker BioMarine) as-is.

TEXT STYLE (strict brand rule): do NOT use dash characters in any field's text. Never an em-dash, an
en-dash, or a hyphen between words; rephrase (e.g. "evidence based", "double blind", "Omega 3", "12 week")
using commas, colons, parentheses or separate words.
{instr}
Emit the whitepaper now via emit_whitepaper."""


def _plan(client: anthropic.Anthropic, source_text: str, length: str, tone: str, instructions: str) -> dict:
    msg = client.messages.create(
        model=config.MODEL, max_tokens=8000, system=build_system(length, tone, instructions),
        tools=[{"name": "emit_whitepaper", "description": "Emit the structured whitepaper.",
                "input_schema": SCHEMA}],
        tool_choice={"type": "tool", "name": "emit_whitepaper"},
        messages=[{"role": "user", "content":
                   f"SOURCE MATERIAL:\n{source_text}\n\nWrite the Superba whitepaper now."}],
    )
    for b in msg.content:
        if b.type == "tool_use" and isinstance(b.input, dict) and b.input.get("title"):
            return b.input
    raise ValueError("The model did not emit a whitepaper (no emit_whitepaper tool call).")


def plan_to_markdown(plan: dict) -> str:
    """Render the structured plan to Markdown (preview + Word). Dash-stripped for the brand rule."""
    parts: list[str] = [f"# {plan.get('title', 'Superba Whitepaper')}"]
    if plan.get("hero_statement"):
        parts.append(f"**{plan['hero_statement']}**")
    if plan.get("intro"):
        parts.append(plan["intro"])

    trials = plan.get("trial_summaries") or []
    if trials:
        parts.append("## Human clinical trial summaries")
        for t in trials:
            if t.get("heading"):
                parts.append(f"### {t['heading']}")
            if t.get("body"):
                parts.append(t["body"])

    for s in plan.get("sections") or []:
        if s.get("heading"):
            parts.append(f"## {s['heading']}")
        if s.get("body"):
            parts.append(s["body"])

    kb = plan.get("key_benefits") or []
    if kb:
        parts.append("## Key benefits")
        parts += [f"- {b}" for b in kb]

    if plan.get("cta"):
        parts.append("## Next steps")
        parts.append(plan["cta"])

    refs = plan.get("references") or []
    if refs:
        parts.append("## References")
        parts += [f"{i}. {r}" for i, r in enumerate(refs, 1)]

    md = "\n\n".join(p for p in parts if p and str(p).strip())
    return strip_dashes(md)


def generate_whitepaper(client: anthropic.Anthropic, source_text: str, base_name: str, *,
                        length: str = "standard", tone: str = "balansert", instructions: str = "",
                        on_progress=None) -> dict:
    def _p(pct, step):
        if on_progress:
            try:
                on_progress(pct, step)
            except Exception:  # noqa: BLE001
                pass

    _p(10, "Reading the source & studies")
    plan = _plan(client, source_text, length, tone, instructions)
    _p(85, "Assembling the whitepaper")
    title = plan.get("title") or base_name
    markdown = f"{WP_DISCLAIMER}\n\n{plan_to_markdown(plan)}"
    # `plan` is returned too: it is the structured object a future fill_idml(plan, template) will use.
    return {"markdown": markdown, "plan": plan, "filename": f"{base_name}.md", "title": title}


def to_docx(plan_or_markdown) -> bytes:
    """Convenience: structured plan OR markdown string -> Word .docx bytes."""
    md = plan_or_markdown if isinstance(plan_or_markdown, str) else plan_to_markdown(plan_or_markdown)
    return markdown_to_docx(md)


# ===========================================================================
# InDesign (.idml) whitepaper — the direct analog of the pptx template-fill.
#
# Instead of the free-form Markdown plan above, the model fills the EXACT slot map of
# AKBM's real Healthy Aging whitepaper (config/idml_manifest.json): a fixed set of
# semantic frames with per-line character budgets measured from the template. src.idml
# then rewrites only the <Content> text of those frames, so the deliverable is a designed
# InDesign document (fonts, gradients, images, EFSA grid, layout all inherited) rather than
# a Word draft. The LLM never emits styling or geometry — same contract as the deck.
# ===========================================================================

def _idml_system(instructions: str, manifest: dict) -> str:
    src_doc = manifest.get("source_document", "an AKBM whitepaper")
    instr = ""
    if (instructions or "").strip():
        instr = ("\n\nUSER CONTEXT & INSTRUCTIONS (high priority — audience, angle, emphasis, "
                 "terminology, output language, what to include/avoid; follow unless it conflicts "
                 "with claim fidelity):\n\"\"\"\n" + instructions.strip() + "\n\"\"\"\n")
    return f"""You are a scientific writer for Aker BioMarine's Superba Krill. Fill a REAL InDesign
whitepaper template via the emit_idml_whitepaper tool. The template is a finished, designed
document ({src_doc}); you are ONLY replacing its text, slot by slot. All design, layout, images,
fonts, the benefits grid and legal text are inherited and INVISIBLE to you.

CRITICAL — this is a template FILL, not free writing:
- Emit EXACTLY the structure the tool schema defines: cover, running_topic, intro, five content
  sections (s1..s5), conclusion, cta. Every field maps to a real text frame.
- RESPECT EVERY maxLength AND the per line budgets in each field's description. The frames are a
  fixed size and CANNOT grow; text over budget is cut. Write to fit, do not fill to overflow.
- Each section has trial-summary CARDS. Emit ONE card per human clinical trial actually present in
  the source, in a sensible order, up to that section's card count. Do NOT invent trials to fill
  empty cards; unused cards are removed cleanly.
- The section "topic" hints describe how the ORIGINAL used each page (heart, cognitive, muscle,
  joint, eye...). Re-theme them to whatever benefit areas the SOURCE actually supports; keep roughly
  the same amount of text per slot.

CARD FIELDS: year_author ("2022 STONEHOUSE"); title (the paper title); design (e.g. "Published
randomized, double blind, placebo controlled trial"); meta (location / time frame / subjects);
findings (key results WITH the real numbers, %s, p-values AS STATED in the source); doses (one line
per study arm, e.g. "Dose: 4 g/day of Krill oil (885 mg EPA, 354 mg DHA)").

USING THE SCIENCE (critical):
- Ground everything ONLY in the source material. Name study types, sample sizes and the real figures.
- {CLAIM_RULES}
- {APPROVED_CLAIMS_RULE}
- Never invent studies, numbers, quotes or references.

LANGUAGE: if the user context specifies an output language, write ALL reader-facing text in it;
otherwise match the source. Keep brand names (Superba, Aker BioMarine) as-is.

TEXT STYLE (strict brand rule): NO dash characters in any field. Never an em dash, en dash or a
hyphen between words; rephrase ("evidence based", "double blind", "Omega 3", "12 week").
{instr}
Fill the whitepaper now via emit_idml_whitepaper."""


def generate_whitepaper_idml(client: anthropic.Anthropic, source_text: str, base_name: str, *,
                             length: str = "standard", tone: str = "balansert",
                             instructions: str = "", on_progress=None) -> dict:
    """Plan-and-fill a real Superba .idml whitepaper. Returns the .idml bytes + a Markdown
    preview + the structured plan (base_name kept for parity with the other generators)."""
    from . import idml as idml_mod

    def _p(pct, step):
        if on_progress:
            try:
                on_progress(pct, step)
            except Exception:  # noqa: BLE001
                pass

    _p(8, "Reading the source & studies")
    manifest = idml_mod.load_manifest()
    schema = idml_mod.build_idml_schema()
    required_sections = list(manifest["groups"]["sections"]["sections"].keys())

    def _missing(plan: dict) -> list[str]:
        """Which required parts of the plan are absent — a whole-document fill must have them
        all. A truncated tool call (hit max_tokens) shows up here as missing tail sections."""
        gaps = [k for k in ("cover", "intro", "sections", "conclusion", "cta") if not plan.get(k)]
        secs = plan.get("sections") or {}
        gaps += [f"sections.{s}" for s in required_sections if not secs.get(s)]
        gaps += [f"sections.{s}.cards" for s in required_sections
                 if secs.get(s) and not (secs[s].get("cards"))]
        return gaps

    # A full whitepaper plan is large (5 sections + up to 16 trial cards). 8k tokens truncates
    # it silently — the tail sections never arrive. Give it real headroom and, if the tool call
    # is still cut short, retry once harder before failing loudly (never ship a partial fill).
    _p(20, "Writing the whitepaper to the template")
    plan = None
    for attempt, budget in enumerate((24000, 32000)):
        # Streaming is required at these token budgets (the SDK refuses a non-streaming request
        # that could run past its 10 minute ceiling); we only need the final assembled message.
        with client.messages.stream(
            model=config.MODEL, max_tokens=budget,
            system=_idml_system(instructions, manifest),
            tools=[{"name": "emit_idml_whitepaper",
                    "description": "Fill every text slot of the Superba InDesign whitepaper template.",
                    "input_schema": schema}],
            tool_choice={"type": "tool", "name": "emit_idml_whitepaper"},
            messages=[{"role": "user", "content":
                       f"SOURCE MATERIAL:\n{source_text}\n\nFill the Superba whitepaper template now."}],
        ) as stream:
            msg = stream.get_final_message()
        candidate = next((b.input for b in msg.content
                          if b.type == "tool_use" and isinstance(b.input, dict) and b.input.get("cover")), None)
        if candidate is None:
            raise ValueError("The model did not fill the whitepaper (no emit_idml_whitepaper tool call).")
        gaps = _missing(candidate)
        if not gaps:
            plan = candidate
            break
        if msg.stop_reason == "max_tokens" and attempt == 0:
            _p(35, "Whitepaper was long, expanding and retrying")
            continue
        raise ValueError(
            "The whitepaper came back incomplete (stop reason: "
            f"{msg.stop_reason}; missing: {', '.join(gaps)}). This usually means the source was "
            "very large for one document. Try again, or generate from fewer studies at a time.")

    _p(80, "Rendering the InDesign document")
    idml_bytes = idml_mod.fill_idml(plan)
    markdown = f"{WP_DISCLAIMER}\n\n{idml_mod.idml_plan_to_markdown(plan)}"
    title = (plan.get("cover") or {}).get("title") or base_name
    _p(95, "Packaging")
    return {"idml": idml_bytes, "plan": plan, "markdown": markdown,
            "filename": f"{base_name}.idml", "title": title}
