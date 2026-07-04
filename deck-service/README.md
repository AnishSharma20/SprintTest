# Superba Deck Generator

Turns a free-text summary (pasted text or a `.docx`) into an **on-brand Aker BioMarine /
Superba PowerPoint deck**. Built for non-technical AkerBM staff (Tab 2 of the content tool).

## Core idea — two stages, and the LLM never touches design

```
                    ┌──────────────────────── Stage 1: CONTENT (Claude) ───────────────────────┐
  summary text ───▶ │ src/planner.py                                                            │
  (.txt / .docx)    │   Claude emits a slide plan via a forced `emit_plan` tool call:           │
                    │     • picks a layout from a fixed 12-name enum                            │
                    │     • writes titles/body within per-placeholder character limits          │
                    │     • picks a photo by asset_id                                           │
                    │   → JSON plan                                                             │
                    └───────────────────────────────┬───────────────────────────────────────── ┘
                                                     │  src/validate.py (jsonschema, hard)
                                          valid? ────┤  no → ONE self-correction retry → still bad:
                                                     │        structural error = fail loud;
                                                     │        length overage = render + warn (auto-fit)
                    ┌──────────────────────── Stage 2: RENDER (deterministic) ─────────────────┐
                    │ src/renderer.py (python-pptx)                                             │
                    │   • loads the REAL Superba template.pptx                                  │
                    │   • strips its 64 example slides                                          │
                    │   • per plan slide: deep-copies the matching layout (dark master #0 /     │
                    │     light master #1 by `background`), fills placeholders BY INDEX,        │
                    │     inserts the photo, deletes any unfilled placeholder, writes notes     │
                    └───────────────────────────────┬───────────────────────────────────────── ┘
                                                     ▼
                                    branded .pptx  +  <name>.wording.md (review doc)
```

**All styling — fonts, colours, the deep-sea gradients, logos, footer, bullet formatting — is
inherited from the template's slide layouts.** The model only chooses *which* layout and *what
text*. That is why the output looks like the brand template (because it *is* the template) and
never "AI-generated". This replaced an earlier pipeline where Claude generated SVG slide art.

## Setup

```bash
pip install -r requirements.txt          # Python 3.11+
export ANTHROPIC_API_KEY=sk-ant-...       # server-side only, never hardcoded
```

`config/*.json`, `assets/` (staged photos + icons), and `template.pptx` are committed — the
service needs nothing else at runtime. `brand_assets/` and `reference/` are the large source
material and are gitignored (only needed to regenerate config).

## Use it

```bash
# CLI (Definition of Done command)
python -m src.cli generate reference_summary.txt --length detaljert --tone balansert -o out.pptx
#   --length   kort | standard | detaljert   (~6 / 9 / 13 slides)
#   --tone     salg | balansert | vitenskap
#   --quality  fast (default) | polished     (polished = add the visual QA gate; see below)

# HTTP service (what the Next.js Tab 2 frontend calls)
python -m uvicorn main:app --host 127.0.0.1 --port 8125
#   POST /jobs (multipart "filer" + lengde + tone + kvalitet) -> {job_id};  GET /jobs/{id};  GET /jobs/{id}/result
#   GET /health   POST /generate (sync)

# QA a produced deck (checks + per-slide PNG render for visual review)
python scripts/qa.py out.pptx
```

Model: `claude-sonnet-4-6` by default; override with `DECK_MODEL` (e.g. `claude-sonnet-5`,
`claude-opus-4-8`). Optional `DECK_SERVICE_TOKEN` gates the HTTP endpoints.

## Polished mode — the visual QA gate

`--quality polished` (CLI) / `kvalitet=polished` (`/jobs`) adds a third stage that actually *looks* at
the finished deck — the check the schema can't do:

1. rasterise the rendered `.pptx` to one image per slide (LibreOffice→PDF→PyMuPDF on the server —
   `libreoffice-impress` is in the Dockerfile; PowerPoint COM on a Windows dev box);
2. one **vision call** (`src/qa_gate.py`) flags only objective defects — text overflow, collisions,
   truncation, or an icon whose meaning doesn't match its text — and returns short fixes;
3. `planner.revise_plan_visual` fixes **only the flagged slides** and the deck is re-rendered.

Bounded by `DECK_QA_ROUNDS` (default 1); a schema-repair pass catches any slip; if no rasteriser is
present it **degrades to a no-op** (so it never breaks generation). `DECK_GATE_MODEL` overrides the
vision model (defaults to `DECK_MODEL`; a cheaper vision model like Haiku works well here).
**Fast mode (default) skips all of this** — the schema + renderer already guarantee a well-formed,
on-brand deck; polished is for when you want the extra visual pass.

## The config is generated — nothing is hardcoded to Superba

