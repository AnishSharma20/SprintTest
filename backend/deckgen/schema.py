"""
Superba deck content schema — the forced-JSON output shape for the Claude API call.

This mirrors the real one-pager brochure structure (verified against
3__Superba_Main_Brochure_digital.pdf), NOT the handover's assumption:

  - EFSA-approved claims are RARE. Only Heart (3) and Liver (1) carry them in the
    brochure. Default is efsa_approved=false; only set true when the source summary
    explicitly confirms an approved EFSA claim.
  - Claims are PLURAL per benefit area, bullet-style, not a single sentence.
  - Trial counts are stated as integers ("Backed by 8 Published Human Clinical Trials").
  - Source citation is NOT in the one-pager. It comes from the underlying science
    summary if present; otherwise leave sources empty. Never invent a citation.

Used as the JSON schema for a tool_use / forced-function-call so the model cannot
return free text. Every claim must trace to the input summary; null results are
carried through, not dropped.
"""

DECK_SCHEMA = {
    "type": "object",
    "properties": {
        "deck_title": {
            "type": "string",
            "description": "Main deck title. Short, benefit-led. Max ~60 chars.",
        },
        "deck_subtitle": {
            "type": "string",
            "description": "One-line supporting statement under the title. Max ~120 chars.",
        },
        "sections": {
            "type": "array",
            "description": "Ordered content sections. Each becomes one or more slides.",
            "items": {
                "type": "object",
                "properties": {
                    "section_title": {
                        "type": "string",
                        "description": "Section / benefit-area heading, e.g. 'Skin Support'. Max ~40 chars.",
                    },
                    "kind": {
                        "type": "string",
                        "enum": ["section_header", "benefit_claim", "stat", "summary"],
                        "description": "Content type. Drives which template layout the renderer picks.",
                    },
                    "benefit_area": {
                        "type": "string",
                        "enum": [
                            "Heart", "Skin", "Joint", "Liver", "PMS",
                            "Cognitive", "Eye", "Muscle", "Sport",
                            "Wellness", "Weight Loss", "Healthy Aging", "None",
                        ],
                        "description": "Maps to a health-benefit icon. 'None' if not benefit-specific.",
                    },
                    "claims": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Bullet claims for this section. Each max ~120 chars. Only claims supported by the summary.",
                    },
                    "trial_count": {
                        "type": "integer",
                        "description": "Number of human clinical trials backing this benefit area. 0 if unknown.",
                    },
                    "efsa_approved": {
                        "type": "boolean",
                        "description": "TRUE only if the summary explicitly confirms an EFSA-approved claim. Default FALSE.",
                    },
                    "stats": {
                        "type": "array",
                        "description": "For kind='stat': big-number callouts.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "value": {"type": "string", "description": "e.g. '4x', '50+', '96%'"},
                                "label": {"type": "string", "description": "Short label under the number."},
                            },
                            "required": ["value", "label"],
                        },
                    },
                    "source": {
                        "type": "string",
                        "description": "Citation from the summary if present (author, journal, year). Empty string if none. NEVER invent.",
                    },
                },
                "required": ["section_title", "kind", "benefit_area", "claims",
                             "trial_count", "efsa_approved", "stats", "source"],
            },
        },
    },
    "required": ["deck_title", "deck_subtitle", "sections"],
}
