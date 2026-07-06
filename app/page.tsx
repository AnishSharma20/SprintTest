// Scientific Studies tab — Aker BioMarine-affiliated krill-oil research from PubMed, with
// verified (whitepaper) + AI-generated summaries. Data lives in ./studies (shared with the
// content generator's study picker). Server component; data cached/updated daily.

import Wiki from "./wiki";
import { hentStudier } from "./studies";

export default async function Home() {
  const studier = await hentStudier();
  return <Wiki studier={studier} />;
}
