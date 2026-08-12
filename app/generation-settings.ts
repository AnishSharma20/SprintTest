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
    /** Present = the AI writes this design's text into these measured boxes; absent = verbatim. */
    slots?: unknown[];
  }[];
  /** file_id → base64 .pptx, deduplicated (several slides can come from one upload). */
  files: Record<string, string>;
};

export type CustomPhotoPayload = {
  meta: { id: string; name: string; description: string }[];
  /** photo id → base64 JPEG. */
  files: Record<string, string>;
};

export type LayoutOverridePayload = {
  meta: {
    layout: string;
    file_id: string;
    slide_index: number;
    slots: unknown[];
    preview_b64?: string;
  }[];
  /** file_id → base64 .pptx (one dedicated file per overridden layout). */
  files: Record<string, string>;
};

export type DeckSettings = {
  customRules: string;
  /** JSON array of the team's STRUCTURE rules ({slide, action, position}) — which slides every
   * deck must have and where they sit. "" keeps the deck service's built in shape. */
  structureRules: string;
  /** JSON object {block_key: text} of the built in WRITING rules the team now owns. "" means they
   * were never imported, and the deck service keeps using its own defaults. */
  managedBlocks: string;
  disabledLayouts: string;
  preferredLayouts: string;
  disabledPhotos: string;
  preferredPhotos: string;
  /** JSON string of the design overrides ("" when none are set). */
  designSettings: string;
  customSlides: CustomSlidePayload;
  customPhotos: CustomPhotoPayload;
  layoutOverrides: LayoutOverridePayload;
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
  if (s.structureRules) form.append("structure_rules", s.structureRules);
  if (s.managedBlocks) form.append("managed_blocks", s.managedBlocks);
  if (s.disabledLayouts) form.append("disabled_layouts", s.disabledLayouts);
  if (s.preferredLayouts) form.append("preferred_layouts", s.preferredLayouts);
  if (s.disabledPhotos) form.append("disabled_photos", s.disabledPhotos);
  if (s.preferredPhotos) form.append("preferred_photos", s.preferredPhotos);
  if (s.designSettings) form.append("design_settings", s.designSettings);
  if (s.customSlides.meta.length) {
    form.append("custom_slides_meta", JSON.stringify(s.customSlides.meta));
    for (const [fileId, b64] of Object.entries(s.customSlides.files)) {
      form.append("custom_files", b64ToBlob(b64), `${fileId}.pptx`);
    }
  }
  if (s.customPhotos.meta.length) {
    form.append("custom_photos_meta", JSON.stringify(s.customPhotos.meta));
    for (const [photoId, b64] of Object.entries(s.customPhotos.files)) {
      form.append("custom_photo_files", b64ToBlob(b64), `${photoId}.jpg`);
    }
  }
  if (s.layoutOverrides.meta.length) {
    form.append("layout_overrides_meta", JSON.stringify(s.layoutOverrides.meta));
    // Override .pptx blobs ride the SAME custom_files channel as team slides (the service
    // indexes both by <file_id>.pptx). Override files are dedicated rows, so a collision with
    // a team-slide file id can't happen — the guard is just one cheap line.
    for (const [fileId, b64] of Object.entries(s.layoutOverrides.files)) {
      if (!(fileId in s.customSlides.files)) form.append("custom_files", b64ToBlob(b64), `${fileId}.pptx`);
    }
  }
}

