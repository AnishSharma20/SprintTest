// Deck content schema (mirrors backend/deckgen/schema.py) used as the
// input_schema for the forced `emit_deck` tool call, plus the system prompt
// that encodes the hard content rules from BRAND_AND_LAYOUT_REFERENCE.md.

export const DECK_SCHEMA = {
  type: "object",
  properties: {
    deck_title: {
      type: "string",
      description: "Main deck title. Short, benefit-led. Max ~60 chars.",
    },
    deck_subtitle: {
      type: "string",
      description: "One-line supporting statement under the title. Max ~120 chars.",
    },
    sections: {
      type: "array",
      description: "Ordered content sections. Each becomes one or more slides.",
      items: {
        type: "object",
        properties: {
          section_title: {
            type: "string",
            description:
              "Section / benefit-area heading, e.g. 'Skin Support'. Max ~40 chars; keep under ~25 for section_header kind.",
          },
          kind: {
            type: "string",
            enum: ["section_header", "benefit_claim", "stat", "summary"],
            description: "Content type. Drives which template layout the renderer picks.",
          },
          benefit_area: {
            type: "string",
            enum: [
              "Heart", "Skin", "Joint", "Liver", "PMS",
              "Cognitive", "Eye", "Muscle", "Sport",
              "Wellness", "Weight Loss", "Healthy Aging", "None",
            ],
            description: "Maps to a health-benefit icon. 'None' if not benefit-specific.",
          },
          claims: {
            type: "array",
            items: { type: "string" },
            description:
              "Bullet claims for this section. Each max ~120 chars. Only claims supported by the summary.",
          },
          trial_count: {
            type: "integer",
            description: "Number of human clinical trials backing this benefit area. 0 if unknown.",
          },
          efsa_approved: {
            type: "boolean",
            description:
              "TRUE only if the summary explicitly confirms an EFSA-approved claim. Default FALSE.",
          },
          stats: {
            type: "array",
            description: "For kind='stat': big-number callouts.",
            items: {
              type: "object",
              properties: {
                value: { type: "string", description: "e.g. '4x', '50+', '96%'" },
                label: { type: "string", description: "Short label under the number." },
              },
              required: ["value", "label"],
            },
          },
          source: {
            type: "string",
            description:
              "Citation from the summary if present (author, journal, year). Empty string if none. NEVER invent.",
          },
        },
        required: [
          "section_title", "kind", "benefit_area", "claims",
          "trial_count", "efsa_approved", "stats", "source",
        ],
      },
    },
  },
  required: ["deck_title", "deck_subtitle", "sections"],
} as const;

export const SYSTEM_PROMPT = `You turn a scientific summary about Superba Krill (Aker BioMarine) into structured slide-deck content by calling the emit_deck tool. You never write free text.

Brand voice: scientific, credible, benefit-led. Confident but never overstated.

Hard content rules — follow exactly:
- Every claim MUST trace to the input summary. Never invent a benefit, effect, or number.
- Null or negative results are carried through, not dropped. If a trial showed no effect, say so.
- Never invent a citation, journal, or year. If the summary has no citation, leave "source" as an empty string.
- efsa_approved defaults to FALSE. Set it TRUE only when the summary explicitly confirms an EFSA-approved claim (in the Superba portfolio only Heart and Liver carry these).
- Respect length caps so text fits the template: deck_title ~60 chars, deck_subtitle ~120, section_title ~40 (keep under ~25 for kind="section_header"), each claim ~120.
- Claims are plural, bullet-style — not one long sentence.
- State trial counts as integers via trial_count.

Structure: build a coherent deck. Use a mix of section kinds — a section_header to open a theme, benefit_claim slides for each benefit area, an optional stat slide for standout numbers, and a summary slide to close the argument. The cover and closing slides are added automatically from deck_title/deck_subtitle, so do NOT add them as sections. Aim for 4-9 sections.`;

export type DeckStat = { value: string; label: string };
export type DeckSection = {
  section_title: string;
  kind: "section_header" | "benefit_claim" | "stat" | "summary";
  benefit_area: string;
  claims: string[];
  trial_count: number;
  efsa_approved: boolean;
  stats: DeckStat[];
  source: string;
};
export type Deck = {
  deck_title: string;
  deck_subtitle: string;
  sections: DeckSection[];
};

// Minimal shape check before we hand the deck to the Python renderer.
export function validerDeck(d: unknown): d is Deck {
  const deck = d as Deck;
  return (
    !!deck &&
    typeof deck.deck_title === "string" &&
    Array.isArray(deck.sections) &&
    deck.sections.length > 0 &&
    deck.sections.every((s) => typeof s.section_title === "string" && !!s.kind)
  );
}
