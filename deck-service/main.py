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
import zipfile

import anthropic
from fastapi import FastAPI, Header, UploadFile
from fastapi.responses import JSONResponse, Response

from deckgen import DeckResult, generate_deck
from deckgen.layouts import LAYOUTS

app = FastAPI(title="Superba Deck Generator")

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
async def generate(filer: list[UploadFile], x_deck_token: str | None = Header(default=None)):
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
            decks.append(generate_deck(client, text, base))

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
