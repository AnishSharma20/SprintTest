# EVAL — generated deck vs. the AkerBM reference deck

**Acceptance test.** Text from 10 slides of the real reference deck
(`reference/AKBM_EKSEMPEL_SLIDES_FEED_IN.pptx`, 86 slides) was extracted into
[`reference_summary.txt`](reference_summary.txt) and run through the full pipeline:

```
python -m src.cli generate reference_summary.txt --length detaljert --tone balansert
```

Result: a **13-slide `.pptx`** that opens cleanly in PowerPoint, uses only the template's
own layouts / fonts / colours, and passes `scripts/qa.py` (0 placeholder remnants, 0 empty
or broken pictures). Every slide was rendered to PNG (PowerPoint) and inspected.

## How it compares

| Dimension | Reference deck | Generated deck | Verdict |
|---|---|---|---|
| **On-brand look** | Superba template, hand-built | The *same* Superba template, filled by index | **Match by construction** — identical gradients, logos, footer, fonts (Exo 2 / Manrope), slide numbers. This is the whole point of the pivot: the model never composes visuals, so it cannot look "AI-generated". |
| **Title style** | Action titles ("Superba Krill: The Natural Combination…") | Action titles ("TEWL Reveals How Fast Skin Ages from Within", "Phospholipids Make Krill Oil Uniquely Bioavailable") | **Match** — full-sentence claims, not topic labels. |
| **Layout variety** | Cover, dividers, split-panel photo, multi-column, big-statement | Cover, Section, Agenda, Two/Three/Four Columns, Highlight, Text-with-Picture, Picture-with-Title, Text | **Good** — draws from the same 12-layout system; alternates dark/light masters for rhythm. |
| **Density** | ~68 words/slide avg (50–160 range) | Comparable; dense content slides + "breathing" highlight/section beats | **Match** — `detaljert` produces dense multi-column proof slides interleaved with single-idea slides. |
| **Photography** | Curated brand photos, full-bleed | Photos chosen by semantic id from the 26-photo manifest, placed in picture placeholders (crop-to-fill) | **Match** — e.g. the oil-in-water shot for a bioavailability slide, the krill swarm for an intro. |
| **Citations** | Inline + footnotes | Carried into `speaker_notes` + `source_citations` (in the `.wording.md`) | **Partial** — citations live in notes/review doc, not always on-slide (a deliberate claim-fidelity choice). |
| **Overflow / remnants** | n/a (hand-made) | Zero — char limits derived from placeholder geometry + a validation→retry loop + auto-fit | **Pass** (Definition of Done). |

## Gaps / known limitations (future work)

1. **No charts.** The reference deck uses clustered-column charts (Krill vs placebo). v1 has no
   chart layout — quantitative comparisons render as `two_columns`/`highlight` stat slides
   instead. Adding a native `python-pptx` chart into the `Text Slide` OBJECT placeholder is the
   natural next step (deterministic, on-theme).
2. **Benefit icons — DONE (2026-07-03).** The 11 official hexagon icons (Red + Pastelle) are
   placed deterministically: the slide-level `benefit` tag drops the matching icon on
   highlight / section / text_with_picture slides, and a per-column `icon` renders above each
   column (fit-not-crop, colour-matched — pastelle on dark, red on light). Guarded to be
   meaningful only (genuine benefits, never nutrients/mechanisms, never repeated on a slide).
3. **No bespoke "ingredient anatomy" slide** (capsule + nutrient callouts) — the reference uses one.
   Would be a dedicated deterministic layout, not template-fill.
4. **Very dense bodies auto-fit-shrink.** On `detaljert`, a body 30–50 chars over its limit is
   shrunk by PowerPoint's auto-fit to stay in its box (logged as a warning). Readable, but slightly
   smaller than neighbouring slides. Tightening the planner's density for those layouts would remove it.
5. **Agenda title is one short word** ("Agenda") — the template's agenda title box is very narrow.
   The real agenda content lives in the items list.

## Bottom line

The generated deck is **indistinguishable from a hand-filled Superba template** in brand fidelity,
which was the failing point of the previous SVG-generation approach. Content quality (storyline,
action titles, layout fit) is strong. The remaining gaps (charts, icons, anatomy) are additive
features, not corrections — the core pipeline is production-ready for text-driven decks.
