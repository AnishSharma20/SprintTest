"""Superba Deck Generator — HTTP service (FastAPI).

Thin layer over the two-stage pipeline in `src`: Claude plans a schema-validated slide
plan, python-pptx fills the real Superba template (all design inherited). One summary
returns a .pptx; several return a .zip that also bundles each deck's wording-review doc.

  POST /jobs             multipart "filer" (1+ summaries) -> {job_id}; runs in background
  GET  /jobs/{id}        -> {status, progress, step, filename, error}
  GET  /jobs/{id}/result -> the .pptx (or .zip) once done
  POST /generate         synchronous single request (legacy convenience)
  GET  /health           readiness probe

ANTHROPIC_API_KEY is read from the environment, server-side only.
"""
from __future__ import annotations

import io
import json
import os
import re
import threading
import time
import unicodedata
import uuid
import zipfile

import anthropic
from fastapi import FastAPI, Form, Header, UploadFile
from fastapi.responses import JSONResponse, Response

import src
from src import config

app = FastAPI(title="Superba Deck Generator")

PPTX_MEDIA = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
DOCX_MEDIA = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

# Member names inside the delivered zip. Deliberately SHORT and FIXED: Windows Explorer names the
# extraction folder after the zip, so repeating the topic in every member name put it in the path
# twice and tipped Explorer into "the target path is too long" even well under its 260 character
# limit. The folder already says what the document is about, and the designer saves under their own
# name anyway.
_IDML_MEMBER = "whitepaper.idml"
_PREVIEW_MEMBER = "whitepaper.preview.md"


def _mix_readme(pages: list[str], rationale: str, images: list[str],
                photos: dict | None = None) -> str:
    """Designer note for a COMPOSED whitepaper. Images are linked, and a composed document can pull
    pages from more than one brochure, so it may need Links from several of the original packages —
    which the design team already has. We cannot ship them (they run to hundreds of MB)."""
    return (
        "Superba whitepaper, composed from several Superba brochures\n"
        "===========================================================\n\n"
        f"Pages used, in order:\n" + "".join(f"  {i}. {p}\n" for i, p in enumerate(pages, 1)) +
        (f"\nWhy these pages: {rationale}\n" if rationale else "") +
        "\nEach page keeps the exact design it was drawn with. Pages marked verbatim in the tool\n"
        "(the benefit grid, the ingredient and portfolio spread) are placed unchanged because their\n"
        "icons and figures are brand facts.\n\n"
        "TO OPEN\n"
        "  1. Keep the Links folder next to the .idml, then open the .idml in InDesign\n"
        "     (File > Open). Every image this document uses is in that folder and the links point\n"
        "     at it, so the pictures come with the document.\n"
        "  2. If InDesign still reports missing links: an .idml opens as an UNTITLED document, so\n"
        "     save it once (File > Save As, into this same folder), then Window > Links > panel\n"
        "     menu > Relink to Folder and choose Links. That resolves all of them in one go.\n"
        "  3. Fonts: Manrope, Exo 2, Montserrat.\n"
        "  4. Review every page, then export to PDF.\n\n"
        "AI GENERATED DRAFT. Review all content, claims and figures before any use.\n\n"
        + _photo_note(photos) + _links_note(photos)
    )


def _links_note(photos: dict | None) -> str:
    """What is in the Links folder, and the few assets we genuinely cannot supply."""
    if not photos:
        return ""
    bundled = photos.get("bundle") or []
    unresolved = photos.get("unresolved") or []
    out = f"IMAGES INCLUDED IN Links ({len(bundled)}):\n" + "".join(f"  {n}\n" for n in bundled)
    if unresolved:
        out += (f"\nNOT INCLUDED ({len(unresolved)}). These are missing from the source package the\n"
                "design team supplied, so we have no file to send. They will show as missing links;\n"
                "please drop the originals into Links, or delete the frames:\n"
                + "".join(f"  {n}\n" for n in unresolved))
    return out


