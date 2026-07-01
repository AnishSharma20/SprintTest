"""
Superba Deck Generator — Python service (Option B).

POST /generate  (multipart, field name "filer", one or more files)
  summary file(s) -> Claude emits a template_fill_pptx_plan.v1 fill plan against
  the analyzed Superba slide library -> check-plan (capacity) -> apply -> native
  .pptx. One summary returns a .pptx; several return a .zip.

The Anthropic API key is read from ANTHROPIC_API_KEY (server-side only).
"""
from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import anthropic
from fastapi import FastAPI, Header, UploadFile
from fastapi.responses import JSONResponse, Response

BASE = Path(__file__).resolve().parent
ASSETS = BASE / "assets"
TEMPLATE = ASSETS / "Superba_refresh_power_point_template.pptx"
LIBRARY = ASSETS / "Superba.slide_library.json"
RUN_PY = BASE / "ppt_master" / "run.py"
MODEL = "claude-sonnet-4-6"

app = FastAPI(title="Superba Deck Generator")

# ---- Fill-plan schema (mirrors app/lib/deck.ts) --------------------------------
FILL_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "slides": {
            "type": "array",
            "description": "Ordered output slides; each reuses one source slide and fills its text slots.",
            "items": {
                "type": "object",
                "properties": {
                    "source_slide": {"type": "integer", "description": "1-based source slide index from the library."},
                    "purpose": {"type": "string", "description": "cover / chapter / content / ending."},
                    "layout_rationale": {
                        "type": "object",
                        "properties": {
                            "layout_pattern": {"type": "string"},
                            "why_fit": {"type": "string"},
                            "risk": {"type": "string"},
                        },
                        "required": ["layout_pattern", "why_fit", "risk"],
                    },
                    "replacements": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "slot_id": {"type": "string", "description": "Exact slot_id that exists on this source_slide."},
                                "text": {"type": "string", "description": "Replacement text; concise, must fit the slot."},
                            },
                            "required": ["slot_id", "text"],
                        },
                    },
                },
                "required": ["source_slide", "purpose", "layout_rationale", "replacements"],
            },
        }
    },
    "required": ["slides"],
}

# prompt.py hard rules verbatim; STRUCTURE adapted to the fill-plan workflow.
SYSTEM_PROMPT = """You convert a verified Superba Krill science summary into a slide-fill plan for a branded PowerPoint template. You output ONLY via the emit_fill_plan tool (forced JSON). You never write free text.

BRAND VOICE
- Superba Krill by Aker BioMarine: premium krill oil, marine phospholipid omega-3s (EPA/DHA), choline, astaxanthin.
- Confident, science-led, clean. No hype, no superlatives that the summary does not support.

HARD CONSTRAINTS (non-negotiable)
1. Every claim must trace to the input summary. If the summary does not state it, you do not write it. Do not fill gaps with plausible-sounding benefits.
2. Null and negative results are carried through honestly, never dropped. If a study found no effect on an endpoint, that is content, not something to hide.
3. EFSA-approved claims: only state an EFSA claim as approved when the summary explicitly says so (in the Superba portfolio only Heart and Liver carry EFSA-approved claims). Never imply approval otherwise.
4. Citations are taken verbatim-ish from the summary (author, journal, year) if provided. If the summary gives no citation, do not add one. NEVER invent a citation, journal, or year.
5. Trial counts come from the summary. If the summary does not state a count, do not state one.
6. Keep replacement text short enough to fit the slot — titles are short lines, labels are short phrases. A capacity check runs after you; overflow is rejected.

STRUCTURE (fill-plan workflow)
- You are given a SLIDE LIBRARY, one line per source slide: "#<index> [<page_type>] <slot_id> (<role>), ...". The slot_id is the exact token BEFORE the parenthesis (e.g. "s04_sh3"); the role in parentheses (title / label / body) is only guidance — never include it in slot_id.
- Build the deck by choosing source slides in a sensible order and filling their slots:
  - Open with the cover_candidate slide (deck title + subtitle).
  - Use chapter_candidate slides as section dividers (short titles).
  - Use content_candidate slides for benefit claims and evidence.
  - Close with the ending_candidate slide.
- In each slide's replacements, use ONLY slot_ids listed for that exact source_slide. Do not invent slot_ids or borrow from other slides.
- Aim for 6-10 slides. Prefer variety of source slides over repeating one layout.

You will receive the science summary and the slide library. Emit the fill plan now."""


def kompakt_bibliotek() -> str:
    full = json.loads(LIBRARY.read_text(encoding="utf-8"))
    lines = []
    for s in full["slides"]:
        slots = ", ".join(
            f"{sl['slot_id']} ({sl['role'].replace('_candidate', '')})"
            for sl in s.get("slots", [])
        )
        lines.append(f"#{s['slide_index']} [{s['page_type'].replace('_candidate', '')}] {slots}")
    return "\n".join(lines)


_LIB_CACHE: str | None = None


def bibliotek() -> str:
    global _LIB_CACHE
    if _LIB_CACHE is None:
        _LIB_CACHE = kompakt_bibliotek()
    return _LIB_CACHE


