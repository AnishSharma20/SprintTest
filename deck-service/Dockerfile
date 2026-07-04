FROM python:3.12-slim

WORKDIR /app

# LibreOffice = the rasteriser the "polished" visual-QA gate needs to turn the rendered .pptx into
# images for the vision pass. Without it, polished mode degrades to fast (no-op gate) — fast mode
# needs nothing here. Impress-only keeps the image smaller than full libreoffice.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-impress \
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