def _photo_note(photos: dict | None) -> str:
    """Tell the designer which photographs were substituted and which were deliberately kept.

    A frame keeps its original photograph when our library cannot fill it at print resolution, and
    saying so beats leaving the designer to wonder why some pictures changed and others did not.
    """
    if not photos:
        return ""
    lines = [f"PHOTOGRAPHS (subject: {photos.get('theme') or 'kept as designed'})\n"]
    for r in photos.get("replaced", []):
        lines.append(f"  replaced on {r['page']}: {r['file']} (bundled in Links)\n")
    for k in photos.get("kept", []):
        lines.append(f"  kept the designed photo on {k['page']}: {k['reason']}\n")
    return "".join(lines) + "\n" if len(lines) > 1 else ""


def _read_summary(name: str, data: bytes) -> str:
    if name.lower().endswith(".docx"):
        import docx  # python-docx
        return "\n".join(p.text for p in docx.Document(io.BytesIO(data)).paragraphs)
    return data.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Async jobs. Generation takes longer than a proxy/gateway will hold a connection,
# so it runs in a background thread reporting progress into an in-memory store; the
# client POSTs to start, polls status, then downloads. Single-worker 1-user MVP.
# ---------------------------------------------------------------------------
JOBS: dict[str, dict] = {}
JOB_TTL_SECONDS = 3600


def _prune_jobs() -> None:
    now = time.time()
    for jid in [k for k, v in JOBS.items() if now - v.get("created", now) > JOB_TTL_SECONDS]:
        JOBS.pop(jid, None)


# Letters NFKD cannot fold, because they are distinct letters rather than base + combining mark.
# Without this, a Norwegian title loses them outright: "øker" would slug to "ker".
_TRANSLIT = str.maketrans({
    "ø": "o", "Ø": "O", "æ": "ae", "Æ": "AE", "å": "a", "Å": "A",
    "ß": "ss", "þ": "th", "Þ": "Th", "ð": "d", "Ð": "D",
    "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "œ": "oe", "Œ": "OE",
})


