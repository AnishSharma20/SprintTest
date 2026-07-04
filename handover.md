# Handover — Superba deck-service (Tab 2) — 2026-07-02

_Read this first, then the auto-memory `deck-service-architecture.md`. Supersedes the
previous handover; the AKBM brand-pack request from it is preserved at the bottom._

## What this project is
`min-forste-app/deck-service/` turns an uploaded science summary into an on-brand
**Superba Krill (Aker BioMarine) sales deck** (.pptx). Deployed on **Render** (repo
`AnishSharma20/SprintTest`, root dir `deck-service`), proxied by the **Vercel** Next.js
frontend Tab 2 (`app/generator/page.tsx` → `app/api/generate-deck/route.ts` →
`DECK_SERVICE_URL`). Tab 2 controls: `lengde` (kort/standard/detaljert → ~6/9/13 slides)
+ `tone` (salg/balansert/vitenskap).

## Hard constraints (from the user — do not re-litigate)
- **Design quality is the #1 priority** (not cost/speed).
- **1 user, MVP** — no scalability/multi-tenant work needed.
- **No image generation.**
- Must stay a website: upload files → download a .pptx.
- Render + Vercel already talk to each other today.
- `ANTHROPIC_API_KEY` is in **`min-forste-app/.env.local`** (local) and on Render. Load it:
  `export ANTHROPIC_API_KEY="$(grep -E '^ANTHROPIC_API_KEY=' .env.local | cut -d= -f2- | tr -d '\r"'"'"'')"`
  No `ant` CLI installed; key is not in the shell env by default. Use `python` (not `python3`).

## Current DEPLOYED architecture (unchanged this session)
**python-pptx direct render** (commit cec1750). `deckgen/planner.py` (Claude plans) →
`deckgen/render.py` (7 layout fns, native auto-fit text frames). Output: native/editable
.pptx + `.wording.md`. **Still in production — we have NOT swapped it.**

## What THIS session did (Fase 0 spike + cost + A/B — all local, nothing deployed)
Cloned PPT Master into `vendor-ppt-master/` (gitignored, NOT deployed). Proved the SVG
route works and measured it. This **overturns the old memory claim that "SVG was rejected"**
— that rejection was of *fixed-layout export SVGs* (per-word positioned text that overflows).
Clean SVGs (one `<text>` per block) reflow fine.

Working pipeline: Claude writes clean SVG per slide → `svg_to_pptx.py` → **native, editable
pptx** (0 skipped). `pptx_template_import.py` extracts the real 64-slide Superba template.
Render/preview with `resvg_py`.

### Measured cost (Sonnet 4.6, `claude-sonnet-4-6`)
~$0.06/slide, ~15–45s/slide → **~$0.6–1.1 per 9-slide deck** (clean/2-phase). Full
ppt-master agent loop ≈ $1–4/deck. Latency needs **per-slide parallelism** (9 sequential
≈ 7 min; parallel ≈ 1–2 min). Caching didn't fire (brand prompt < Sonnet's 2048-tok min).

### A/B decks built (open in PowerPoint to inspect editability)
1. **Agent method (2-phase)** — Strategist designs ONE cohesive visual system → Executor
   renders each slide against it. **Most art-directed** (split-panel system, recurring
   hexagon device, consistent Superba® mark).
   `vendor-ppt-master/projects/superba_agent/exports/superba_agent_20260702_110707.pptx`
2. **Clean pipeline** — independent per-slide calls. On-brand, less cohesive; fake wordmarks,
   odd icons. `vendor-ppt-master/projects/superba_clean/exports/superba_clean_20260702_105753.pptx`
3. **Original spike (hand-authored)** — used REAL logos + REAL krill photo; simpler geometry
   but authentic. `vendor-ppt-master/projects/superba_spike/exports/superba_spike_20260702_104209.pptx`
PNG renders sit beside each SVG (`_a_*.png`, `_c_*.png`, `_prev_*.png`).

### KEY FINDING
Per-slide visual quality is *the same model writing SVG* — clean vs agent is not a quality
gap. What differs: the **2-phase Strategist→Executor method yields more cohesive/art-directed
decks**, and it is **fully reproducible in a headless backend via plain API calls** (the
"agent method" A/B was NOT the full Claude-Code agent loop — just its two-role method). The
full agent loop only adds process (confirmations, image-gen, quality-gates), not prettier slides.

