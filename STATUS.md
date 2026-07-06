# Current state — Superba Deck Generator

## START HERE (updated 2026-07-05)

**What it is.** Tab 2 of the Superba/AKBM tool turns a science summary (`.txt`/`.docx`/`.md`) into an
on-brand Superba **PowerPoint**. Next.js frontend on Vercel → FastAPI service on Render.

**Architecture — two-stage template-fill** (`deck-service/src/`):
Claude `planner.py` emits a schema-validated JSON slide plan (layout enum + per-placeholder char limits +
asset ids — **never styling**) → `validate.py` (+ one self-correction retry) → `renderer.py` (python-pptx)
fills the REAL Superba `template.pptx`, inheriting all design (fonts, deep-sea gradient, logos, footer).
Optional `qa_gate.py` visual pass in "polished" mode. Config in `config/*.json` is **generated** from the
template by `scripts/` (inspect → manifest → schema), so the pipeline is template-agnostic.
→ Authoritative detail: **`deck-service/README.md`** + the **`deck-service-architecture` memory** (updates a–v).

> An earlier `svcgen/` SVG-**generation** pipeline was DELETED in the 2026-07-03 pivot because it "looked
> AI-generated." **Ignore any mention of `svcgen`, `deckgen`, `vendor/`, `DECK_PIPELINE`, or `gen_hybrid`** —
> that's dead history (in git ≤ `9b5601d` and memory updates a–q).

**Deployed & LIVE** — commit `7b65a77` on `origin/main` (repo `AnishSharma20/SprintTest`; one
`git push origin main` redeploys BOTH Render [root `deck-service`] + Vercel [frontend]):
- the full two-stage pipeline;
- the **icon system** — brand-red line-art benefit icons (`assets/icon_*.png`) + a generic Lucide fallback
  (`assets/generic_*.png`); matching, all-or-nothing-per-slide and single-source **enforced in the renderer**;
- the **verbatim ingredient slide** — AKBM's real "Key Cellular Nutrients" slide spliced in
  (`assets/ingredient_slide.pptx`);
- the **visual QA gate** — `quality=polished` renders the deck → one vision call flags overflow/collision/
  icon-mismatch → fixes flagged slides. Dockerfile installs `libreoffice-impress` for its rasteriser.

**Local-only (NOT committed/pushed) as of 2026-07-05:**
- **Tab 1 (Scientific Studies) reworked** — `app/page.tsx` now queries `"Aker BioMarine"[Affiliation]`
  (was generic `"krill oil"[tiab]`). Each study can carry a 4-section **summary** with a badge:
  **✓ Verified by science** (the 4 curated key trials from the joint-health whitepaper, in
  `app/studies-data.ts` — Stonehouse 2022, KARAOKE/Laslett 2024, Suzuki 2016, Deutsch 2007 [a Neptune
  *competitor* study, flagged]; none are Aker-affiliated on PubMed so they're always merged in) vs
  **AI · unverified** (auto-generated from PubMed abstracts by `deck-service/scripts/gen_aker_summaries.py`
  → `app/ai-summaries.json`). Quality score (High/Moderate/Low) shown for the curated ones. The fictional
  SUPERBA-OA/Andersen 2026 study is excluded. UI: expandable summary + badges in `app/wiki.tsx`.
- **Tab 2 free-text field** — `app/generator/page.tsx` has a "Context & instructions" textarea threaded
  through `/api/generate-deck` → `main.py` (`instruksjoner`) → `pipeline.generate(instructions=…)` →
  `planner.build_system` (injected as a high-priority "USER CONTEXT & INSTRUCTIONS" block; can't override
  claim-fidelity/brand rules).
- Frontend **Whitepaper "Soon"** menu item (`app/generator/page.tsx`) — type-checks clean, not pushed.
- **`deck-service/template2.pptx`** — the Superba template with its layout placeholders re-formatted to
  **centered / center-aligned** (built by `scripts/center_layouts.py`). NOT adopted — the tool still uses
  `template.pptx`. To adopt: `python scripts/inspect_template.py template2.pptx && python scripts/build_schema.py`,
  then point the service at it (`DECK_TEMPLATE=template2.pptx` or replace `template.pptx`). Verified safe
  (placeholder→field mapping unchanged; char limits adapt).
- **`deck-service/template2_mbb_gallery.pptx`** — reference gallery of 15 composed MBB example slides
  (`scripts/build_template2.py`). Reference only: the tool fills LAYOUT placeholders, it does not use
  composed slides.

**Open next steps (if wanted):** adopt template2; add NEW MBB *layouts* (2×2, funnel, pillars…) as fillable
placeholder-layouts for real layout variety (needs OOXML layout-cloning — python-pptx has no add-layout API);
speed/parallelism.

**Env vars.** `ANTHROPIC_API_KEY` in `min-forste-app/.env.local` (server-side only); `DECK_SERVICE_URL` +
`DECK_SERVICE_TOKEN` (Vercel→Render); `DECK_MODEL` (default `claude-sonnet-4-6`), `DECK_GATE_MODEL`,
`DECK_QA_ROUNDS`, `DECK_TEMPLATE`.

**Windows dev notes.** Use `python` (NOT `python3`). Render `.pptx`→PNG via **PowerPoint COM through
PowerShell** (LibreOffice is absent locally, present on Render). Bash tool = git-bash; run the service with
`python -m uvicorn`. Next.js 16 has breaking changes — read `node_modules/next/dist/docs/` before frontend
edits (see `AGENTS.md`). Runnable commands: **`deck-service/README.md`**.

**House rules (do NOT re-propose).** Never let the LLM emit styling — design is inherited from the template.
Feed the FULL source (not a trimmed summary) + the right tone for a rich deck; density scales with input, not
prompts. Restraint targets visual clutter, not information (scientific decks stay comprehensive).