def _slug(text: str, limit: int = 60) -> str:
    """A filesystem-safe ASCII stem from a GENERATED title, so a download is named after its topic
    instead of the source file (picking studies always produced "Selected-scientific-studies").

    ASCII-only on purpose: Content-Disposition here carries a plain `filename="..."`, and non-ASCII
    there is mangled by some clients. Nordic letters are transliterated and accents folded
    (Omega-3 nivået øker -> Omega-3-nivaet-oker); a title with no usable ASCII at all (e.g. fully
    CJK) yields "" so the caller falls back to the source-file base name.
    """
    s = (text or "").translate(_TRANSLIT)
    s = unicodedata.normalize("NFKD", s)
    s = s.encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^A-Za-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    if len(s) <= limit:
        return s
    # Cut on a word boundary. Chopping mid-word ("...-The-Kri") looks like a corrupted download,
    # and the stem also becomes the folder Windows extracts into, so shorter genuinely matters.
    cut = s[:limit]
    boundary = cut.rfind("-")
    return (cut[:boundary] if boundary > limit // 2 else cut).rstrip("-")


def _run_job(job_id: str, key: str, files: list[tuple[str, bytes]], lengde: str, tone: str,
             kvalitet: str = "fast", instruksjoner: str = "", innholdstype: str = "deck",
             sprak: str = "English", sider: str = "", study_meta: str = "",
             custom_rules: str = "", disabled_layouts: str = "") -> None:
    try:
        client = anthropic.Anthropic(api_key=key)

        # Output language is threaded to the planner/blog as a high-priority instruction so the user
        # can pick ANY language; it overrides the "match the source language" default.
        #
        # The rule BRACKETS the user's own text — stated before it AND restated after it as the final
        # word. Putting it only in front lost to recency: an instruction like "a whitepaper for the
        # german audience" made the model write the whole document in German even with English picked,
        # because it read "german audience" last and treated audience as language. The closing rule
        # therefore names that exact confusion and separates WHO reads it from WHAT language it is in.
        lang = (sprak or "").strip()
        if lang:
            user_text = (instruksjoner or "").strip()
            instruksjoner = (
                f"OUTPUT LANGUAGE: {lang}. Write ALL reader-facing text in {lang}, regardless of the "
                f"language of the source material.\n\n"
                "USER INSTRUCTIONS (follow these, except that they can NEVER change the output "
                "language):\n\"\"\"\n" + (user_text or "(none)") + "\n\"\"\"\n\n"
                f"FINAL LANGUAGE RULE — this overrides everything above. Write ALL reader-facing text "
                f"in {lang}. If the instructions mention a country, market, region, nationality or "
                f"audience (for example a German audience, the DACH market, Japanese buyers), that "
                f"tells you WHO will read it and WHAT to emphasise for them — it does NOT change the "
                f"language. Do NOT translate the output into that audience's language. The ONLY thing "
                f"that sets the language is this rule: {lang}. Keep brand names (Superba, Aker "
                f"BioMarine) and study citations intact."
            )

        if innholdstype in ("blog", "whitepaper_mix"):
            # One long-form asset from ALL sources combined (files + picked study summaries).
            parts = [t for (fname, data) in files if (t := _read_summary(fname, data).strip())]
            source = "\n\n".join(parts)
            if not source:
                raise ValueError("No text found in the provided files/studies.")
            base = (files[0][0] if files else innholdstype).rsplit(".", 1)[0] or innholdstype

            if innholdstype == "whitepaper_mix":
                # Assembled from designed pages across SEVERAL Superba brochures, then filled.
                b = src.generate_whitepaper_composed(
                    client, source, base, length=lengde, tone=tone, instructions=instruksjoner,
                    pages=[p for p in (sider or "").split(",") if p.strip()],
                    on_progress=lambda p, s: JOBS[job_id].update(progress=p, step=s))
                stem = _slug(b.get("title", ""), 24) or base
                zbuf = io.BytesIO()
                with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
                    z.writestr(_IDML_MEMBER, b["idml"])
                    z.writestr(_PREVIEW_MEMBER, b["markdown"])
                    z.writestr("OPEN_IN_INDESIGN.txt",
                               _mix_readme(b["pages"], b["rationale"], b["images"],
                                           b.get("photos")))
                    # EVERY image the document links travels with it, not just the photos we
                    # swapped. Shipping only the swapped ones left the recipient with 11 of 16
                    # frames empty, and the links still pointed at a designer's own machine.
                    from src.idml_images import shipped_asset
                    for name in (b.get("photos") or {}).get("bundle", []):
                        asset = shipped_asset(name)
                        if asset:
                            z.writestr(f"Links/{name}", asset.read_bytes())
                JOBS[job_id].update(status="done", progress=100, step="Done",
                                    result=zbuf.getvalue(), media_type="application/zip",
                                    filename=stem + ".zip")
                return

            b = src.generate_blog(client, source, base, length=lengde, tone=tone, instructions=instruksjoner,
                                  on_progress=lambda p, s: JOBS[job_id].update(progress=p, step=s))
            stem = _slug(b.get("title", "")) or base
            JOBS[job_id].update(status="done", progress=100, step="Done",
                                result=b["markdown"].encode("utf-8"),
                                media_type="text/markdown; charset=utf-8", filename=stem + ".md")
            return

        # Only the synthesized "picked studies" file (byggKilder() in the frontend) carries a PMID
        # for each source - a raw uploaded doc has none, so the appendix only ever attaches to that
        # one deck, not to every deck in a multi-file batch.
        try:
            parsed_study_meta = json.loads(study_meta) if study_meta else []
        except Exception:  # noqa: BLE001 — malformed input is never worth failing the whole job over
            parsed_study_meta = []

        decks: list[dict] = []
        total = len(files)
        for k, (fname, data) in enumerate(files):
            text = _read_summary(fname, data).strip()
            if not text:
                raise ValueError(f"No text found in {fname}.")
            base = (fname or f"deck-{k + 1}").rsplit(".", 1)[0]

            def on_prog(pct, step, k=k):
                overall = int((k * 100 + pct) / total)
                JOBS[job_id].update(progress=overall,
                                    step=(f"Deck {k + 1}/{total}: {step}" if total > 1 else step))

            this_study_meta = parsed_study_meta if fname == "Selected-scientific-studies.txt" else None
            decks.append(src.generate(client, text, base, length=lengde, tone=tone,
                                       quality=kvalitet, instructions=instruksjoner, on_progress=on_prog,
                                       study_meta=this_study_meta, custom_rules=custom_rules,
                                       disabled_layouts=[d.strip() for d in disabled_layouts.split(",")
                                                         if d.strip()]))

        # Name each deck after its own generated deck_title (the topic), falling back to the source
        # file stem when the title yields no usable ASCII.
        def deck_stem(d: dict) -> str:
            return _slug((d.get("plan") or {}).get("deck_title", "")) or d["filename"].rsplit(".", 1)[0]

        if len(decks) == 1:
            d = decks[0]
            result, media, filename = d["pptx"], PPTX_MEDIA, deck_stem(d) + ".pptx"
        else:
            zbuf = io.BytesIO()
            with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
                seen: set[str] = set()
                for d in decks:
                    stem = deck_stem(d)
                    if stem in seen:                      # two decks can share a title
                        n = 2
                        while f"{stem}-{n}" in seen:
                            n += 1
                        stem = f"{stem}-{n}"
                    seen.add(stem)
                    z.writestr(stem + ".pptx", d["pptx"])
                    z.writestr(stem + ".wording.md", d["wording_md"])
            result, media, filename = zbuf.getvalue(), "application/zip", "superba-decks.zip"

        JOBS[job_id].update(status="done", progress=100, step="Done",
                            result=result, media_type=media, filename=filename)
    except Exception as e:  # noqa: BLE001 — record the failure for the client to read
        JOBS[job_id].update(status="error", step="Failed", error=str(e))


def _auth_or_error(x_deck_token):
    expected = os.environ.get("DECK_SERVICE_TOKEN")
    if expected and x_deck_token != expected:
        return JSONResponse({"feil": "Unauthorized."}, status_code=401)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return JSONResponse({"feil": "Missing ANTHROPIC_API_KEY on the server."}, status_code=500)
    return None


@app.get("/health")
def health():
    try:
        layouts = len(config.catalog())
        template = config.template_path().exists()
    except Exception:  # noqa: BLE001
        layouts, template = 0, False
    return {"ok": True, "layouts": layouts, "template": template, "model": config.MODEL}


@app.post("/generate")
async def generate(
    filer: list[UploadFile],
    lengde: str = Form(default="standard"),
    tone: str = Form(default="balansert"),
    x_deck_token: str | None = Header(default=None),
):
    err = _auth_or_error(x_deck_token)
    if err:
        return err
    if not filer:
        return JSONResponse({"feil": "No files uploaded."}, status_code=400)

    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    try:
        decks = []
        for i, uf in enumerate(filer):
            data = await uf.read()
            text = _read_summary(uf.filename or f"summary-{i}", data).strip()
            if not text:
                return JSONResponse({"feil": f"No text found in {uf.filename}."}, status_code=400)
            base = (uf.filename or f"deck-{i + 1}").rsplit(".", 1)[0]
            decks.append(src.generate(client, text, base, length=lengde, tone=tone))

        if len(decks) == 1:
            d = decks[0]
            return Response(content=d["pptx"], media_type=PPTX_MEDIA,
                            headers={"Content-Disposition": f'attachment; filename="{d["filename"]}"'})

        zbuf = io.BytesIO()
        with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
            for d in decks:
                z.writestr(d["filename"], d["pptx"])
                z.writestr(d["filename"].rsplit(".", 1)[0] + ".wording.md", d["wording_md"])
        return Response(content=zbuf.getvalue(), media_type="application/zip",
                        headers={"Content-Disposition": 'attachment; filename="superba-decks.zip"'})
    except Exception as e:  # noqa: BLE001 — surface a clean error to the client
        return JSONResponse({"feil": f"Generation failed: {e}"}, status_code=500)


@app.post("/jobs")
async def create_job(
    filer: list[UploadFile],
    lengde: str = Form(default="standard"),
    tone: str = Form(default="balansert"),
    kvalitet: str = Form(default="fast"),
    instruksjoner: str = Form(default=""),
    innholdstype: str = Form(default="deck"),
    sprak: str = Form(default="English"),
    sider: str = Form(default=""),
    study_meta: str = Form(default=""),
    custom_rules: str = Form(default=""),
    disabled_layouts: str = Form(default=""),
    x_deck_token: str | None = Header(default=None),
):
    """Start a deck-generation job in the background and return its id immediately.

    kvalitet: "fast" (default) or "polished" (adds a visual QA pass — needs a rasteriser on the
    server, i.e. LibreOffice installed; degrades to fast if absent).
    sprak: output language for the generated text (any language; defaults to English).
    study_meta: JSON array of {pmid, cite} for the picked studies, so a deck can append an
    appendix of those studies' real charts/tables (see extract_figures.py); ignored for
    non-deck content types.
    custom_rules: the team's standing generation rules from the tool's About page (newline
    separated text), injected into the deck planner's prompt; deck only.
    disabled_layouts: comma separated layout keys turned OFF on the About page — removed from
    the planner's vocabulary and schema so the model cannot pick them; deck only."""
    err = _auth_or_error(x_deck_token)
    if err:
        return err
    if not filer:
        return JSONResponse({"feil": "No files uploaded."}, status_code=400)

    _prune_jobs()
    files = [((uf.filename or f"summary-{i}"), await uf.read()) for i, uf in enumerate(filer)]
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {"status": "running", "progress": 0, "step": "Starting", "created": time.time()}
    key = os.environ["ANTHROPIC_API_KEY"]
    threading.Thread(target=_run_job,
                     args=(job_id, key, files, lengde, tone, kvalitet, instruksjoner, innholdstype,
                           sprak, sider, study_meta, custom_rules, disabled_layouts),
                     daemon=True).start()
    return {"job_id": job_id}


@app.get("/idml/pages")
def idml_pages():
    """The composable page library, so the UI can offer a manual page override."""
    try:
        return {"pages": src.idml_page_library()}
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"feil": f"Page library unavailable: {e}"}, status_code=500)


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    j = JOBS.get(job_id)
    if not j:
        return JSONResponse({"feil": "Unknown or expired job."}, status_code=404)
    return {"status": j["status"], "progress": j.get("progress", 0),
            "step": j.get("step", ""), "filename": j.get("filename"), "error": j.get("error")}


