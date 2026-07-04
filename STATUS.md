# Current state — Superba Deck Generator

> **⚠️ 2026-07-03 ARCHITECTURE PIVOT — everything below is SUPERSEDED.** The SVG-generation
> hybrid (`svcgen/`) still "looked AI-generated", so it (+ `vendor/`, legacy `deckgen/`) was
> **deleted** and rebuilt as a **two-stage template-fill** pipeline in `deck-service/src/`:
> Claude emits a schema-validated JSON slide plan (layout enum + char limits + photo id, never
> styling) → `python-pptx` fills the REAL Superba `template.pptx`, inheriting all design.
> See **`deck-service/README.md`** (architecture + how to swap templates), **`deck-service/EVAL.md`**
> (reference comparison), and the `deck-service-architecture` memory. Verified end-to-end
> (CLI + `/jobs` HTTP + QA). Frontend Tab 2 / `/jobs` contract unchanged. Not yet pushed to deploy.
>
> **2026-07-04 — ICON SYSTEM + VERBATIM INGREDIENT SLIDE.** Two follow-ups landed (also local, not
> yet pushed):
> - **Icons** are now clean brand-red line-art from two libraries, and every rule is ENFORCED in the
>   renderer (not just prompts): (1) topic-matched (liver→liver, heart→heart…); (2) all-or-nothing per
>   slide (never 2 of 3 columns); (3) one source per slide — all AKBM benefit icons **or** all generic,
>   never mixed; (4) each distinct. Benefit icons = the 11 AKBM "Icon Only / Red" icons
>   (`assets/icon_<benefit>.png`). Generic fallback = ~30 Lucide (ISC) icons recoloured to brand red
>   (`assets/generic_<kw>.png`, built by `scripts/fetch_generic_icons.py`) for topics AKBM has no benefit
>   icon for. Column field `icon` (benefit) vs `icon_generic` (generic) keeps the two sources unambiguous.
> - **Ingredient slide** is now AKBM's REAL "Key Cellular Nutrients" slide spliced in VERBATIM
>   (`assets/ingredient_slide.pptx`, built by `scripts/build_ingredient_slide.py`) — no longer re-composed.
>   `renderer._add_ingredient_slide` copies its self-contained shape tree (own full-bleed bg + capsule +
>   connectors + footer + citation links), re-embedding images. Pixel-identical to the source.
> - Delivered sample decks: `~/Downloads/Superba_Skin_Health_Deck.pptx` + `Superba_Liver_Health_Deck.pptx`.
>
> **2026-07-04 — VISUAL QA GATE ("polished" mode).** New `src/qa_gate.py` + a `quality` toggle
> (`fast` default | `polished`) on `pipeline.generate` / CLI `--quality` / `/jobs` `kvalitet` form field.
> Polished mode renders the finished deck to images (LibreOffice→PDF→PyMuPDF on the server, PowerPoint
> COM on a Windows dev box), sends them to ONE vision call that flags only objective defects (overflow /
> collision / truncation / icon-not-matching-its-text), then `planner.revise_plan_visual` fixes just the
> flagged slides and re-renders (bounded by `DECK_QA_ROUNDS`, default 1; a schema-repair pass catches any
> slip; degrades to a no-op if no rasteriser). Verified: on the liver deck it autonomously caught the 3
> loose icon matches a human review had missed/tolerated and fixed them. **Dockerfile now installs
> `libreoffice-impress`** so the gate works on Render (fast mode needs nothing). `DECK_GATE_MODEL` env
> overrides the vision model (defaults to `DECK_MODEL`; Haiku is a cheaper option).

<details><summary>Historical status (SVG hybrid — superseded)</summary>

_Last updated: 2026-07-03. Deployed at commit `7c890be`+ (repo `AnishSharma20/SprintTest`); the OFFICIAL-ASSET integration below is committed locally, push to redeploy. This session: wired in the **real AKBM brand pack** — official colour + white logos, real deep-sea gradient backgrounds, the real krill-swoosh graphic, a 12-photo official photo library, and a real softgel cutout on the anatomy slide. All the earlier pure-SVG approximations are now GONE._

