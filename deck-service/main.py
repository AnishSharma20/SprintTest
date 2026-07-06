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
import os
import threading
import time
import uuid
import zipfile

import anthropic
from fastapi import FastAPI, Form, Header, UploadFile
from fastapi.responses import JSONResponse, Response

import src
from src import config

app = FastAPI(title="Superba Deck Generator")

PPTX_MEDIA = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


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


def _run_job(job_id: str, key: str, files: list[tuple[str, bytes]], lengde: str, tone: str,
             kvalitet: str = "fast", instruksjoner: str = "", innholdstype: str = "deck") -> None:
    try:
        client = anthropic.Anthropic(api_key=key)

        if innholdstype == "blog":
            # One blog draft from ALL sources combined (files + picked study summaries).
            parts = [t for (fname, data) in files if (t := _read_summary(fname, data).strip())]
            source = "\n\n".join(parts)
            if not source:
                raise ValueError("No text found in the provided files/studies.")
            base = (files[0][0] if files else "blog").rsplit(".", 1)[0] or "blog"
            b = src.generate_blog(client, source, base, length=lengde, tone=tone,
                                  instructions=instruksjoner,
                                  on_progress=lambda p, s: JOBS[job_id].update(progress=p, step=s))
            JOBS[job_id].update(status="done", progress=100, step="Done",
                                result=b["markdown"].encode("utf-8"),
                                media_type="text/markdown; charset=utf-8", filename=b["filename"])
            return

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

            decks.append(src.generate(client, text, base, length=lengde, tone=tone,
                                       quality=kvalitet, instructions=instruksjoner, on_progress=on_prog))

        if len(decks) == 1:
            d = decks[0]
            result, media, filename = d["pptx"], PPTX_MEDIA, d["filename"]
        else:
            zbuf = io.BytesIO()
            with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
                for d in decks:
                    z.writestr(d["filename"], d["pptx"])
                    z.writestr(d["filename"].rsplit(".", 1)[0] + ".wording.md", d["wording_md"])
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
    x_deck_token: str | None = Header(default=None),
):
    """Start a deck-generation job in the background and return its id immediately.

    kvalitet: "fast" (default) or "polished" (adds a visual QA pass — needs a rasteriser on the
    server, i.e. LibreOffice installed; degrades to fast if absent)."""
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
                     args=(job_id, key, files, lengde, tone, kvalitet, instruksjoner, innholdstype),
                     daemon=True).start()
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
