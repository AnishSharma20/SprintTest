FROM python:3.12-slim

WORKDIR /app

# LibreOffice = the rasteriser the "polished" visual-QA gate needs to turn the rendered .pptx into
# images for the vision pass. Without it, polished mode degrades to fast (no-op gate) — fast mode
# needs nothing here. Impress-only keeps the image smaller than full libreoffice.
#
# default-jre-headless: --no-install-recommends above skips it (normally just a "recommends", not
# a hard dependency) but some of LibreOffice's PDF export filter machinery genuinely needs a JRE
# at runtime — its absence surfaces as "failed to launch javaldx" on EVERY conversion (harmless-
# looking) and, for some documents, an outright PDF export failure
# (SfxBaseModel::impl_store ... Io/Write) with no clearer diagnostic than that. Headless variant
# only — no X11/GUI dependencies pulled in.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-impress default-jre-headless \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first for better layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the service (main.py, src package, config/, committed assets/, template.pptx).
# brand_assets/ and reference/ are gitignored and not needed at runtime — the renderer
# uses template.pptx and the staged assets/ only.
COPY . .

ENV PYTHONIOENCODING=utf-8

# Render provides $PORT; default to 8000 for local runs.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
