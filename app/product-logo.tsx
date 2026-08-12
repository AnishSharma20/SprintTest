// One product's brand mark — shared by the Content Generator's product picker and the About
// page's brand picker, so the two can never drift apart (same reason products.ts is shared).
//
// The files in public/logos/ are the official marks from each brand's own site, cropped to their
// own ink by scripts/normalize_logos.py. The cropping matters: each brand ships its logo on its own
// canvas with its own blank margins, and a browser centres the FILE, not the artwork — so uncropped
// marks look misaligned and randomly sized however carefully the box is set up.
//
// They are WORDMARKS: each already spells the product name, so a tile showing one drops its text
// label. Height comes from products.ts per mark, because they devote very different shares of their
// height to lettering (see the note there).
//
// The height is set INLINE rather than with a max-h-* class on purpose. These SVGs carry only a
// viewBox, no width/height, so they have no intrinsic pixel size; `max-h-full` + `max-w-full`
// inside a content-sized flex parent then resolves circularly and the image collapses to zero
// width. An explicit height gives the browser the one number it needs to derive the rest from the
// aspect ratio. max-w-full stays as the guard for the widest marks in a narrow tile.
//
// `logoNudge` then corrects the vertical position, because centring a mark's ink is not the same as
// centring its lettering: a mark whose icon rises above its wordmark (Revervia) ends up with its
// text low relative to the others. The nudge is a transform rather than a margin so it shifts the
// mark optically without changing the row's layout.

import type { Product } from "./products";

export function ProductLogo({ product }: { product: Product }) {
  if (!product.logo) return null;
  const nudge = product.logoNudge ?? 0;
  return (
    <div className="flex h-9 items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
      <img
        src={product.logo}
        alt={product.label}
        style={{
          height: product.logoH ?? 22,
          ...(nudge ? { transform: `translateY(${nudge}px)` } : {}),
        }}
        className="max-w-full object-contain"
      />
    </div>
  );
}
