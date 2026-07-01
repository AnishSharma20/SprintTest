// Option B: Claude emits a PPT Master `template_fill_pptx_plan.v1` fill plan.
// The tool schema below constrains the model to the plan's `slides` array; the
// route wraps it with schema/status/source_pptx before handing it to the
// PPT Master `apply` step.

export const FILL_PLAN_SCHEMA = {
  type: "object",
  properties: {
    slides: {
      type: "array",
      description:
        "Ordered output slides. Each reuses one source slide from the template library and fills its text slots.",
      items: {
        type: "object",
        properties: {
          source_slide: {
            type: "integer",
            description:
              "1-based index of the source slide to clone, taken from the provided slide library.",
          },
          purpose: {
            type: "string",
            description: "cover / chapter / content / ending — why this slide exists in the deck.",
          },
          layout_rationale: {
            type: "object",
            properties: {
              layout_pattern: { type: "string" },
              why_fit: { type: "string" },
              risk: { type: "string" },
            },
            required: ["layout_pattern", "why_fit", "risk"],
          },
          replacements: {
            type: "array",
            description:
              "One entry per text slot you fill. slot_id MUST be a slot that exists on this source_slide in the library.",
            items: {
              type: "object",
              properties: {
                slot_id: { type: "string", description: "Exact slot_id from the library for this source_slide." },
                text: { type: "string", description: "Replacement text. Concise; must fit the slot." },
              },
              required: ["slot_id", "text"],
            },
          },
        },
        required: ["source_slide", "purpose", "layout_rationale", "replacements"],
      },
    },
  },
  required: ["slides"],
} as const;

// prompt.py — BRAND VOICE + HARD CONSTRAINTS kept verbatim. Only the STRUCTURE
// section is adapted from the old emit_deck schema to the fill-plan workflow,
// because Option B's output must be a template_fill_pptx_plan.v1, not emit_deck.
export const SYSTEM_PROMPT = `You convert a verified Superba Krill science summary into a slide-fill plan for a branded PowerPoint template. You output ONLY via the emit_fill_plan tool (forced JSON). You never write free text.

BRAND VOICE
- Superba Krill by Aker BioMarine: premium krill oil, marine phospholipid omega-3s (EPA/DHA), choline, astaxanthin.
- Confident, science-led, clean. No hype, no superlatives that the summary does not support.

HARD CONSTRAINTS (non-negotiable)
1. Every claim must trace to the input summary. If the summary does not state it, you do not write it. Do not fill gaps with plausible-sounding benefits.
2. Null and negative results are carried through honestly, never dropped. If a study found no effect on an endpoint, that is content, not something to hide.
3. EFSA-approved claims: only state an EFSA claim as approved when the summary explicitly says so (in the Superba portfolio only Heart and Liver carry EFSA-approved claims). Never imply approval otherwise.
4. Citations are taken verbatim-ish from the summary (author, journal, year) if provided. If the summary gives no citation, do not add one. NEVER invent a citation, journal, or year.
5. Trial counts come from the summary. If the summary does not state a count, do not state one.
6. Keep replacement text short enough to fit the slot — titles are short lines, labels are short phrases. A capacity check runs after you; overflow is rejected.

STRUCTURE (fill-plan workflow)
- You are given a SLIDE LIBRARY, one line per source slide: "#<index> [<page_type>] <slot_id> (<role>), <slot_id> (<role>), ...". The slot_id is the exact token BEFORE the parenthesis (e.g. "s04_sh3"); the role in parentheses (title / label / body) is only guidance — never include it in slot_id.
- Build the deck by choosing source slides in a sensible order and filling their slots:
  - Open with the cover_candidate slide (deck title + subtitle).
  - Use chapter_candidate slides as section dividers (short titles).
  - Use content_candidate slides for benefit claims and evidence — put headings in title_candidate slots and claim text in label_candidate / body_candidate slots.
  - Close with the ending_candidate slide.
- In each slide's replacements, use ONLY slot_ids that the library lists for that exact source_slide. Do not invent slot_ids and do not reference slots from other slides.
- Aim for 6-10 slides. Prefer variety of source slides over repeating one layout.

You will receive the science summary and the slide library. Emit the fill plan now.`;

export type FillPlanSlide = {
  source_slide: number;
  purpose: string;
  layout_rationale: { layout_pattern: string; why_fit: string; risk: string };
  replacements: { slot_id: string; text: string }[];
};
export type FillPlan = { slides: FillPlanSlide[] };

export function validerPlan(d: unknown): d is FillPlan {
  const p = d as FillPlan;
  return (
    !!p &&
    Array.isArray(p.slides) &&
    p.slides.length > 0 &&
    p.slides.every(
      (s) =>
        Number.isInteger(s.source_slide) && Array.isArray(s.replacements)
    )
  );
}

// Compact the full slide_library.json into a small ground-truth the model can
// pick from: per slide -> index, page_type, and its slots (slot_id + role).
type LibSlot = { slot_id: string; role: string };
type LibSlide = { slide_index: number; page_type: string; slots?: LibSlot[] };
export function kompaktBibliotek(full: { slides: LibSlide[] }): string {
  const lines = full.slides.map((s) => {
    const slots = (s.slots ?? [])
      .map((sl) => `${sl.slot_id} (${sl.role.replace("_candidate", "")})`)
      .join(", ");
    return `#${s.slide_index} [${s.page_type.replace("_candidate", "")}] ${slots}`;
  });
  return lines.join("\n");
}
