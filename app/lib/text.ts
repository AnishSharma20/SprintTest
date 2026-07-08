// Decode HTML entities for display. PubMed abstracts arrive with numeric entities (e.g. &#xb1;
// for ±, &#956; for µ); we store the quote verbatim (so the deterministic source check matches the
// raw abstract), and decode only at display time.
export function decodeEntities(s: string): string {
  if (!s) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}
