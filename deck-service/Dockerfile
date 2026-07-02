FROM python:3.12-slim

WORKDIR /app

# Fonts for the quality gate's SVG rasterization: resvg needs installed fonts to render
# text. fonts-dejavu is a baseline fallback so gate renders aren't blank. For gate widths
# that match PowerPoint, drop the real Exo 2 + Manrope .ttf into a fonts dir and fc-cache
# them (the final .pptx uses the viewer's fonts regardless, so this only tunes the gate).
RUN apt-get update && apt-get install -y --no-install-recommends \
        fontconfig fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first for better layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the service (main.py, deckgen + svcgen packages, vendored svg_to_pptx, assets).
COPY . .

ENV PYTHONIOENCODING=utf-8

# Render provides $PORT; default to 8000 for local runs.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