## ✅ OFFICIAL AKBM ASSETS ARE IN (the long-standing "pending assets" item is DONE)
The brand pack arrived and is organised in `~/Downloads/akbm_brand_assets/`. Everything below is now the
**real** asset, not an approximation:
- **Logos** (`svcgen/assets/`): `superba_white/green.png` + `aker_white/green.png` are the official
  landscape logos (SUPERBA_KRILL WHITE/POS, Aker White/Black), trimmed to content bbox. white=dark slides,
  "green"=colour variant for LIGHT slides (Superba full-colour POS + Aker black). Footer coords unchanged.
- **Deep-sea gradient** (`bg_deep_sea.jpg`, from official `bg_green-1`): staged as a full-bleed `<image>`.
  Replaces the old `_SEA_DEFS` SVG gradient in `template_fill.render_cover/render_section`, `chart_render`,
  `anatomy_render`, `templates/ending.svg.tmpl`, and the body-slide HOUSE_STYLE instruction. Body slides get
  it guaranteed by `_ensure_bg()` (strips any dark rect the model drew, injects the image) — dark is the
  default; light (#E9F7F8) slides are detected by `_is_light_bg()` (first full-canvas rect fill, NOT any
  #E9F7F8 occurrence — a dark slide's Polar-Blue title text must not flip it to light).
- **Krill swoosh** (`krill_swoosh.png`, official `visual-element-krillArtboard-2`): a subtle red corner glow
  bleeding off bottom-left, `opacity≈0.9`. Replaces the old `_KRILL` SVG ellipse in heroes + ending + the
  body HOUSE_STYLE optional-accent instruction.
- **Anatomy capsule** (`capsule_single.png`): the official "Single Capsule On White" softgel, background
  removed via corner flood-fill (keeps the specular highlight, drops the grey reflection). Replaces the drawn
  ellipse in `anatomy_render`.

All converts native (0 skips verified) and assets dedupe in the pptx.

## Photo library — now 12 OFFICIAL photos
Hero cover/section photos live in `svcgen/assets/`, declared in the `PHOTOS` catalog in `svcgen/pipeline.py`
(mirrored in sandbox `gen_hybrid.py`). Planner picks one per hero by theme (enum + prompt list generated from
the catalog). Current keys (all official, downscaled ≤1920): **capsules, capsules_jar, capsules_stone,
ingredients, breakfast, oil_water, krill_macro, krill_swarm, deep_sea, iceberg, antarctic_ocean, science_team.**
**To add one:** drop the file in `svcgen/assets/`, add ONE line to `PHOTOS` in BOTH files. Raw source library:
`~/Downloads/akbm_brand_assets/02. Images/` (product/oil/krill-animal/Antarctica/Houston-lab). NOTE the pack
has **no skin/beauty people shot** — the old `skin`/`lifestyle` keys (example-deck extractions) were dropped;
if a skin-benefit deck needs one, AKBM must supply it.

## Still pending on assets (minor)
Full 10 benefit-icon set (we ship 5: heart/joint/liver/muscle/skin — the pack's icon set wasn't mined this
session; `02.05. Health Benefits/Whole Body Benefits.png` is a composite diagram, not individual icons), exact
brand hex (1–2 digit drift vs guide s.13–14, e.g. Deep Sea Green #173636 not #163536), and upright Exo 2 **H1**
(guide s.21 — we use italic everywhere).

## 1. Goal
Tab 2 of the Superba/AKBM tool turns a science summary (`.docx`/`.txt`/`.md`) into an
on-brand **AKBM-native sales PowerPoint** — benefit-led, science as proof, editable native
pptx. It runs as a Next.js frontend on Vercel proxying a Python service on Render.

## 2. Architecture (who calls whom)
```
app/generator/page.tsx      UI: upload, options, polls status, draws progress bar, downloads
  └─ app/api/generate-deck/route.ts   Vercel proxy (job-based): POST→/jobs, GET ?id=→status, GET ?id=&download=1→result
       └─ deck-service/main.py        FastAPI on Render: /jobs (bg thread) + /jobs/{id} + /jobs/{id}/result + legacy /generate
            ├─ svcgen/                 DEFAULT pipeline (DECK_PIPELINE=svg): AKBM-native SVG hybrid
            │   ├─ pipeline.py         orchestrator + planner. FREE-LAYOUT: planner gives each body slide a free layout-slug (role) + rich brief; Executor (VISUAL_SYSTEM + HOUSE_STYLE + discipline) INVENTS the layout — no fixed role menu. Footer logos stamped by _inject_footer() (deterministic, idempotent). rhythm anchor/dense/breathing; PHOTOS catalog → hero photo by theme; role='chart' → deterministic chart. generate(..., on_progress=cb)
            │   ├─ template_fill.py    hero renderers render_cover()/render_section() (deep-sea gradient _SEA_DEFS + krill glow _KRILL + full-bleed photo) + footer() (fixed logos, hide-under-photo) + fill_template()/wrapped_lines()
            │   ├─ chart_render.py     deterministic clustered-column chart (role='chart'), deep-sea gradient bg
            │   ├─ quality_gate.py     vision gate (renders SVG→PNG via resvg, Claude flags collisions/overflow); no-op if resvg absent (GATE_AVAILABLE)
            │   ├─ templates/          cover.svg.tmpl, section.svg.tmpl, ending.svg.tmpl (gradient + footer)
            │   └─ assets/             AKBM logos, red-hexagon benefit icons, 8-photo library (capsules/capsules_duo/lifestyle/iceberg/deep_sea/skin/ingredients/krill_macro)
            ├─ vendor/                 vendored svg_to_pptx + svg_finalize + config/console_encoding/project_utils (native SVG→PPTX)
            └─ deckgen/                LEGACY fallback (DECK_PIPELINE=pptx): python-pptx direct render
```
- Env: `ANTHROPIC_API_KEY` (server), `DECK_SERVICE_URL` + `DECK_SERVICE_TOKEN` (Vercel→Render), `DECK_PIPELINE` (default `svg`).
- Model knobs: `SVCGEN_MODEL` (default `claude-sonnet-4-6`), `SVCGEN_MAX_ATTEMPTS` (default 3).
- Sandbox (NOT deployed, gitignored `/vendor-ppt-master`): `vendor-ppt-master/projects/_spike_scripts/gen_hybrid.py` mirrors svcgen for fast local iteration.

## 3. Done and verified
- **AKBM-native hybrid deck**: cover/section = navy-ellipse + full-bleed real photo; body slides in house style; ending disclaimer wraps. Full 10-slide regen → **10/10 gate-PASS**; native pptx conversion 0 skips (except ~1 cosmetic decorative element on very dense body slides).
- **Charts**: planner emits `role='chart'` with exact figures; `chart_render.py` draws Krill(red)-vs-Placebo(teal) clustered columns + numeric callout. Verified in a full deck.
- **Port into deck-service**: `svcgen.generate()` returns `{pptx, filename, wording_md, slide_count}`; vendored converter works with only python-pptx+lxml+Pillow (no cairosvg). Verified locally end-to-end AND over the real HTTP path (`POST /generate` → 200, valid pptx).
- **Async job pipeline (fixes 504)**: `POST /jobs`→instant `job_id`; `GET /jobs/{id}`→{status,progress,step}; `GET /jobs/{id}/result`→pptx/zip. Progress bar + 1.5s polling in the UI. Verified end-to-end through the service AND through `next dev` proxy; `tsc --noEmit` clean.
- **Page rhythm + design discipline** (kills the "AI card-grid look"): planner tags each slide anchor/dense/breathing; HOUSE_STYLE forbids multi-card grids, one visual-weight tool per box, one focal point. Breathing slides render as a single hero number + naked text.
- **Deep-sea gradients + krill-swarm glow** (brand guide §4.1/§4.2): pure-SVG, convert to native `a:gradFill` (verified). Across heroes, chart, ending, and body slides.
- **Fixed footer logos**: exact coords from the AKBM deck — Superba bottom-left (x32 y666 189×31), Aker bottom-right (x1096 y674 139×17); omit whichever a photo covers (`footer()` + HOUSE_STYLE rule).
- **Theme-driven photo library**: `PHOTOS` catalog; planner picks the hero photo by theme (verified: a 13-slide deck used 4 different hero photos).
- **Density is input-driven, not an architecture limit (verified experiment)**: the same pipeline fed a ~80-word summary → 52 w/slide (sparse); fed the full 2526-word, 5-study joint whitepaper with tone=vitenskap → 90 w/slide, 14 slides, **all 5 studies covered** — matching a hand-made comprehensive deck. Rhythm keeps hero/breathing slides short while dense content slides carry 114–189 words.
- **Deployed**: HEAD `0fd4a06`. One push redeploys both Render (root `deck-service`) and Vercel (frontend).

## 4. In progress / last state
- **No open code task.** All of today's features are shipped and pushed; nothing half-done.
- **Cost** (unchanged, no code yet): everything on **Sonnet 4.6** (planner + Executor + gate). ~$0.06–0.08/slide, ~$0.60–1.00/deck; body-slide retries are the main driver.
- **Known limitation**: generation is slow (~5–6 min for a full deck) — gate + up-to-3 retries run sequentially per slide. The job/progress-bar model makes this tolerable; parallelizing is the fix (next steps).
- **Usage note that matters more than any code**: for a rich/scientific deck, paste the FULL source (whole whitepaper, not a trimmed summary) and pick **tone=vitenskap** — output density scales with input depth + tone, not with the pipeline.

## 5. Next steps (priority order)
1. **Gate on Haiku** (cost): add `SVCGEN_GATE_MODEL` env (default `claude-haiku-4-5-20251001`), pass it to `qg.check_slide` instead of the Sonnet `MODEL`. ~3–4× cheaper gate; quality should hold.
2. **Parallelize slide generation** (latency): body slides are independent — run them concurrently (thread pool). Biggest wall-clock win (~5 min → ~1–2 min). Keep planner first, convert last.
3. **Ship brand fonts**: drop real Exo 2 + Manrope `.ttf` into `svcgen/assets/fonts` + `fc-cache` in the Dockerfile so the gate measures widths like PowerPoint.
4. **Brand polish (small)**: correct the exact hex (guide s.13–14, e.g. Deep Sea Green #173636 not #163536); optionally use upright Exo 2 for H1 (guide s.21).
5. **Optional richness**: per-study "evidence timeline" + more chart types for scientific decks (the one thing the hand-made comparison deck did better).

## 6. Pitfalls / rejected decisions (do NOT re-propose)
- **Don't make python-pptx the primary renderer.** It's the intentional fallback (`DECK_PIPELINE=pptx`); the SVG hybrid is the chosen path because it gives AKBM-native design.
- **Three SVG/template approaches are already rejected — do not retry:** (a) template-fill on the empty Superba .pptx (empty picture boxes / placeholder slots), (b) template-fill on a populated reference deck (drags in irrelevant charts + fixed geometry), (c) flat OOXML-export SVGs with per-word positioning (variable AI text overflows). The working approach = clean reflow-safe SVG, one `<text>` per block, shrink-to-fit or hand-wrapped.
- **No `clipPath`/`pattern` in SVGs** — `svg_to_pptx` silently SKIPS them, so a circular-cropped photo renders uncropped. Full-bleed = oversized `<image>` bleeding off-canvas.
- **Never split a number from its unit** into two `<text>` elements (caused overprint/detached-% collisions). "8.1%", "+3.2 pts" = one `<text>`.
- **Don't fix the 504 by raising the timeout.** Sync generation (1–3 min) cannot fit any gateway window; the async job pattern is the fix and is already in place.
- **Don't bundle cairosvg / svglib / reportlab.** They're optional (try/except in `pptx_media.py`); the native path needs only python-pptx + lxml + Pillow. `svg_finalize` is lazy-imported but IS vendored (tspan flattening runs during conversion).
- **`resvg_py` needs fonts, not cairo.** It's a self-contained Rust wheel (no system Cairo), but falls back to DejaVu without the brand fonts installed → approximate gate widths.
- **Strip XML comments from generated SVGs** — the Executor emits `--` inside `<!-- -->` which is illegal XML and breaks `ET.parse`; `_strip()` removes them.
- **Sparse / "AI-looking" output is usually a thin INPUT, not the pipeline.** Feed the full source and pick the right tone before touching prompts — density scales with input depth + tone (verified: same pipeline 52→90 w/slide, and 0→5 studies, just by swapping a summary for the full whitepaper).
- **Restraint targets visual clutter, not information.** The design-discipline rules kill card-grids and decorative padding — they must NOT be read as "drop studies/detail". Scientific decks stay comprehensive (dense content slides + breathing anchors).
- **Gradients/glows must use gradient-transparency, NOT `feGaussianBlur`.** A blurred shape does not convert to native PowerPoint; a radial gradient fading to `stop-opacity="0"` does (verified `a:gradFill`+`a:alpha`).
- **Footer logos are at FIXED coords** (Superba x32 y666 189×31, Aker x1096 y674 139×17). Hide whichever a photo covers; never move/resize. Cover/section drop the top masthead — logos live only at the bottom.
- **Two-file sync trap**: `template_fill.py` and `chart_render.py` exist in BOTH `svcgen/` (deployed) and sandbox `_spike_scripts/` (gitignored). Keep them byte-identical; when testing, mind `sys.path` order (inserting the sandbox path last-wins can import the wrong copy — this bit me once). Prompt constants (HOUSE_STYLE/PLANNER_SYS/PHOTOS) must match between `pipeline.py` and `gen_hybrid.py`.

## 7. Commands that actually work
`ANTHROPIC_API_KEY` lives in `min-forste-app/.env.local`. On this Windows box use the **Bash** tool (git-bash); `uvicorn` is NOT on PATH — always `python -m uvicorn`.

```bash
# --- deck-service locally ---
cd deck-service
export ANTHROPIC_API_KEY="$(grep -E '^ANTHROPIC_API_KEY=' ../.env.local | cut -d= -f2- | tr -d '\r"')"
export DECK_PIPELINE=svg
python -m uvicorn main:app --host 127.0.0.1 --port 8125        # run (use run_in_background)
curl http://127.0.0.1:8125/health                              # {"ok":true,"layouts":7}

# job flow (what the frontend does)
curl -F "filer=@summary.txt;filename=x.txt" -F "lengde=kort" -F "tone=balansert" http://127.0.0.1:8125/jobs   # -> {job_id}
curl http://127.0.0.1:8125/jobs/<job_id>                       # -> {status,progress,step}
curl -o out.pptx http://127.0.0.1:8125/jobs/<job_id>/result    # -> pptx bytes when done

# --- frontend locally (point it at the local service) ---
cd min-forste-app
export DECK_SERVICE_URL="http://127.0.0.1:8125"
npx next dev -p 3010                                           # Tab 2 at /generator
npx tsc --noEmit -p tsconfig.json                              # type-check (Next.js 16.2.9 — read node_modules/next/dist/docs before FE edits)

# --- sandbox (fast iteration, NOT deployed) ---
cd min-forste-app
python vendor-ppt-master/projects/_spike_scripts/gen_hybrid.py standard balansert   # regen full deck into projects/superba_hybrid/
cd vendor-ppt-master && python skills/ppt-master/scripts/svg_to_pptx.py projects/superba_hybrid   # SVG->native pptx
# preview render: resvg_py.svg_to_bytes(svg_path=.., resources_dir=svg_output, width=1280, height=720)

# --- deploy ---
git add -A && git commit -m "..." && git push origin main      # redeploys BOTH Render (deck-service) and Vercel (frontend)
```

</details>

_Historical section ends. Current architecture + commands: `deck-service/README.md`._
