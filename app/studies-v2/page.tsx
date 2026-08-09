// Scientific Studies V2 — the redesigned research wiki (sidebar explorer + reading panel).
// Deliberately a separate page from "/" so the team can compare both, exactly like the
// Content Generator V2 pattern. Same data source as V1; nothing in app/wiki.tsx changed.

import WikiV2 from "./wiki-v2";
import { hentStudier } from "../studies";

export default async function StudiesV2Page() {
  const studier = await hentStudier();
  return <WikiV2 studier={studier} />;
}
