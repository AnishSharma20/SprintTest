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
 *  logoH: the mark's max height in px. Per product on purpose. These four marks put wildly
 *  different amounts of lettering inside their own bounding box (Superba's wordmark fills 68% of
 *  its height, PL+'s only 34%, because the plus sign overshoots the banner), so one shared height
 *  would render the lettering at visibly different sizes. Each value was measured from the file so
 *  every mark shows lettering of roughly the same size; width is capped at the tile, which is what
 *  binds for the widest two.
 *
 *  logoOnDark: the only lockup this brand publishes is the INVERTED one (white wordmark, for a dark
 *  background), so it is drawn on a chip in its own brand navy rather than recoloured. Drop the flag
 *  once a positive lockup replaces the file. See ProductLogo in product-logo.tsx. */
export type Product = {
  id: ProductId;
  label: string;
  hint: string;
  logo?: string;
  logoH?: number;
  logoOnDark?: boolean;
  available: boolean;
};

export const PRODUCTS: Product[] = [
  { id: "superba", label: "Superba", hint: "", logo: "/logos/superba.png", logoH: 26, available: true },
  { id: "revervia", label: "Revervia", hint: "", logo: "/logos/revervia.svg", logoH: 25, available: false },
  { id: "lysoveta", label: "Lysoveta", hint: "", logo: "/logos/lysoveta.svg", logoH: 22, logoOnDark: true, available: false },
  { id: "pl_plus", label: "PL+", hint: "", logo: "/logos/pl-plus.svg", logoH: 30, available: false },
];
