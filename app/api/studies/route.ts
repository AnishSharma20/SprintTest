// GET /api/studies — the study list (with summaries) for the content generator's picker.
// Same data as the Scientific Studies tab, so the generator can use those summaries as source.

import { hentStudier } from "../../studies";

export const revalidate = 86400;

export async function GET() {
  const studier = await hentStudier();
  return Response.json(studier);
}
