# Blog generation — design notes & thought process

*Written 2026-07-06. Covers **why** Tab 2's blog drafting works the way it does, not just what it
does. If you only want to run it, see `README.md` and `../STATUS.md`.*

---

## 1. The ask

The product owner wanted Tab 2 to do more than build decks — it should also **draft a blog article**
in the house style of [superbakrill.com/blog](https://www.superbakrill.com/blog), grounded in the
scientific studies the tool already surfaces. The reference example given was
*"How krill oil can help address a hidden risk in weight loss: muscle loss."*

The goal was never "write generic content." It was: **turn the same trusted sources (studies +
uploads + context) into a publish-shaped first draft that a human then edits** — the same
source-of-truth discipline the deck pipeline already enforces.

---

## 2. Research first — reverse-engineering the house style

Before writing a line of code I read several real Superba blog posts (via WebFetch) to extract a
concrete, repeatable **recipe** rather than guessing at "blog tone." What the real posts have in
common:

| Dimension | What Superba actually does |
|---|---|
| **Length** | ~1,100–1,900 words. Long enough to teach, short enough to finish. |
| **Audience** | Dual: B2B (formulators, brand owners) *and* the informed consumer. Explains the science but doesn't assume a PhD. |
| **Science : marketing** | ~70 / 30. The science leads and earns the pitch; the pitch never leads. |
| **Structure** | Benefit/problem H1 → **problem-hook intro** → 4–6 H2 sections → CTA → References. |
| **The H2 arc** | problem → the nutritional opportunity → **how Superba works** (phospholipid-bound EPA/DHA, choline, astaxanthin, absorption) → **the clinical evidence** (named study types, n, effect sizes) → broader benefits → a "science-supported solution" close. |
| **Evidence** | Named studies, real numbers, author+year references — not vague "studies show." |
| **Close** | Points to a whitepaper / contact, never a hard sell. |

That table *is* the spec. Everything downstream is just encoding it faithfully and refusing to let
the model drift off it.

---

## 3. Key design decisions (and the alternatives rejected)

### 3.1 Reuse the pipeline's philosophy, not its code path
The deck generator's core principle is **"the LLM never invents the substance"** — it plans within a
schema and the design/facts come from trusted inputs. Blogs needed the *same* claim discipline but a
*different* output shape (prose, not a slide plan). So blog generation is its **own module**
(`src/blog.py`) that **imports the planner's `CLAIM_RULES`** rather than forking a second, drifting
copy of "don't fabricate findings." One source of truth for claim fidelity across both features.

*Rejected:* bolting blog logic onto the deck planner. It would have entangled two unrelated output
formats and made both harder to reason about.

### 3.2 One Claude call, not a multi-stage pipeline
Decks use plan → validate → render because a `.pptx` is a **structured artifact** that must satisfy a
schema. A blog is **prose** — there's no placeholder grid to fill. A single well-instructed call
(system prompt = the recipe, user content = the combined sources) produces a coherent draft in one
pass. Multi-stage would add latency and failure surface for no quality gain, because a human edits
the result anyway.

*Rejected:* outline-then-expand two-call flow. Overkill for a first draft; the recipe already
encodes the outline.

### 3.3 Same three inputs as the deck path
The blog draws on **uploaded files + ticked Scientific-Studies + the free-text Context field** — the
exact inputs the deck generator uses. This is deliberate: the user shouldn't learn a second mental
model. `_run_job` combines *all* provided files into one source string and hands it to the blog
generator, so "the studies I picked" flow in identically for both content types.

### 3.4 Route on a field, don't split the endpoint
Rather than a new `/blog` endpoint, `/jobs` gained one `innholdstype` field (`"deck"` | `"blog"`,
default `"deck"`). The job machinery — background thread, progress polling, one-shot result download,
TTL cleanup — is identical; only the **producer** and the **result's media type** differ. This kept
the frontend proxy and the polling UI unchanged apart from forwarding one extra field.

*Rejected:* a parallel endpoint + parallel job store. That would duplicate all the async plumbing.

### 3.5 Markdown out, editable in the browser
The result is **Markdown**, returned as `text/markdown` bytes. Markdown is human-editable, pastes
cleanly into a CMS, and renders predictably. The frontend shows it in an **editable textarea** with
**Copy** and **Download .md** — reinforcing that this is a *draft to shape*, not a finished
publication. (Decks still stream back as a binary `.pptx`/`.zip`; the result handler branches on
which was requested.)

### 3.6 Length & tone as dials, not free text
`length` maps to word-count bands (`kort` / `standard` / `detaljert`) and `tone` shifts the
science:marketing ratio (`vitenskap` / `balansert` / `salg`). Concrete, bounded knobs give
predictable output; "write it however" does not.

---

## 4. How it fits together (data flow)

```
Tab 2 (app/generator/page.tsx)
  content type = "Blog post"
  inputs: uploaded files + ticked studies (synthesized into a source file) + Context & instructions
        │  POST multipart, innholdstype="blog"
        ▼
/api/generate-deck  (route.ts)        ── forwards innholdstype among the form fields
        │  POST /jobs
        ▼
deck-service/main.py  create_job → background thread → _run_job
        │  innholdstype == "blog"?
        ▼
  combine ALL files into one source string
        │
        ▼
src.generate_blog (src/blog.py)
  build_system(length, tone, instructions)  ← the recipe + CLAIM_RULES + user context
  one Claude call (max_tokens≈6000), strip ``` fences
        │  { markdown, filename ".md", title }
        ▼
  stored as text/markdown bytes
        │  client polls /jobs/{id}, then downloads
        ▼
Tab 2 shows the draft in an editable panel  (Copy · Download .md)
```

---

## 5. Guardrails against the failure mode that matters

The one thing a science brand cannot ship is a **confident fabricated claim**. Mitigations:

- The system prompt imports **`CLAIM_RULES`** — the same "only state what the sources support; don't
  invent numbers, mechanisms, or outcomes" contract the deck planner uses.
- Sources are the **actual studies/uploads**, not the model's memory — the draft is anchored to
  provided text.
- The recipe demands **named studies with real numbers** in the evidence section, which surfaces
  gaps (a section with nothing to cite reads thin, prompting the human editor to add a source).
- The output is explicitly a **draft a human reviews** — the UI never implies auto-publish.

Residual risk: as with any LLM prose, a reviewer must still fact-check citations before publishing.
That's by design, not an oversight.

---

## 6. What was verified

- Backend imports clean; `src.generate_blog` reachable via the lazy entrypoint.
- Frontend `tsc` clean; `next build` clean.
- **End-to-end real run:** produced *"Beyond Moisturiser: How Krill Oil Supports Skin Hydration…"* —
  1,415 words, correct H2 arc, problem-hook intro, B2B voice, a named RCT, and a References section.
  On-recipe on the first try.

---

## 7. Known limitations & where to take it next

- **Citations aren't auto-verified.** The draft cites what the sources say; a human still confirms
  each reference. A future pass could cross-check every stated number against the source text.
- **One-shot generation.** No "regenerate just section 3" yet — you re-run or hand-edit. An
  outline-lock + per-section regenerate would help iteration.
- **No image/asset suggestions.** Prose only. Could suggest figure placements or pull chart-ready
  stats.
- **Persistence.** Like Tab 1's summary edits, an edited draft lives only in the browser until
  downloaded — see the localStorage weakness flagged in `../STATUS.md` / the
  `summary-edit-persistence-localstorage` memory. A shared store (Supabase) would let drafts be saved
  and co-edited.
- **Tone/length bands are fixed.** Fine for now; could expose finer control if editors want it.

---

## 8. One-line summary

*Blog drafting reuses the deck tool's inputs and its claim-fidelity discipline, but swaps the
structured plan→render pipeline for a single recipe-driven Claude call that emits editable Markdown —
because a blog is prose a human shapes, not a schema-bound artifact.*
