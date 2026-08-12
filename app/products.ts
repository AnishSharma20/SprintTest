// The AKBM product/brand list — shared by the Content Generator's product picker and the
// About page's brand picker so the two never drift apart.
//
// Superba and Revervia both generate real decks: each has its own PowerPoint template, palette,
// typography, photo library and icons in deck-service/brands/. They are NOT equally complete.
// Superba additionally owns the science layer (studies, approved findings) and the About page's
// team settings (writing rules, design overrides, uploaded slides and photos); those tables are
// still single-brand, so Revervia generates from uploaded sources and free-text context only —
// see BRAND_FEATURES below. Lysoveta and PL+ have no brand pack at all and stay "Soon".

export type ProductId = "superba" | "revervia" | "lysoveta" | "pl_plus";

/** logo: the product's REAL brand mark under public/logos/, taken from that brand's own site.
 *  Omit it and the tile falls back to its text name — never a stand-in shape, which would
 *  misrepresent the brand.
 *
 *  logoH: the mark's height in px, per product on purpose. Every file in public/logos/ is cropped
 *  to its own ink (scripts/normalize_logos.py), so these heights are comparable — but the marks
 *  still devote very different shares of that height to LETTERING: 74% for Superba, 34% for PL+,
 *  whose plus sign overshoots the banner top and bottom. One shared height would therefore render
 *  the text at visibly different sizes. Each value below is measured so all four show lettering
 *  about 11px tall, which is what the eye actually compares. Re-run the script after replacing a
 *  file; it prints the value to use.
 *
 *  logoNudge: vertical correction in px, because centring a mark's ink does NOT centre its
 *  lettering. Revervia's droplet rises far above its wordmark, so centring the artwork left its
 *  text sitting ~3px below the other three across a row of tiles. The script measures this too. */
export type Product = {
  id: ProductId;
  label: string;
  hint: string;
  logo?: string;
  logoH?: number;
  logoNudge?: number;
  available: boolean;
};

/** Which parts of the tool a brand actually has. Kept beside the list so a half-wired brand
 *  cannot quietly inherit another brand's science or another brand's team settings. */
/** colorThemes: the deck backgrounds this brand's template can actually render, in the order the
 *  UI offers them. The FIRST is the brand's default and the one whose preview images live in the
 *  unsuffixed public/layout-gallery/<brand>/ folder. Superba's template carries a dark master and
 *  a light one, giving three themes; Revervia's has a single light master, so it has exactly one —
 *  offering it a "White" or "Pastel Blue" choice would be offering a background it cannot draw. */
export const BRAND_FEATURES: Record<ProductId, {
  science: boolean;
  teamSettings: boolean;
  contentTypes: string[];
  colorThemes: { id: string; label: string; hint: string }[];
}> = {
  superba: {
    science: true, teamSettings: true, contentTypes: ["deck", "blog", "whitepaper_mix"],
    colorThemes: [
      { id: "dark", label: "Blue Ocean", hint: "Dark theme · deep-sea gradient" },
      { id: "light", label: "White", hint: "Light theme · plain white" },
      { id: "pastel", label: "Pastel Blue", hint: "Light theme · solid mint" },
    ],
  },
  revervia: {
    science: false, teamSettings: true, contentTypes: ["deck"],
    colorThemes: [{ id: "dark", label: "Marine", hint: "Light theme · white to Alice Blue" }],
  },
  lysoveta: { science: false, teamSettings: false, contentTypes: [], colorThemes: [] },
  pl_plus:  { science: false, teamSettings: false, contentTypes: [], colorThemes: [] },
};

export const PRODUCTS: Product[] = [
  { id: "superba", label: "Superba", hint: "", logo: "/logos/superba.png", logoH: 15, available: true },
  { id: "revervia", label: "Revervia", hint: "", logo: "/logos/revervia.svg", logoH: 22, logoNudge: -3, available: true },
  { id: "lysoveta", label: "Lysoveta", hint: "", logo: "/logos/lysoveta.svg", logoH: 18, available: false },
  { id: "pl_plus", label: "PL+", hint: "", logo: "/logos/pl-plus.svg", logoH: 32, available: false },
];
