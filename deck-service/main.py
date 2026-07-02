"""Superba Deck Generator — HTTP service.

Thin FastAPI layer: authenticate, read uploaded summaries, and hand each to the
``deckgen`` pipeline (Claude plans a sales deck; python-pptx draws it on-brand). One
summary returns a .pptx; several return a .zip that also bundles the per-deck
Science-review wording document. All generation logic lives in the ``deckgen`` package.

  POST /generate   multipart, field "filer", one or more summary files
  GET  /health     readiness probe

The Anthropic API key is read from ANTHROPIC_API_KEY (server-side only).
"""
from __future__ import annotations

import io
import os
import threading
import time
import uuid
import zipfile

import anthropic
from fastapi import FastAPI, Form, Header, UploadFile
from fastapi.responses import JSONResponse, Response

from deckgen import DeckResult, generate_deck
from deckgen.layouts import LAYOUTS
import svcgen

app = FastAPI(title="Superba Deck Generator")

# Which renderer to use. "svg" = the AKBM-native hybrid SVG pipeline (frozen hero
# templates + generated body slides + charts + quality gate). "pptx" = the legacy
# python-pptx direct renderer. Default to the hybrid.
PIPELINE = os.environ.get("DECK_PIPELINE", "svg")


def _build_deck(client, text: str, base: str, *, length: str, tone: str, on_progress=None) -> DeckResult:
    if PIPELINE == "svg":
        r = svcgen.generate(client, text, base, length=length, tone=tone, on_progress=on_progress)
        return DeckResult(pptx=r["pptx"], filename=r["filename"],
                          wording_md=r["wording_md"], slide_count=r["slide_count"])
    return generate_deck(client, text, base, length=length, tone=tone)


# ---------------------------------------------------------------------------
# Async jobs. A full deck takes 1-3 minutes — longer than an HTTP proxy / gateway
# will hold a connection (the frontend was hitting 504). So generation runs in a
# background thread that reports progress into an in-memory store; the client
# POSTs to start a job, polls status, then downloads the result. Single-worker
# 1-user MVP, so an in-process dict is enough (no Redis/queue).
# ---------------------------------------------------------------------------
JOBS: dict[str, dict] = {}
JOB_TTL_SECONDS = 3600


def _prune_jobs() -> None:
    now = time.time()
    for jid in [k for k, v in JOBS.items() if now - v.get("created", now) > JOB_TTL_SECONDS]:
        JOBS.pop(jid, None)


def _run_job(job_id: str, key: str, files: list[tuple[str, bytes]], lengde: str, tone: str) -> None:
    try:
        client = anthropic.Anthropic(api_key=key)
        decks: list[DeckResult] = []
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

            decks.append(_build_deck(client, text, base, length=lengde, tone=tone, on_progress=on_prog))

        if len(decks) == 1:
            d = decks[0]
            result, media, filename = d.pptx, PPTX_MEDIA, d.filename
        else:
            zbuf = io.BytesIO()
            with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
                for d in decks:
                    z.writestr(d.filename, d.pptx)
                    z.writestr(d.filename.rsplit(".", 1)[0] + ".wording.md", d.wording_md)
            result, media, filename = zbuf.getvalue(), "application/zip", "superba-decks.zip"

        JOBS[job_id].update(status="done", progress=100, step="Done",
                            result=result, media_type=media, filename=filename)
    except Exception as e:  # noqa: BLE001 — record the failure for the client to read
        JOBS[job_id].update(status="error", step="Failed", error=str(e))

PPTX_MEDIA = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def _read_summary(name: str, data: bytes) -> str:
    if name.lower().endswith(".docx"):
        import docx  # python-docx
        document = docx.Document(io.BytesIO(data))
        return "\n".join(p.text for p in document.paragraphs)
    return data.decode("utf-8", errors="replace")


@app.get("/health")
def health():
    return {"ok": True, "layouts": len(LAYOUTS)}


@app.post("/generate")
async def generate(
    filer: list[UploadFile],
    lengde: str = Form(default="standard"),
    tone: str = Form(default="balansert"),
    x_deck_token: str | None = Header(default=None),
):
    # Optional shared secret: if the service has DECK_SERVICE_TOKEN set, callers must
    # send the same value in X-Deck-Token. Blocks public abuse.
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
        decks: list[DeckResult] = []
        for i, uf in enumerate(filer):
            data = await uf.read()
            text = _read_summary(uf.filename or f"summary-{i}", data).strip()
            if not text:
                return JSONResponse({"feil": f"No text found in {uf.filename}."}, status_code=400)
            base = (uf.filename or f"deck-{i + 1}").rsplit(".", 1)[0]
            decks.append(_build_deck(client, text, base, length=lengde, tone=tone))

        if len(decks) == 1:
            d = decks[0]
            return Response(
                content=d.pptx,
                media_type=PPTX_MEDIA,
                headers={"Content-Disposition": f'attachment; filename="{d.filename}"'},
            )

        # Several summaries -> a zip of decks plus their wording documents.
        zbuf = io.BytesIO()
        with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
            for d in decks:
                z.writestr(d.filename, d.pptx)
                z.writestr(d.filename.rsplit(".", 1)[0] + ".wording.md", d.wording_md)
        return Response(
            content=zbuf.getvalue(),
            media_type="application/zip",
            headers={"Content-Disposition": 'attachment; filename="superba-decks.zip"'},
        )
    except Exception as e:  # noqa: BLE001 — surface a clean error to the client
        return JSONResponse({"feil": f"Generation failed: {e}"}, status_code=500)


@app.post("/jobs")
async def create_job(
    filer: list[UploadFile],
    lengde: str = Form(default="standard"),
    tone: str = Form(default="balansert"),
    x_deck_token: str | None = Header(default=None),
):
    """Start a deck-generation job in the background and return its id immediately."""
    expected = os.environ.get("DECK_SERVICE_TOKEN")
    if expected and x_deck_token != expected:
        return JSONResponse({"feil": "Unauthorized."}, status_code=401)
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return JSONResponse({"feil": "Missing ANTHROPIC_API_KEY on the server."}, status_code=500)
    if not filer:
        return JSONResponse({"feil": "No files uploaded."}, status_code=400)

    _prune_jobs()
    # Read the uploads here (can't await inside the worker thread), then hand off.
    files = [((uf.filename or f"summary-{i}"), await uf.read()) for i, uf in enumerate(filer)]
    job_id = uuid.uuid4().hex
    JOBS[job_id] = {"status": "running", "progress": 0, "step": "Starting", "created": time.time()}
    threading.Thread(target=_run_job, args=(job_id, key, files, lengde, tone), daemon=True).start()
    return {"job_id": job_id}


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    j = JOBS.get(job_id)
    if not j:
        return JSONResponse({"feil": "Unknown or expired job."}, status_code=404)
    return {"status": j["status"], "progress": j.get("progress", 0),
            "step": j.get("step", ""), "filename": j.get("filename"), "error": j.get("error")}


@app.get("/jobs/{job_id}/result")
def job_result(job_id: str):
    j = JOBS.get(job_id)
    if not j:
        return JSONResponse({"feil": "Unknown or expired job."}, status_code=404)
    if j.get("status") != "done":
        return JSONResponse({"feil": f"Job is {j.get('status')}, not ready."}, status_code=409)
    data, media, filename = j["result"], j["media_type"], j["filename"]
    JOBS.pop(job_id, None)  # one-shot download frees the in-memory bytes
    return Response(content=data, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})
