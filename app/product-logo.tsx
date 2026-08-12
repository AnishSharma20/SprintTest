// One product's brand mark — shared by the Content Generator's product picker and the About
// page's brand picker, so the two can never drift apart (same reason products.ts is shared).
//
// The files in public/logos/ are the official marks from each brand's own site. They are
// WORDMARKS: each already spells the product name, so a tile that shows one drops its text label.
//
// Sizing is per product rather than one shared height, because these four marks put very
// different amounts of lettering inside their own bounding box — Superba's wordmark fills 68% of
// its height, PL+'s only 34% (its plus sign overshoots the banner top and bottom). Fitting them
// all to one box would render the lettering at visibly different sizes, which is what makes a row
// of mixed logos look accidental. Each `logoH` in products.ts was measured from the file so every
// mark shows lettering of roughly the same size. Width is capped at the tile, which is the binding
// constraint for the two widest marks (Superba is ~7.9:1).
//
// Lysoveta publishes only an inverted lockup (white wordmark for dark backgrounds; both
// akerbiomarine.com and lysoveta.com are dark sites), which would be invisible on our white
// tiles. Rather than recolour someone else's logo, it is drawn on a chip in its own brand navy —
// the background the asset was designed for. Replace the file with a positive lockup and drop
// `logoOnDark` in products.ts; nothing here needs to change.

import type { Product } from "./products";

/** Height of the band the mark is centred in. Tall enough for the tallest `logoH` above. */
const BOX = "flex h-8 items-center justify-center";

export function ProductLogo({ product }: { product: Product }) {
  if (!product.logo) return null;

  if (product.logoOnDark) {
    return (
      <div className={BOX}>
        <span className="flex h-full max-w-full items-center rounded-lg bg-[#25345D] px-2 py-1.5">
          {/* The chip, not logoH, bounds the mark here — it has to sit inside its own padding. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
          <img src={product.logo} alt={product.label} className="max-h-full max-w-full object-contain" />
        </span>
      </div>
    );
  }

  return (
    <div className={BOX}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
      <img
        src={product.logo}
        alt={product.label}
        style={{ maxHeight: product.logoH ?? 26 }}
        className="max-w-full object-contain"
      />
    </div>
  );
}