def les_fil(navn: str, data: bytes) -> str:
    if navn.lower().endswith(".docx"):
        import docx  # python-docx
        d = docx.Document(io.BytesIO(data))
        return "\n".join(p.text for p in d.paragraphs)
    return data.decode("utf-8", errors="replace")


def kjor(args: list[str]) -> subprocess.CompletedProcess:
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    return subprocess.run(
        [sys.executable, str(RUN_PY), *args],
        capture_output=True, text=True, env=env,
    )


def lag_fill_plan(client: anthropic.Anthropic, summary: str, feedback: str = "") -> dict:
    msg = client.messages.create(
        model=MODEL,
        max_tokens=4000,
        system=SYSTEM_PROMPT,
        tools=[{
            "name": "emit_fill_plan",
            "description": "Emit the template fill plan.",
            "input_schema": FILL_PLAN_SCHEMA,
        }],
        tool_choice={"type": "tool", "name": "emit_fill_plan"},
        messages=[{
            "role": "user",
            "content": f"SCIENCE SUMMARY:\n{summary}\n\nSLIDE LIBRARY (choose source slides and only these slot_ids per slide):\n{bibliotek()}{feedback}",
        }],
    )
    for block in msg.content:
        if block.type == "tool_use":
            plan = block.input
            if isinstance(plan, dict) and isinstance(plan.get("slides"), list) and plan["slides"]:
                return plan
    raise ValueError("Claude returned an invalid fill plan.")


def planlegg(client: anthropic.Anthropic, summary: str, tmp: Path, idx: int) -> Path:
    feedback = ""
    for forsok in range(2):
        plan = lag_fill_plan(client, summary, feedback)
        plan_path = tmp / f"plan-{idx}-{forsok}.json"
        plan_path.write_text(json.dumps({
            "schema": "template_fill_pptx_plan.v1",
            "status": "confirmed",
            "source_pptx": str(TEMPLATE),
            "accepted_warnings": [],
            "slides": plan["slides"],
        }), encoding="utf-8")

        chk = kjor(["check-plan", str(LIBRARY), str(plan_path)])
        import re
        m = re.search(r"error=(\d+)", chk.stdout)
        if m and int(m.group(1)) == 0:
            return plan_path
        feedback = f"\n\n(Previous plan had capacity/slot errors: {chk.stdout.strip()[:400]}. Shorten text or use valid slot_ids for the chosen source_slide.)"
    raise ValueError("Could not produce a fitting plan after retry (capacity/slot errors).")


def render_deck(client: anthropic.Anthropic, summary: str, tmp: Path, idx: int) -> bytes:
    plan_path = planlegg(client, summary, tmp, idx)
    out_stem = tmp / f"deck-{idx}.pptx"
    res = kjor(["apply", str(TEMPLATE), str(plan_path), "-o", str(out_stem)])
    if res.returncode != 0:
        raise RuntimeError(f"Renderer failed: {(res.stderr or res.stdout)[:400]}")
    produced = next((p for p in tmp.glob(f"deck-{idx}*.pptx")), None)
    if produced is None:
        raise RuntimeError("Renderer produced no output file.")
    return produced.read_bytes()


@app.get("/health")
def health():
    return {"ok": True, "template": TEMPLATE.exists(), "library": LIBRARY.exists()}


@app.post("/generate")
async def generate(filer: list[UploadFile], x_deck_token: str | None = Header(default=None)):
    # Optional shared secret: if the service has DECK_SERVICE_TOKEN set, callers
    # must send the same value in the X-Deck-Token header. Blocks public abuse.
    expected = os.environ.get("DECK_SERVICE_TOKEN")
    if expected and x_deck_token != expected:
        return JSONResponse({"feil": "Unauthorized."}, status_code=401)

    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return JSONResponse({"feil": "Missing ANTHROPIC_API_KEY on the server."}, status_code=500)
    if not filer:
        return JSONResponse({"feil": "No files uploaded."}, status_code=400)

    client = anthropic.Anthropic(api_key=key)
    try:
        with tempfile.TemporaryDirectory(prefix="deckgen-") as td:
            tmp = Path(td)
            decks: list[tuple[str, bytes]] = []
            for i, uf in enumerate(filer):
                data = await uf.read()
                text = les_fil(uf.filename or f"summary-{i}", data).strip()
                if not text:
                    return JSONResponse({"feil": f"No text found in {uf.filename}."}, status_code=400)
                buf = render_deck(client, text, tmp, i)
                base = (uf.filename or f"deck-{i+1}").rsplit(".", 1)[0]
                decks.append((f"{base}.pptx", buf))

            if len(decks) == 1:
                return Response(
                    content=decks[0][1],
                    media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                    headers={"Content-Disposition": f'attachment; filename="{decks[0][0]}"'},
                )
            zbuf = io.BytesIO()
            with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
                for navn, b in decks:
                    z.writestr(navn, b)
            return Response(
                content=zbuf.getvalue(),
                media_type="application/zip",
                headers={"Content-Disposition": 'attachment; filename="superba-decks.zip"'},
            )
    except Exception as e:  # noqa: BLE001 — surface a clean error to the client
        return JSONResponse({"feil": f"Generation failed: {e}"}, status_code=500)