### Two DEFECTS the agent method demonstrated live (must handle in Fase 1)
1. **Claim fidelity broke** — invented "crossing the cardioprotective threshold" (NOT in the
   summary) and reframed +3.2 pts as "Rose by 65%". Free latitude = more invention. Fix:
   re-assert `prompt.py` claim-fidelity hard rules in BOTH Strategist and Executor phases.
2. **Text overflow returned** — benefit-slide title clipped past its panel ("...Functio**n.**").
   Big absolute-positioned SVG titles overrun. Fix: `svg_quality_checker` gate + retry.

## RECOMMENDED Fase 1 (direction agreed; NOT yet built)
Build the **2-phase method as a headless backend** behind `/generate` on Render:
Strategist writes one `design_spec` → Executor renders each slide against it (parallelised)
→ **`svg_quality_checker` overflow gate** → **wire in real brand assets** (`deck-service/assets/`)
→ `svg_to_pptx`. Re-assert `prompt.py` claim rules in both phases. Gives deck #1's cohesion
+ deck #3's authentic assets, controllable at ~$0.7–1.1/deck.

**USER'S LAST STATE:** asked to SEE real agent slides before deciding — done (deck #1).
**Awaiting explicit go/no-go to build Fase 1.** Suggested first step: fix the two defects
(claim guard + overflow gate) since they're load-bearing.

## Reproduce / iterate (scripts persisted in repo)
`vendor-ppt-master/projects/_spike_scripts/`: `measure_executor_cost.py`
(`--slides N --model opus|sonnet`), `gen_clean_pipeline.py`, `gen_agent_pipeline.py`.
Run from `min-forste-app/` after exporting the key. Convert:
`python vendor-ppt-master/skills/ppt-master/scripts/svg_to_pptx.py projects/<name>`
(from `vendor-ppt-master/`).

## Brand facts (verified this session)
Deep Sea Green `#163536` (dark bg), Polar Blue `#E9F7F8` (light bg), Sea Blue `#175969`,
Regal Blue `#003462`, Ruby Red `#E30917` (signature accent), Alt Red `#BD393F` (only solid
red fill), Turquoise `#60A09B`/`#A9DBD5`, Peach `#FFD1B0`. Fonts: Exo 2 (italic headings),
Manrope (body). Benefit icon = hexagon. Assets: `deck-service/assets/` (5 benefit hexagons +
Superba/Aker logos white/green).

## Open decisions for the new session
1. Get the user's explicit go/no-go on the 2-phase backend for Fase 1.
2. If go: claim-fidelity guard + `svg_quality_checker` overflow gate first → wire real assets
   → Render swap behind `/generate` (async job or raised `maxDuration`; parallelise per-slide).
3. `create-template` on the full Superba template (Fase 0 task #2, still pending) for 15–20
   reusable fillable layouts — optional, improves cohesion.

> ⚠️ Frontend note (`AGENTS.md`): this repo's Next.js has breaking changes vs training data —
> read `node_modules/next/dist/docs/` before writing any frontend code.

---

## Still-pending: AKBM official brand pack (carried over from prior handover)
Needed to move beyond the 5 extracted icons / drawn assets. Mail template (Norwegian):

> Vi bygger et internt verktøy som genererer Superba-decks automatisk, og trenger de
> offisielle brand-assetene. Kan dere dele:
> 1. **Benefit-ikonene (alle 10):** Heart, Joint, Liver, PMS, Cognitive, Eye, Muscle, Sport,
>    Skin, Wellness — helst SVG, eller transparent PNG (256–512px). Hvit + farget variant.
> 2. **Logoer:** Superba Krill + Aker BioMarine — SVG + transparent PNG, hvit (reversert) og
>    mørk variant, med clear-space-regler.
> 3. **Godkjent fotografi:** mennesker (aktiv, hud), produkt (kapsler/flaske), krill/hav.
> 4. PowerPoint-malen (`.potx`) og brand guide (PDF).
> 5. Lenke til DAM/brand-portal hvis dere har det.
