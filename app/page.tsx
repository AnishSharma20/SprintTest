// Scientific Studies — the "floating & focused" research wiki (sidebar explorer + reading panel).
// Data comes from app/studies.ts, shared with the content generator's study picker.

import WikiV2 from "./wiki-v2";
import { hentStudier } from "./studies";

export default async function StudiesPage() {
  const studier = await hentStudier();
  return <WikiV2 studier={studier} />;
}
