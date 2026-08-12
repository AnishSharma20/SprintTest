// The AKBM product/brand list — shared by the Content Generator's product picker and the
// About page's brand picker so the two never drift apart. Only Superba is wired to anything
// today (its own studies, findings, rules, design settings, slide and photo library); the
// other three are shown as real tiles marked "Soon" so the client can see the shape of what's
// coming without us pretending they already work.

export type ProductId = "superba" | "revervia" | "lysoveta" | "pl_plus";

/** logo: the product's REAL brand mark under public/logos/, taken from that brand's own site.
 *  Omit it and the tile falls back to its text name — never a stand-in shape, which would
 *  misrepresent the brand. logoOnDark: the only published lockup is the INVERTED one (white
 *  wordmark, meant for a dark background), so it is drawn on a dark chip instead of being
 *  recoloured. See ProductLogo in product-logo.tsx. */
export type Product = {
  id: ProductId;
  label: string;
  hint: string;
  logo?: string;
  logoOnDark?: boolean;
  available: boolean;
};

export const PRODUCTS: Product[] = [
  { id: "superba", label: "Superba", hint: "Krill oil", logo: "/logos/superba.png", available: true },
  { id: "revervia", label: "Revervia", hint: "", logo: "/logos/revervia.svg", available: false },
  { id: "lysoveta", label: "Lysoveta", hint: "", logo: "/logos/lysoveta.svg", logoOnDark: true, available: false },
  { id: "pl_plus", label: "PL+", hint: "", logo: "/logos/pl-plus.svg", available: false },
];