Three `scripts/` read the template and emit the config the pipeline runs on:

| Script | Output | What it is |
|---|---|---|
| `scripts/inspect_template.py` | `config/template_inventory.json` | every layout, placeholder idx/type/geometry, theme, masters — the renderer's ground truth |
| `scripts/build_manifest.py` | `config/asset_manifest.json` + `assets/` | 26 photos + 11 benefit icons (+ any staged generic icons), tagged by eye, staged for runtime |
| `scripts/fetch_generic_icons.py` | `assets/generic_*.png` | the generic fallback icon library (needs network; run occasionally — see Icons below) |
| `scripts/build_ingredient_slide.py` | `assets/ingredient_slide.pptx` | extracts AKBM's real "Key Cellular Nutrients" slide verbatim (see Ingredient slide below) |
| `scripts/build_schema.py` | `config/slide_schema.json` + `config/layout_catalog.json` | the planner's tool schema (char limits derived from placeholder geometry) + the renderer's field→index map |

### The ingredient slide — inserted verbatim

The `ingredient` layout is AKBM's standard "Superba Krill: The Natural Combination of Key Cellular
Nutrients" slide (softgel + phospholipids / omega-3 / choline / astaxanthin callouts). Its content is
fixed product composition, so rather than re-compose it, the renderer splices in **the real AKBM slide
verbatim** from `assets/ingredient_slide.pptx` (`renderer._add_ingredient_slide` copies its
self-contained shape tree — own full-bleed background, capsule, connectors, footer logos, citation
links — re-embedding the images). The planner only chooses the layout; any copy it writes is ignored.
To refresh it from a newer source deck: `python scripts/build_ingredient_slide.py <source.pptx>`.

### Icons — two sources, one per slide

Icons are clean brand-red line-art from two libraries, and any single slide draws from **only one**:

- **Benefit icons** — the 11 AKBM health-benefit icons (`assets/icon_<benefit>.png`, the label-free
  "Icon Only / Red" set). The planner tags a column's `icon` (or a slide's `benefit`) with the
  matching benefit; the renderer places it.
- **Generic fallback** — a neutral line-art set (`assets/generic_<keyword>.png`, ~30 topics like
  science / sourcing / purity / sustainability) recoloured to the brand red, for slides with no
  matching benefit. Built by `scripts/fetch_generic_icons.py` from [Lucide](https://lucide.dev)
  (ISC-licensed); the planner tags `icon_generic`.

The renderer (`_fill_slide`) **enforces** the brand rules regardless of what the planner emits:
icons on a column slide are all-or-nothing (never 2 of 3), every icon on a slide comes from the
same source (branded **or** generic, never mixed), and each is distinct — a partial, mixed, or
duplicated set is dropped entirely. Branded icons are preferred; the generic set is used only when
it can cover *every* column. To add/refresh generic icons, edit the `GENERIC` map in
`fetch_generic_icons.py`, re-run it, then re-run `build_manifest.py` + `build_schema.py`.

### The 12 LLM-facing layouts (and why only 12)

`title, section, agenda, highlight, title_only, text, text_with_picture, picture_with_title,
picture_full, two_columns, three_columns, four_columns`. The template has ~30 named layouts
across 2 masters, but a large enum degrades the model's layout selection. These 12 cover the
useful space (cover, dividers, agenda, a big-statement slide, a body slide, three picture
treatments, and 2/3/4-way parallel content — the workhorses of a sales/science deck); near
duplicates (Title Slide 2, Text With Picture 2/4, Section Header 2/3, Logo/Blank) are dropped.

## Swapping in the AkerBM corporate template later

The pipeline is template-agnostic — nothing brand-specific lives in the logic. To retarget:

1. Drop the new `.pptx` in and point `DECK_TEMPLATE=/path/to/corporate.pptx` (or replace
   `template.pptx`).
2. Re-run the three scripts against it:
   `python scripts/inspect_template.py <template>` → then `build_manifest.py` → `build_schema.py`.
3. Map the new template's layout names into `LAYOUTS` in `build_schema.py` (semantic name →
   template layout name) and re-run. The renderer, planner, and validator pick up the new
   `config/` with no code change.

Font sizes for the char-limit math are estimated per placeholder role in `build_schema.py`
(`FONT_PT`); if the new template's fonts differ a lot, adjust those and re-run — `scripts/qa.py`
plus a visual pass will confirm no overflow.

## Constraints honoured

- Deterministic renderer (same JSON in → same deck out, modulo pptx timestamps).
- No customer PII in code, config, or fixtures.
- Norwegian and English both work; output language follows the input (`language` in the plan).
- API key from `ANTHROPIC_API_KEY` only.

Comparison against the reference deck: see [EVAL.md](EVAL.md).
