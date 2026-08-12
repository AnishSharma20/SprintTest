// The AKBM product/brand list — shared by the Content Generator's product picker and the
// About page's brand picker so the two never drift apart. Only Superba is wired to anything
// today (its own studies, findings, rules, design settings, slide and photo library); the
// other three are shown as real tiles marked "Soon" so the client can see the shape of what's
// coming without us pretending they already work.

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
 *  file; it prints the value to use. */
export type Product = {
  id: ProductId;
  label: string;
  hint: string;
  logo?: string;
  logoH?: number;
  available: boolean;
};

export const PRODUCTS: Product[] = [
  { id: "superba", label: "Superba", hint: "", logo: "/logos/superba.png", logoH: 15, available: true },
  { id: "revervia", label: "Revervia", hint: "", logo: "/logos/revervia.svg", logoH: 22, available: false },
  { id: "lysoveta", label: "Lysoveta", hint: "", logo: "/logos/lysoveta.svg", logoH: 18, available: false },
  { id: "pl_plus", label: "PL+", hint: "", logo: "/logos/pl-plus.svg", logoH: 32, available: false },
];