export async function deckGenerationSettings(brand: string): Promise<DeckSettings> {
  // The brand rides the query string; every settings route resolves it from there.
  const q = (url: string) => url + (url.includes("?") ? "&" : "?") + "brand=" + encodeURIComponent(brand);
  let customRules = "";
  let structureRules = "";
  let managedBlocks = "";
  let disabledLayouts = "";
  let preferredLayouts = "";
  let disabledPhotos = "";
  const preferredPhotoIds: string[] = [];
  let designSettings = "";
  const customSlides: CustomSlidePayload = { meta: [], files: {} };
  const customPhotos: CustomPhotoPayload = { meta: [], files: {} };
  const layoutOverrides: LayoutOverridePayload = { meta: [], files: {} };
  try {
    const r = await (await fetch(q("/api/rules"))).json();
    const active = (r.rules ?? []).filter((x: { enabled?: boolean }) => x.enabled);
    type RuleRow = {
      text: string;
      slide_key?: string | null;
      action?: string | null;
      position?: string | null;
      builtin_key?: string | null;
    };
    // Three kinds, and they travel differently: a STRUCTURE rule is data the pipeline applies
    // (some are deck wide and carry no slide), the team's copies of the BUILT IN writing rules
    // replace the prompt's own text, and rules they wrote themselves go as numbered prose.
    const structural = (active as RuleRow[]).filter((x) => x.action);
    const builtin = (active as RuleRow[]).filter((x) => !x.action && x.builtin_key);
    const own = (active as RuleRow[]).filter((x) => !x.action && !x.builtin_key);
    customRules = own.map((x, i) => `${i + 1}. ${x.text.trim()}`).join("\n");
    // Sent whenever the column exists, so a key missing from the object reads as "switched off"
    // rather than "never imported" — that is what lets a deleted rule actually disappear.
    if (r.builtinManaged)
      managedBlocks = JSON.stringify(
        Object.fromEntries(builtin.map((x) => [x.builtin_key as string, x.text]))
      );
    // Sent whenever the structural columns exist — INCLUDING as "[]". An empty list is a real
    // answer ("the team removed every structure rule") and must not be mistaken for "no answer",
    // which is what makes the deck service fall back to its built in shape.
    if (r.structureMigrated !== false)
      structureRules = JSON.stringify(
        structural.map((x) => ({ slide: x.slide_key, action: x.action, position: x.position ?? undefined }))
      );
  } catch {
    /* no settings — generate as before */
  }
  try {
    const l = await (await fetch(q("/api/layout-settings"))).json();
    disabledLayouts = (l.disabled ?? []).join(",");
    preferredLayouts = (l.preferred ?? []).join(",");
  } catch {
    /* no settings — generate as before */
  }
  try {
    const ps = await (await fetch(q("/api/photo-settings"))).json();
    disabledPhotos = (ps.disabled ?? []).join(",");
    preferredPhotoIds.push(...((ps.preferred ?? []) as string[]));
  } catch {
    /* no settings — generate as before */
  }
  try {
    const d = await (await fetch(q("/api/design-settings"))).json();
    if (d.settings && Object.keys(d.settings).length) designSettings = JSON.stringify(d.settings);
  } catch {
    /* no settings — generate as before */
  }
  try {
    const c = await (await fetch(q("/api/custom-slides?blobs=1"))).json();
    const files: Record<string, string> = c.files ?? {};
    let budget = MAX_CUSTOM_BYTES;
    const sentFiles: Record<string, string> = {};
    const slides = (c.slides ?? []) as (CustomSlidePayload["meta"][number] & { preview_b64: string | null })[];
    for (const s of slides) {
      // Removed slides ship no blob from the server anyway (?blobs=1 excludes them); the
      // explicit check makes the intent auditable here too.
      if (s.mode === "off" || (s as { removed?: boolean }).removed) continue;
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
        slots: s.slots?.length ? s.slots : undefined,
      });
    }
    customSlides.files = sentFiles;
  } catch {
    /* no settings — generate as before */
  }
  try {
    const p = await (await fetch(q("/api/custom-photos?blobs=1"))).json();
    let budget = MAX_CUSTOM_BYTES; // photos get their own budget; each is a few hundred KB
    for (const ph of (p.photos ?? []) as {
      id: string;
      name: string;
      description: string;
      preferred?: boolean;
      image_b64?: string;
    }[]) {
      if (!ph.image_b64) continue;
      const cost = Math.ceil(ph.image_b64.length * 0.75);
      if (cost > budget) {
        console.warn(`Skipping team photo "${ph.name}" — the job payload would get too large.`);
        continue;
      }
      budget -= cost;
      customPhotos.files[ph.id] = ph.image_b64;
      customPhotos.meta.push({ id: ph.id, name: ph.name, description: ph.description });
      // ?blobs=1 already filters to enabled photos, so a preferred one here is always usable.
      if (ph.preferred) preferredPhotoIds.push(`team_photo_${ph.id}`);
    }
  } catch {
    /* no settings — generate as before */
  }
  try {
    const o = await (await fetch(q("/api/layout-overrides?blobs=1"))).json();
    const files: Record<string, string> = o.files ?? {};
    const disabledSet = new Set(disabledLayouts.split(",").filter(Boolean));
    let budget = MAX_CUSTOM_BYTES; // own budget, same ceiling rationale as team slides
    for (const ov of (o.overrides ?? []) as (LayoutOverridePayload["meta"][number] & {
      enabled?: boolean;
      preview_b64?: string | null;
    })[]) {
      // A disabled/removed layout can't be planned — its bytes would be dead weight.
      if (disabledSet.has(ov.layout)) continue;
      const blob = files[ov.file_id];
      if (!blob) continue;
      const preview = ov.preview_b64 ?? "";
      const cost = Math.ceil(blob.length * 0.75) + preview.length;
      if (cost > budget) {
        console.warn(`Skipping the "${ov.layout}" design override — the job payload would get too large.`);
        continue;
      }
      budget -= cost;
      layoutOverrides.files[ov.file_id] = blob;
      layoutOverrides.meta.push({
        layout: ov.layout,
        file_id: ov.file_id,
        slide_index: ov.slide_index,
        slots: ov.slots ?? [],
        preview_b64: preview || undefined,
      });
    }
  } catch {
    /* no settings — generate as before */
  }
  return {
    customRules,
    structureRules,
    managedBlocks,
    disabledLayouts,
    preferredLayouts,
    disabledPhotos,
    preferredPhotos: preferredPhotoIds.join(","),
    designSettings,
    customSlides,
    customPhotos,
    layoutOverrides,
  };
}
