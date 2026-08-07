// The About page's deck settings, fetched fresh at generation time so a rule or layout
// switch applies to the very next deck without a reload. Both generator pages call this
// for PPTX jobs only (the rules govern deck planning; blog/whitepaper have their own
// prompts). Failures return empty settings — generation must never be blocked because the
// settings database is missing or the migration has not been run.

export type DeckSettings = { customRules: string; disabledLayouts: string };

export async function deckGenerationSettings(): Promise<DeckSettings> {
  let customRules = "";
  let disabledLayouts = "";
  try {
    const r = await (await fetch("/api/rules")).json();
    const active = (r.rules ?? []).filter((x: { enabled?: boolean }) => x.enabled);
    // Numbered so the planner can follow several rules without merging them into one.
    customRules = active
      .map((x: { text: string }, i: number) => `${i + 1}. ${x.text.trim()}`)
      .join("\n");
  } catch {
    /* no settings — generate as before */
  }
  try {
    const l = await (await fetch("/api/layout-settings")).json();
    disabledLayouts = (l.disabled ?? []).join(",");
  } catch {
    /* no settings — generate as before */
  }
  return { customRules, disabledLayouts };
}
