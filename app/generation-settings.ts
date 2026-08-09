// The About page's deck settings, fetched fresh at generation time so a rule, design change,
// layout switch or newly added team slide applies to the very next deck without a reload.
// Both generator pages call this for PPTX jobs only (the settings govern deck planning and
// rendering; blog/whitepaper have their own prompts). Failures return empty settings —
// generation must never be blocked because the settings database is missing or unmigrated.

export type CustomSlidePayload = {
  meta: {
    id: string;
    file_id: string;
    slide_index: number;
    name: string;
    description: string;
    mode: string;
    preview_b64?: string;
  }[];
  /** file_id → base64 .pptx, deduplicated (several slides can come from one upload). */
  files: Record<string, string>;
};

export type DeckSettings = {
  customRules: string;
  disabledLayouts: string;
  /** JSON string of the design overrides ("" when none are set). */
  designSettings: string;
  customSlides: CustomSlidePayload;
};

// The Vercel proxy in front of the deck service caps request bodies around 4.5 MB, and the job
// already carries the source files — keep the team-slide payload comfortably under that.
const MAX_CUSTOM_BYTES = 3_500_000;

export function b64ToBlob(b64: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}

/** Append the settings to a deck job's FormData (no-op for the parts that are empty). */
export function appendDeckSettings(form: FormData, s: DeckSettings): void {
  if (s.customRules) form.append("custom_rules", s.customRules);
  if (s.disabledLayouts) form.append("disabled_layouts", s.disabledLayouts);
  if (s.designSettings) form.append("design_settings", s.designSettings);
  if (s.customSlides.meta.length) {
    form.append("custom_slides_meta", JSON.stringify(s.customSlides.meta));
    for (const [fileId, b64] of Object.entries(s.customSlides.files)) {
      form.append("custom_files", b64ToBlob(b64), `${fileId}.pptx`);
    }
  }
}

export async function deckGenerationSettings(): Promise<DeckSettings> {
  let customRules = "";
  let disabledLayouts = "";
  let designSettings = "";
  const customSlides: CustomSlidePayload = { meta: [], files: {} };
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
  try {
    const d = await (await fetch("/api/design-settings")).json();
    if (d.settings && Object.keys(d.settings).length) designSettings = JSON.stringify(d.settings);
  } catch {
    /* no settings — generate as before */
  }
  try {
    const c = await (await fetch("/api/custom-slides?blobs=1")).json();
    const files: Record<string, string> = c.files ?? {};
    let budget = MAX_CUSTOM_BYTES;
    const sentFiles: Record<string, string> = {};
    const slides = (c.slides ?? []) as (CustomSlidePayload["meta"][number] & { preview_b64: string | null })[];
    for (const s of slides) {
      if (s.mode === "off") continue;
      const blob = files[s.file_id];
      if (!blob) continue;
      const preview = s.preview_b64 ?? "";
      // The .pptx blob (once per file) and this slide's preview both ride in the job body.
      const cost = (s.file_id in sentFiles ? 0 : Math.ceil(blob.length * 0.75)) + preview.length;
      if (cost > budget) {
        console.warn(`Skipping team slide "${s.name}" — the job payload would get too large.`);
        continue;
      }
      budget -= cost;
      if (!(s.file_id in sentFiles)) sentFiles[s.file_id] = blob;
      customSlides.meta.push({
        id: s.id,
        file_id: s.file_id,
        slide_index: s.slide_index,
        name: s.name,
        description: s.description,
        mode: s.mode,
        preview_b64: preview || undefined,
      });
    }
    customSlides.files = sentFiles;
  } catch {
    /* no settings — generate as before */
  }
  return { customRules, disabledLayouts, designSettings, customSlides };
}
