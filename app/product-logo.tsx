// One product's brand mark — shared by the Content Generator's product picker and the About
// page's brand picker, so the two can never drift apart (same reason products.ts is shared).
//
// The files in public/logos/ are the official marks from each brand's own site. They are
// WORDMARKS: each already spells the product name, so a tile that shows one drops its duplicate
// text label and keeps only the hint line underneath.
//
// Their aspect ratios are far apart (Superba is ~7.9:1, the other three ~4:1), so a fixed height
// would render Superba twice as wide as its neighbours. Instead every mark is fitted inside ONE
// uniform box with object-contain — the box is identical tile to tile even though the marks are
// not, which is what makes a row of mixed logos read as deliberate.
//
// Lysoveta publishes only an inverted lockup (white wordmark for dark backgrounds; both
// akerbiomarine.com and lysoveta.com are dark sites), which would be invisible on our white
// tiles. Rather than recolour someone else's logo, it is drawn on a chip in its own brand navy —
// the background the asset was designed for. If the design team supplies a positive lockup, swap
// the file and drop `logoOnDark` in products.ts; nothing here needs to change.

import type { Product } from "./products";

export function ProductLogo({ product }: { product: Product }) {
  if (!product.logo) return null;
  const mark = (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimisation wanted
    <img src={product.logo} alt={product.label} className="max-h-full max-w-full object-contain" />
  );
  return (
    <div className="mb-2 flex h-9 items-center justify-center">
      {product.logoOnDark ? (
        <span className="flex h-full max-w-full items-center rounded-lg bg-[#25345D] px-2 py-1.5">{mark}</span>
      ) : (
        mark
      )}
    </div>
  );
}