@app.get("/jobs/{job_id}/result")
def job_result(job_id: str):
    """Repeatable, not one-shot: the frontend keeps this URL around as a plain clickable link (so a
    non-technical user can re-open their deck without hunting through a downloads folder), so it must
    survive more than one GET. The bytes still go away eventually via _prune_jobs()'s JOB_TTL_SECONDS
    (1h), same as any other job."""
    j = JOBS.get(job_id)
    if not j:
        return JSONResponse({"feil": "Unknown or expired job."}, status_code=404)
    if j.get("status") != "done":
        return JSONResponse({"feil": f"Job is {j.get('status')}, not ready."}, status_code=409)
    data, media, filename = j["result"], j["media_type"], j["filename"]
    return Response(content=data, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.post("/blog/docx")
def blog_docx(
    markdown: str = Form(...),
    filename: str = Form(default="superba-blog-draft"),
    x_deck_token: str | None = Header(default=None),
):
    """Convert a (possibly edited) Markdown blog draft to a Word .docx. Pure conversion, no LLM —
    lets the frontend hand back the reviewed draft and get the Word deliverable back."""
    expected = os.environ.get("DECK_SERVICE_TOKEN")
    if expected and x_deck_token != expected:
        return JSONResponse({"feil": "Unauthorized."}, status_code=401)
    if not (markdown or "").strip():
        return JSONResponse({"feil": "No markdown provided."}, status_code=400)
    name = (filename or "superba-blog-draft").rsplit(".", 1)[0] + ".docx"
    data = src.markdown_to_docx(markdown)
    return Response(content=data, media_type=DOCX_MEDIA,
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})
