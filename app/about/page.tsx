"use client";

// About — team generation rules, design settings, slide library and photo library, presented as
// a tabbed card (rules/design/slides/photos) instead of one long stacked scroll: a slim masthead,
// with one section visible at a time behind a tab bar.

import { useCallback, useEffect, useRef, useState } from "react";
import { ReviewerField } from "../PageHero";
import gallery from "../layout-gallery.json";
import photoLibrary from "../photo-library.json";
import { PRODUCTS, type ProductId } from "../products";

const REVIEWER_KEY = "claimsReviewerName:v1"; // same key as the review pages — one name everywhere

type Rule = {
  id: number;
  text: string;
  enabled: boolean;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
};

type GalleryEntry = { key: string; kind: "template" | "synthetic" | "verbatim"; usage: string };

type CustomSlide = {
  id: string;
  file_id: string;
  slide_index: number;
  name: string;
  description: string;
  mode: "auto" | "always" | "off";
  preview_b64: string | null;
  removed?: boolean;
  /** Present = the AI writes this design's text each deck; absent = inserted exactly as drawn. */
  slots?: unknown[] | null;
  created_by?: string | null;
  created_at?: string;
};

/** A built-in layout whose design the team replaced from an uploaded .pptx — the AI keeps
 * writing the slide's text; only the look changes. */
type LayoutOverride = {
  layout: string;
  file_id: string;
  slide_index: number;
  preview_b64: string | null;
  enabled: boolean;
};

type NameOverride = { display_name?: string | null; description?: string | null };

type UploadPick = {
  index: number;
  preview_b64: string;
  picked: boolean;
  name: string;
  description: string;
  mode: "auto" | "always";
  /** true = the AI writes this slide's text into the design (the default: it is what someone
   * who restyled one of our slides and uploaded it back means); false = keep it exactly as
   * drawn. `slots`/`slotsError` are filled lazily by measuring the design when it is ticked. */
  aiFills: boolean;
  slots?: unknown[];
  slotsBusy?: boolean;
  slotsError?: string;
};

type DesignSettings = {
  title_font?: string;
  body_font?: string;
  size_title?: number | string;
  size_body?: number | string;
  size_small?: number | string;
  line_spacing?: number | string;
  margin_in?: number | string;
  gutter_in?: number | string;
  footer_text?: string;
  page_numbers?: boolean;
  date_stamp?: boolean;
  photo_level?: string;
  icon_level?: string;
};

type CustomPhoto = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  preferred: boolean;
  thumb_b64: string | null;
  removed?: boolean;
  created_by?: string | null;
};

type BuiltinPhoto = { id: string; description: string; bg_fit: string };

type TabKey = "rules" | "design" | "slides" | "photos";
const TABS: { id: TabKey; label: string }[] = [
  { id: "rules", label: "Rules" },
  { id: "design", label: "Design" },
  { id: "slides", label: "Slide library" },
  { id: "photos", label: "Photo library" },
];

/** Small line icons for the tab bar, matching the "About V2" mockup's sidebar concept. */
function TabIcon({ id }: { id: TabKey }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8 } as const;
  if (id === "rules") return <svg {...common} className="h-4 w-4"><path d="M4 6h16M4 12h16M4 18h10" /></svg>;
  if (id === "design")
    return (
      <svg {...common} className="h-4 w-4">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
      </svg>
    );
  if (id === "slides")
    return (
      <svg {...common} className="h-4 w-4">
        <rect x="3" y="5" width="18" height="12" rx="1.5" />
        <path d="M8 21h8" />
      </svg>
    );
  return (
    <svg {...common} className="h-4 w-4">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5.5-5.5L4 20" />
    </svg>
  );
}

const LOCKED = new Set(["title", "agenda"]);
const FONT_SUGGESTIONS = ["Arial", "Calibri", "Georgia", "Montserrat", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana"];
// ONE card language for every slide and photo in the libraries: the same two actions in the same
// place, at a size that is comfortable to hit, and no per-kind labelling. Everything else (the
// design round trip, "in every deck", the AI-writes-text choice) lives inside Edit.
const CARD_ACTIONS = "mt-3 flex items-center gap-2 border-t border-[#EEF4F7] pt-2.5";
const BTN_EDIT =
  "rounded-[4px] border border-[#C2D9E3] bg-white px-3 py-1.5 text-xs font-semibold text-[#06456B] hover:bg-[#EAF3F7]";
const BTN_REMOVE =
  "rounded-[4px] border border-transparent px-3 py-1.5 text-xs font-semibold text-red-700 hover:border-red-200 hover:bg-red-50";
const BTN_SUBTLE = "rounded-[4px] px-3 py-1.5 text-xs font-semibold text-zinc-500 hover:bg-zinc-100";
const PILL_AI =
  "shrink-0 rounded-md bg-[#EEFAF9] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#0A7A8A]";
const PILL_ASIS = "shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-zinc-500";
/** Favourite star: deliberately larger than the old text-lg and kept well clear of the on/off
 * switch, which sat close enough to mis-tap. */
const STAR_BTN = "text-2xl leading-none transition-colors";

/** The three strengths a setting on this page can have. Naming them is the point: everything here
 * used to read as "asking the AI", when in truth some of it is written by the code and can never
 * come out wrong, some is verified and corrected after the fact, and only the rest is a request. */
const STRENGTHS = {
  enforced: {
    label: "Enforced",
    hint: "Written by the code on every deck. The AI is not involved and cannot get this wrong.",
    cls: "bg-[#E7F2EC] text-[#1B6B4A]",
  },
  checked: {
    label: "Checked",
    hint: "The AI does this, then the finished deck is inspected and anything that breaks it is sent back to be fixed.",
    cls: "bg-[#EEFAF9] text-[#0A7A8A]",
  },
  asked: {
    label: "Asked",
    hint: "The AI is told to do this. It usually does, but nothing verifies it afterwards.",
    cls: "bg-amber-50 text-amber-700",
  },
} as const;

function Strength({ kind }: { kind: keyof typeof STRENGTHS }) {
  const s = STRENGTHS[kind];
  return (
    <span
      title={s.hint}
      className={`shrink-0 cursor-help rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

const MODE_LABEL: Record<CustomSlide["mode"], string> = {
  auto: "AI decides when it fits",
  always: "In every deck",
  off: "Off",
};

function pretty(key: string): string {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The planner-facing usage strings are written for the AI; lightly clean them for people. */
function cleanUsage(s: string): string {
  return s.replace(/`/g, "");
}

export default function AboutV2Page() {
  const [reviewer, setReviewer] = useState("");
  const [product, setProduct] = useState<ProductId>("superba");
  const selectedProduct = PRODUCTS.find((p) => p.id === product) ?? PRODUCTS[0];
  const [activeTab, setActiveTab] = useState<TabKey>("rules");

  // ----- rules -----
  const [rulesConfigured, setRulesConfigured] = useState(true);
  const [rulesMigrated, setRulesMigrated] = useState(true);
  const [rules, setRules] = useState<Rule[]>([]);
  const [newRule, setNewRule] = useState("");
  const [savingRule, setSavingRule] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [ruleError, setRuleError] = useState("");

  // ----- design settings -----
  const [designMigrated, setDesignMigrated] = useState(true);
  const [design, setDesign] = useState<DesignSettings>({});
  const [designMeta, setDesignMeta] = useState<{ by: string | null; at: string | null }>({ by: null, at: null });
  const [designDirty, setDesignDirty] = useState(false);
  const [designSaving, setDesignSaving] = useState(false);
  const [designError, setDesignError] = useState("");
  const [designSavedTick, setDesignSavedTick] = useState(false);

  // ----- layouts -----
  const [layoutsMigrated, setLayoutsMigrated] = useState(true);
  const [starsMigrated, setStarsMigrated] = useState(true);
  const [metaMigrated, setMetaMigrated] = useState(true); // migration 0009 (removed + names)
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [preferred, setPreferred] = useState<Set<string>>(new Set());
  const [layoutRemoved, setLayoutRemoved] = useState<Set<string>>(new Set());
  const [layoutNames, setLayoutNames] = useState<Record<string, NameOverride>>({});
  const [layoutError, setLayoutError] = useState("");
  const [filter, setFilter] = useState<"all" | "on" | "off" | "favourites">("all");
  const [galleryTheme, setGalleryTheme] = useState<"dark" | "light" | "pastel">("dark");
  const GALLERY_THEME_LABEL = { dark: "Blue Ocean", light: "White", pastel: "Pastel Blue" } as const;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [slidesView, setSlidesView] = useState<"library" | "deleted">("library");
  const [editingLayout, setEditingLayout] = useState<string | null>(null);
  const [layoutNameDraft, setLayoutNameDraft] = useState("");
  const [layoutDescDraft, setLayoutDescDraft] = useState("");

  // ----- layout design overrides (TEAM REDESIGNED layouts) -----
  const [overrides, setOverrides] = useState<Record<string, LayoutOverride>>({});
  const [overridingLayout, setOverridingLayout] = useState<string | null>(null);
  const [overrideNotice, setOverrideNotice] = useState("");

  // ----- design preview -----
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewImgs, setPreviewImgs] = useState<string[] | null>(null);

  // ----- photo library -----
  const [photosMigrated, setPhotosMigrated] = useState(true);
  const [customPhotos, setCustomPhotos] = useState<CustomPhoto[]>([]);
  const [photoError, setPhotoError] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoDraft, setPhotoDraft] = useState<{ image_b64: string; thumb_b64: string; name: string; description: string } | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [editingPhoto, setEditingPhoto] = useState<string | null>(null);
  const [photoName, setPhotoName] = useState("");
  const [photoDesc, setPhotoDesc] = useState("");
  const [photoSettingsMigrated, setPhotoSettingsMigrated] = useState(true);
  const [photoMetaMigrated, setPhotoMetaMigrated] = useState(true); // migration 0009
  const [photoDisabled, setPhotoDisabled] = useState<Set<string>>(new Set());
  const [photoPreferred, setPhotoPreferred] = useState<Set<string>>(new Set());
  const [builtinPhotoRemoved, setBuiltinPhotoRemoved] = useState<Set<string>>(new Set());
  const [photoNames, setPhotoNames] = useState<Record<string, NameOverride>>({});
  const [photoFilter, setPhotoFilter] = useState<"all" | "on" | "off" | "favourites">("all");
  const [photosView, setPhotosView] = useState<"library" | "deleted">("library");
  const [editingBuiltinPhoto, setEditingBuiltinPhoto] = useState<string | null>(null);

  // ----- custom slides -----
  const [slidesMigrated, setSlidesMigrated] = useState(true);
  const [customSlides, setCustomSlides] = useState<CustomSlide[]>([]);
  const [customError, setCustomError] = useState("");
  const [editingSlide, setEditingSlide] = useState<string | null>(null);
  const [slideName, setSlideName] = useState("");
  const [slideDesc, setSlideDesc] = useState("");

  // ----- edit round trip: download a slide as .pptx / replace one already in the library -----
  const [exportingLayout, setExportingLayout] = useState<string | null>(null);
  const [exportingAll, setExportingAll] = useState(false);
  const [exportingSlide, setExportingSlide] = useState<string | null>(null);
  const [replacingSlide, setReplacingSlide] = useState<string | null>(null);

  // ----- upload flow -----
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ pct: number; step: string } | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [picks, setPicks] = useState<UploadPick[] | null>(null);
  const [savingPicks, setSavingPicks] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await (await fetch("/api/rules")).json();
      setRulesConfigured(r.configured !== false);
      setRulesMigrated(r.migrated !== false);
      setRules(r.rules ?? []);
    } catch {
      setRulesConfigured(false);
    }
    try {
      const l = await (await fetch("/api/layout-settings")).json();
      setLayoutsMigrated(l.configured !== false && l.migrated !== false);
      setStarsMigrated(l.starsMigrated !== false);
      setMetaMigrated(l.configured !== false && l.migrated !== false && l.metaMigrated !== false);
      const removed = new Set<string>(l.removed ?? []);
      // The server folds removed into `disabled` (so generation excludes them for free);
      // the page un-folds so the Turned off filter/counts never show a removed slide.
      setDisabled(new Set<string>((l.disabled ?? []).filter((k: string) => !removed.has(k))));
      setPreferred(new Set<string>(l.preferred ?? []));
      setLayoutRemoved(removed);
      setLayoutNames(l.names ?? {});
    } catch {
      setLayoutsMigrated(false);
    }
    try {
      const o = await (await fetch("/api/layout-overrides")).json();
      const map: Record<string, LayoutOverride> = {};
      for (const ov of (o.overrides ?? []) as LayoutOverride[]) map[ov.layout] = ov;
      setOverrides(map);
    } catch {
      /* no overrides — the standard designs render as before */
    }
    try {
      const p = await (await fetch("/api/custom-photos")).json();
      setPhotosMigrated(p.configured !== false && p.migrated !== false);
      setCustomPhotos(p.photos ?? []);
    } catch {
      setPhotosMigrated(false);
    }
    try {
      const ps = await (await fetch("/api/photo-settings")).json();
      setPhotoSettingsMigrated(ps.configured !== false && ps.migrated !== false);
      setPhotoMetaMigrated(ps.configured !== false && ps.migrated !== false && ps.metaMigrated !== false);
      const removed = new Set<string>(ps.removed ?? []);
      setPhotoDisabled(new Set<string>((ps.disabled ?? []).filter((k: string) => !removed.has(k))));
      setPhotoPreferred(new Set<string>(ps.preferred ?? []));
      setBuiltinPhotoRemoved(removed);
      setPhotoNames(ps.names ?? {});
    } catch {
      setPhotoSettingsMigrated(false);
    }
    try {
      const d = await (await fetch("/api/design-settings")).json();
      setDesignMigrated(d.configured !== false && d.migrated !== false);
      setDesign(d.settings ?? {});
      setDesignMeta({ by: d.updated_by ?? null, at: d.updated_at ?? null });
    } catch {
      setDesignMigrated(false);
    }
    try {
      const c = await (await fetch("/api/custom-slides")).json();
      setSlidesMigrated(c.configured !== false && c.migrated !== false);
      setCustomSlides(c.slides ?? []);
    } catch {
      setSlidesMigrated(false);
    }
  }, []);

  useEffect(() => {
    void load();
    setReviewer(window.localStorage.getItem(REVIEWER_KEY) || "");
  }, [load]);

  const onReviewerChange = (v: string) => {
    setReviewer(v);
    try {
      window.localStorage.setItem(REVIEWER_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const canEdit = rulesConfigured && rulesMigrated;

  // ---------- rules ----------
  async function addRule() {
    const t = newRule.trim();
    if (!t || savingRule) return;
    setSavingRule(true);
    setRuleError("");
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t, author: reviewer }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save the rule.");
      setRules((r) => [...r, d.rule]);
      setNewRule("");
    } catch (e) {
      setRuleError((e as Error).message);
    } finally {
      setSavingRule(false);
    }
  }

  async function patchRule(id: number, patch: { text?: string; enabled?: boolean }) {
    setRuleError("");
    try {
      const res = await fetch(`/api/rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, author: reviewer }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not update the rule.");
      setRules((r) => r.map((x) => (x.id === id ? d.rule : x)));
    } catch (e) {
      setRuleError((e as Error).message);
    }
  }

  async function deleteRule(id: number) {
    if (!window.confirm("Delete this rule? It stops applying to every future generation.")) return;
    setRuleError("");
    try {
      const res = await fetch(`/api/rules/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not delete the rule.");
      }
      setRules((r) => r.filter((x) => x.id !== id));
    } catch (e) {
      setRuleError((e as Error).message);
    }
  }

  // ---------- design settings ----------
  function setDesignField(key: keyof DesignSettings, value: string) {
    setDesign((d) => ({ ...d, [key]: value }));
    setDesignDirty(true);
    setDesignSavedTick(false);
  }

  async function saveDesign(next?: DesignSettings) {
    setDesignSaving(true);
    setDesignError("");
    try {
      // Drop empty fields so "cleared" really means "brand default", and send numbers as numbers.
      const src = next ?? design;
      const out: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(src)) {
        if (v === undefined || v === null || String(v).trim() === "") continue;
        out[k] = k === "title_font" || k === "body_font" ? String(v).trim() : Number(v);
      }
      const res = await fetch("/api/design-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: out, author: reviewer }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save the design settings.");
      setDesign(d.settings ?? {});
      setDesignDirty(false);
      setDesignSavedTick(true);
    } catch (e) {
      setDesignError((e as Error).message);
    } finally {
      setDesignSaving(false);
    }
  }

  // ---------- layouts ----------
  async function toggleLayout(key: string, enable: boolean) {
    setLayoutError("");
    const before = new Set(disabled);
    const nextSet = new Set(disabled);
    if (enable) nextSet.delete(key);
    else nextSet.add(key);
    setDisabled(nextSet); // optimistic — a toggle should feel instant
    try {
      const res = await fetch("/api/layout-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: key, enabled: enable, author: reviewer }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not save the layout setting.");
      }
    } catch (e) {
      setDisabled(before);
      setLayoutError((e as Error).message);
    }
  }

  async function toggleStar(key: string, star: boolean) {
    setLayoutError("");
    const before = new Set(preferred);
    const next = new Set(preferred);
    if (star) next.add(key);
    else next.delete(key);
    setPreferred(next); // optimistic
    try {
      const res = await fetch("/api/layout-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: key, preferred: star, author: reviewer }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not save the favourite.");
      }
    } catch (e) {
      setPreferred(before);
      setLayoutError((e as Error).message);
    }
  }

  // ---------- built-in slide: remove / restore / retitle ----------
  async function removeLayout(key: string, name: string) {
    if (!window.confirm(`Move "${name}" to Deleted items? It stops appearing in new decks. You can restore it there.`))
      return;
    setLayoutError("");
    const before = new Set(layoutRemoved);
    setLayoutRemoved(new Set(layoutRemoved).add(key)); // optimistic
    try {
      const res = await fetch("/api/layout-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: key, removed: true, author: reviewer }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not remove the slide.");
      }
    } catch (e) {
      setLayoutRemoved(before);
      setLayoutError((e as Error).message);
    }
  }

  async function restoreLayout(key: string) {
    setLayoutError("");
    const before = new Set(layoutRemoved);
    const next = new Set(layoutRemoved);
    next.delete(key);
    setLayoutRemoved(next); // optimistic
    try {
      const res = await fetch("/api/layout-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: key, removed: false, author: reviewer }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not restore the slide.");
      }
    } catch (e) {
      setLayoutRemoved(before);
      setLayoutError((e as Error).message);
    }
  }

  async function saveLayoutMeta(key: string) {
    setLayoutError("");
    try {
      const res = await fetch("/api/layout-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layout: key,
          display_name: layoutNameDraft,
          description: layoutDescDraft,
          author: reviewer,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not save the changes.");
      }
      setLayoutNames((n) => ({
        ...n,
        [key]: {
          display_name: layoutNameDraft.trim() || null,
          description: layoutDescDraft.trim() || null,
        },
      }));
      setEditingLayout(null);
    } catch (e) {
      setLayoutError((e as Error).message);
    }
  }

  // ---------- built-in slide: design override (edit the slide itself) ----------
  /** Upload an edited .pptx back over a built-in layout: the design is used verbatim from now
   * on while the AI keeps writing the slide's text into the boxes it finds ("recipe", not a
   * frozen picture). Same upload-once flow as replaceCustomSlide. */
  async function uploadLayoutOverride(key: string, file: File) {
    setLayoutError("");
    setOverrideNotice("");
    setOverridingLayout(key);
    let storagePath: string | null = null;
    try {
      const urlRes = await fetch("/api/custom-slides/upload-url", { method: "POST" });
      const uploadUrl = await urlRes.json();
      if (!urlRes.ok) throw new Error(uploadUrl.error || "Could not prepare the upload.");
      storagePath = uploadUrl.path;
      const uploadForm = new FormData();
      uploadForm.append("cacheControl", "3600");
      uploadForm.append("", file);
      const putRes = await fetch(uploadUrl.signedUrl, { method: "PUT", body: uploadForm });
      if (!putRes.ok) throw new Error(`Could not upload the file (status ${putRes.status}).`);

      // Measure the design's text slots (what the AI will keep writing into).
      const inspectRes = await fetch("/api/custom-slides/inspect-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_path: storagePath, filename: file.name, slide_index: 0, layout: key }),
      });
      const inspected = await inspectRes.json();
      if (!inspectRes.ok) throw new Error(inspected.error || "Could not read the presentation.");

      const res = await fetch("/api/layout-overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layout: key,
          storage_path: storagePath,
          filename: file.name,
          slide_index: 0,
          slots: inspected.slots ?? [],
          preview_b64: inspected.preview_b64 ?? null,
          author: reviewer,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save the design.");
      setOverrides((o) => ({ ...o, [key]: d.override }));
      setEditingLayout(null);
      setOverrideNotice(
        `Saved. Found ${(inspected.slots ?? []).length} text area(s) the AI will keep writing on "${
          layoutNames[key]?.display_name || pretty(key)
        }".`
      );
    } catch (e) {
      setLayoutError((e as Error).message);
      if (storagePath) {
        void fetch("/api/custom-slides/discard-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storage_path: storagePath }),
        }).catch(() => {});
      }
    } finally {
      setOverridingLayout(null);
    }
  }

  async function revertOverride(key: string, name: string) {
    if (!window.confirm(`Revert "${name}" to the standard design? Your uploaded design is deleted.`)) return;
    setLayoutError("");
    setOverrideNotice("");
    try {
      const res = await fetch(`/api/layout-overrides?layout=${encodeURIComponent(key)}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not revert the design.");
      }
      setOverrides((o) => {
        const next = { ...o };
        delete next[key];
        return next;
      });
    } catch (e) {
      setLayoutError((e as Error).message);
    }
  }

  // ---------- built-in photo: remove / restore / retitle ----------
  async function removeBuiltinPhoto(id: string, name: string) {
    if (!window.confirm(`Move "${name}" to Deleted items? It stops appearing in new decks. You can restore it there.`))
      return;
    setPhotoError("");
    const before = new Set(builtinPhotoRemoved);
    setBuiltinPhotoRemoved(new Set(builtinPhotoRemoved).add(id)); // optimistic
    try {
      const res = await fetch("/api/photo-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo: id, removed: true, author: reviewer }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not remove the photo.");
      }
    } catch (e) {
      setBuiltinPhotoRemoved(before);
      setPhotoError((e as Error).message);
    }
  }

  async function restoreBuiltinPhoto(id: string) {
    setPhotoError("");
    const before = new Set(builtinPhotoRemoved);
    const next = new Set(builtinPhotoRemoved);
    next.delete(id);
    setBuiltinPhotoRemoved(next); // optimistic
    try {
      const res = await fetch("/api/photo-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo: id, removed: false, author: reviewer }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not restore the photo.");
      }
    } catch (e) {
      setBuiltinPhotoRemoved(before);
      setPhotoError((e as Error).message);
    }
  }

  async function saveBuiltinPhotoMeta(id: string) {
    setPhotoError("");
    try {
      const res = await fetch("/api/photo-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo: id, display_name: photoName, description: photoDesc, author: reviewer }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not save the changes.");
      }
      setPhotoNames((n) => ({
        ...n,
        [id]: { display_name: photoName.trim() || null, description: photoDesc.trim() || null },
      }));
      setEditingBuiltinPhoto(null);
    } catch (e) {
      setPhotoError((e as Error).message);
    }
  }

  // ---------- design preview ----------
  async function previewDesign() {
    setPreviewBusy(true);
    setPreviewError("");
    try {
      const settings: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(design)) {
        if (v === undefined || v === null || String(v).trim() === "") continue;
        settings[k] =
          k === "title_font" || k === "body_font" || k === "footer_text" || k === "photo_level" || k === "icon_level"
            ? String(v).trim()
            : k === "page_numbers" || k === "date_stamp"
              ? v
              : Number(v);
      }
      const res = await fetch("/api/design-settings/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Preview failed.");
      setPreviewImgs(d.slides ?? []);
    } catch (e) {
      setPreviewError((e as Error).message);
    } finally {
      setPreviewBusy(false);
    }
  }

  // ---------- photo library ----------
  async function readAndDownscale(file: File): Promise<{ image_b64: string; thumb_b64: string }> {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("Could not read the image file."));
        i.src = url;
      });
      const scale = (max: number, quality: number) => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL("image/jpeg", quality).split(",")[1];
      };
      return { image_b64: scale(1800, 0.85), thumb_b64: scale(480, 0.8) };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function pickPhoto(file: File) {
    setPhotoError("");
    try {
      if (!file.type.startsWith("image/")) throw new Error("Upload an image file (JPG or PNG).");
      const scaled = await readAndDownscale(file);
      setPhotoDraft({ ...scaled, name: file.name.replace(/\.[^.]+$/, "").slice(0, 60), description: "" });
    } catch (e) {
      setPhotoError((e as Error).message);
    }
  }

  async function savePhoto() {
    if (!photoDraft || photoSaving) return;
    setPhotoSaving(true);
    setPhotoError("");
    try {
      const res = await fetch("/api/custom-photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: photoDraft.name,
          description: photoDraft.description,
          image_b64: photoDraft.image_b64,
          thumb_b64: photoDraft.thumb_b64,
          author: reviewer,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save the photo.");
      setCustomPhotos((p) => [...p, d.photo]);
      setPhotoDraft(null);
      if (photoInput.current) photoInput.current.value = "";
    } catch (e) {
      setPhotoError((e as Error).message);
    } finally {
      setPhotoSaving(false);
    }
  }

  async function patchPhoto(id: string, patch: { name?: string; description?: string; enabled?: boolean; preferred?: boolean }) {
    setPhotoError("");
    try {
      const res = await fetch(`/api/custom-photos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, author: reviewer }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not update the photo.");
      setCustomPhotos((p) => p.map((x) => (x.id === id ? { ...x, ...d.photo } : x)));
    } catch (e) {
      setPhotoError((e as Error).message);
    }
  }

  async function deletePhoto(id: string) {
    if (!window.confirm("Move this photo to Deleted items? It stops appearing in new decks. You can restore it there."))
      return;
    setPhotoError("");
    try {
      const res = await fetch(`/api/custom-photos/${id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not remove the photo.");
      // Soft removed (post-0009) → keep the row flagged for Deleted items; a pre-0009 database
      // hard-deleted it, so drop it from the list entirely.
      setCustomPhotos((p) =>
        d.removed ? p.map((x) => (x.id === id ? { ...x, removed: true } : x)) : p.filter((x) => x.id !== id)
      );
    } catch (e) {
      setPhotoError((e as Error).message);
    }
  }

  async function restorePhoto(id: string) {
    setPhotoError("");
    try {
      const res = await fetch(`/api/custom-photos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removed: false, author: reviewer }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not restore the photo.");
      setCustomPhotos((p) => p.map((x) => (x.id === id ? { ...x, removed: false } : x)));
    } catch (e) {
      setPhotoError((e as Error).message);
    }
  }

  async function purgePhoto(id: string, name: string) {
    if (!window.confirm(`Permanently delete "${name}"? This cannot be undone.`)) return;
    setPhotoError("");
    try {
      const res = await fetch(`/api/custom-photos/${id}?purge=1`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not delete the photo.");
      }
      setCustomPhotos((p) => p.filter((x) => x.id !== id));
    } catch (e) {
      setPhotoError((e as Error).message);
    }
  }

  async function toggleBuiltinPhoto(id: string, enable: boolean) {
    setPhotoError("");
    const before = new Set(photoDisabled);
    const next = new Set(photoDisabled);
    if (enable) next.delete(id);
    else next.add(id);
    setPhotoDisabled(next); // optimistic — a toggle should feel instant
    try {
      const res = await fetch("/api/photo-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo: id, enabled: enable, author: reviewer }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not save the photo setting.");
      }
    } catch (e) {
      setPhotoDisabled(before);
      setPhotoError((e as Error).message);
    }
  }

  async function toggleBuiltinPhotoStar(id: string, star: boolean) {
    setPhotoError("");
    const before = new Set(photoPreferred);
    const next = new Set(photoPreferred);
    if (star) next.add(id);
    else next.delete(id);
    setPhotoPreferred(next); // optimistic
    try {
      const res = await fetch("/api/photo-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo: id, preferred: star, author: reviewer }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not save the favourite.");
      }
    } catch (e) {
      setPhotoPreferred(before);
      setPhotoError((e as Error).message);
    }
  }

  // ---------- custom slides ----------
  async function patchSlide(id: string, patch: { name?: string; description?: string; mode?: string }) {
    setCustomError("");
    try {
      const res = await fetch(`/api/custom-slides/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, author: reviewer }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not update the slide.");
      setCustomSlides((s) => s.map((x) => (x.id === id ? { ...x, ...d.slide } : x)));
    } catch (e) {
      setCustomError((e as Error).message);
    }
  }

  async function deleteSlide(id: string) {
    if (!window.confirm("Move this slide to Deleted items? It stops appearing in new decks. You can restore it there."))
      return;
    setCustomError("");
    try {
      const res = await fetch(`/api/custom-slides/${id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Could not remove the slide.");
      // Soft removed (post-0009) → keep it flagged for Deleted items; a pre-0009 database
      // hard-deleted it, so drop it entirely.
      setCustomSlides((s) =>
        d.removed ? s.map((x) => (x.id === id ? { ...x, removed: true } : x)) : s.filter((x) => x.id !== id)
      );
    } catch (e) {
      setCustomError((e as Error).message);
    }
  }

  async function restoreSlide(id: string) {
    setCustomError("");
    try {
      const res = await fetch(`/api/custom-slides/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removed: false, author: reviewer }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not restore the slide.");
      setCustomSlides((s) => s.map((x) => (x.id === id ? { ...x, removed: false } : x)));
    } catch (e) {
      setCustomError((e as Error).message);
    }
  }

  async function purgeSlide(id: string, name: string) {
    if (!window.confirm(`Permanently delete "${name}"? This cannot be undone — the stored file is deleted too.`))
      return;
    setCustomError("");
    try {
      const res = await fetch(`/api/custom-slides/${id}?purge=1`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not delete the slide.");
      }
      setCustomSlides((s) => s.filter((x) => x.id !== id));
    } catch (e) {
      setCustomError((e as Error).message);
    }
  }

  // ---------- upload flow ----------
  // The storage path of a file uploaded for the CURRENT pick session, not yet saved as a real
  // custom_slides row. A ref, not state — nothing renders from it, it's purely bookkeeping for
  // discardUploadedFile(), and a ref sidesteps any risk of the update landing after a stale read
  // (see the ref-timing bug fixed in the generator's findings picker this same session).
  const uploadPathRef = useRef<string | null>(null);

  /** Best-effort cleanup of a just-uploaded file that never became a saved slide (cancelled, or
   * inspect/save failed) — paths are fresh random UUIDs per attempt, so nothing else can be
   * referencing it yet and a bare delete is always safe. */
  async function discardUploadedFile() {
    const path = uploadPathRef.current;
    uploadPathRef.current = null;
    if (!path) return;
    try {
      await fetch("/api/custom-slides/discard-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_path: path }),
      });
    } catch {
      /* best-effort only — an orphaned Storage object is a minor cleanup gap, not a failure */
    }
  }

  /** Parse a response that SHOULD be JSON but may be an infrastructure error page (e.g.
   * Vercel's plain-text timeout) — turn that into a readable error instead of the browser's
   * cryptic "Unexpected token ... is not valid JSON". */
  async function safeJson(res: Response): Promise<Record<string, unknown>> {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: text.slice(0, 160) || `The server responded ${res.status} with no detail.` };
    }
  }

  /** Preview rendering runs as a deck-service JOB (a many-slide file takes minutes — longer
   * than any single request may last); poll until the previews are ready. onProgress receives
   * the job's real progress (the service renders big decks in chunks and reports "12 of 42"). */
  async function pollInspect(
    jobId: string,
    onProgress?: (p: { pct: number; step: string }) => void
  ): Promise<{ index: number; preview_b64: string }[]> {
    const deadline = Date.now() + 15 * 60 * 1000; // a 42-slide render on the small server is slow
    let flaky = 0; // consecutive transient failures (the render server can be briefly restarting)
    for (;;) {
      if (Date.now() > deadline) throw new Error("Preview rendering timed out — try a smaller file.");
      await new Promise((r) => setTimeout(r, 3000));
      let res: Response;
      try {
        res = await fetch(`/api/custom-slides/inspect?job=${encodeURIComponent(jobId)}`);
      } catch {
        if (++flaky > 10) throw new Error("Lost contact with the rendering server — please try again.");
        continue;
      }
      // A restart loses the in-memory job; a redeploy or an overloaded instance answers 5xx for
      // a while. Neither is worth throwing away a render that may still be running, so tolerate
      // a run of them and only then report something the user can act on.
      if (res.status === 404) throw new Error("The rendering server restarted, so this upload was lost — please try again.");
      if (res.status >= 500) {
        if (++flaky > 10) throw new Error("The rendering server is unavailable right now — please try again in a minute.");
        continue;
      }
      const d = await safeJson(res);
      if (!res.ok) throw new Error((d.error as string) || "Could not check the preview rendering.");
      flaky = 0;
      if (d.status === "error") throw new Error((d.error as string) || "Preview rendering failed.");
      if (d.status === "done") return (d.slides as { index: number; preview_b64: string }[]) ?? [];
      onProgress?.({ pct: Number(d.progress) || 5, step: String(d.step || "Rendering slide previews") });
    }
  }

  async function inspectUpload(file: File) {
    setUploadError("");
    setUploadBusy(true);
    setPicks(null);
    setUploadFile(file);
    try {
      if (file.size > 100 * 1024 * 1024)
        throw new Error("That file is too large (over 100 MB) — trim it down before uploading.");
      // Upload ONCE, straight to Storage (a signed URL, not the file, transits Vercel) — both the
      // preview below and the eventual save reuse this same stored path, so the file never rides
      // through Vercel's ~4.5 MB body ceiling, and never gets re-uploaded on save either.
      const urlRes = await fetch("/api/custom-slides/upload-url", { method: "POST" });
      const uploadUrl = await urlRes.json();
      if (!urlRes.ok) throw new Error(uploadUrl.error || "Could not prepare the upload.");
      const uploadForm = new FormData();
      uploadForm.append("cacheControl", "3600");
      uploadForm.append("", file);
      const putRes = await fetch(uploadUrl.signedUrl, { method: "PUT", body: uploadForm });
      if (!putRes.ok) throw new Error(`Could not upload the file (status ${putRes.status}).`);
      uploadPathRef.current = uploadUrl.path;

      // Rasterise via the app's own route: it downloads the file from Storage server-to-server
      // and forwards it to the deck service server-to-server — this request's own body is just
      // a path string, so it's tiny regardless of how big the actual .pptx is. The rendering
      // itself runs as a background JOB we poll: a many-slide file (the full 42-slide template
      // export) renders for minutes, longer than any single request is allowed to last.
      const res = await fetch("/api/custom-slides/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_path: uploadUrl.path, filename: file.name }),
      });
      const d = await safeJson(res);
      if (!res.ok) throw new Error((d.error as string) || "Could not read the presentation.");
      setUploadProgress({ pct: 5, step: "Rendering slide previews" });
      const slides = await pollInspect(d.job_id as string, setUploadProgress);
      setPicks(
        slides.map((s) => ({
          index: s.index,
          preview_b64: s.preview_b64,
          picked: false,
          name: "",
          description: "",
          mode: "auto" as const,
          aiFills: true,
        }))
      );
    } catch (e) {
      setUploadError((e as Error).message);
      setUploadFile(null);
      void discardUploadedFile();
    } finally {
      setUploadBusy(false);
      setUploadProgress(null);
    }
  }

  /** Measure one picked slide's text boxes, so the AI can refill them per deck. Runs when a
   * slide is ticked (or switched back to AI-filled) and caches the result on the pick; a design
   * the recipe path can't honour (embedded chart/video, no text) reports why and falls back to
   * "use exactly as is". */
  async function measurePick(index: number) {
    if (!uploadPathRef.current || !uploadFile) return;
    setPicks((ps) => ps!.map((x) => (x.index === index ? { ...x, slotsBusy: true, slotsError: "" } : x)));
    try {
      const res = await fetch("/api/custom-slides/inspect-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage_path: uploadPathRef.current,
          filename: uploadFile.name,
          slide_index: index,
        }),
      });
      const d = await safeJson(res);
      if (!res.ok) throw new Error((d.error as string) || "Could not read this slide's text.");
      const slots = (d.slots as unknown[]) ?? [];
      if (!slots.length) throw new Error("No editable text found on this slide.");
      setPicks((ps) =>
        ps!.map((x) => (x.index === index ? { ...x, slots, slotsBusy: false, slotsError: "" } : x))
      );
    } catch (e) {
      setPicks((ps) =>
        ps!.map((x) =>
          x.index === index
            ? { ...x, aiFills: false, slots: undefined, slotsBusy: false, slotsError: (e as Error).message }
            : x
        )
      );
    }
  }

  async function savePicks() {
    if (!uploadFile || !picks || !uploadPathRef.current) return;
    const chosen = picks.filter((p) => p.picked);
    if (!chosen.length) {
      setUploadError("Tick at least one slide to add.");
      return;
    }
    if (chosen.some((p) => !p.name.trim())) {
      setUploadError("Give every ticked slide a short name.");
      return;
    }
    if (chosen.some((p) => p.slotsBusy)) {
      setUploadError("Still reading a slide's text areas — give it a moment.");
      return;
    }
    setSavingPicks(true);
    setUploadError("");
    try {
      const res = await fetch("/api/custom-slides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: uploadFile.name,
          storage_path: uploadPathRef.current,
          author: reviewer,
          slides: chosen.map((p) => ({
            slide_index: p.index,
            name: p.name,
            description: p.description,
            mode: p.mode,
            preview_b64: p.preview_b64,
            // Only sent when the AI should write this slide's text; absent = verbatim.
            slots: p.aiFills && p.slots?.length ? p.slots : undefined,
          })),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save the slides.");
      uploadPathRef.current = null; // now owned by the saved row — ours to discard no longer
      setPicks(null);
      setUploadFile(null);
      if (fileInput.current) fileInput.current.value = "";
      const c = await (await fetch("/api/custom-slides")).json();
      setCustomSlides(c.slides ?? []);
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setSavingPicks(false);
    }
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- edit round trip, half 1: download a STANDARD slide as an editable .pptx ----------
  // The user edits it in PowerPoint, then uses "＋ Upload PowerPoint" above to save it as their
  // own version — no separate save path needed for this half.
  async function downloadStandardLayout(key: string) {
    setLayoutError("");
    setExportingLayout(key);
    try {
      // An overridden layout downloads the team's CURRENT design, so the next edit iterates on
      // it; otherwise the pristine standard sample is rendered fresh by the deck service.
      const res = overrides[key]
        ? await fetch(`/api/layout-overrides?layout=${encodeURIComponent(key)}&file=1`)
        : await fetch("/api/layout-gallery/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ layout: key, background: galleryTheme }),
          });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not export the slide.");
      }
      triggerDownload(await res.blob(), `${key}.pptx`);
    } catch (e) {
      setLayoutError((e as Error).message);
    } finally {
      setExportingLayout(null);
    }
  }

  // Bulk sibling of downloadStandardLayout: all 42 standard slides in ONE file, so several can be
  // edited in one PowerPoint session instead of downloading them one at a time. Re-upload the
  // edited file through the existing "＋ Upload PowerPoint" flow, ticking just the ones you changed.
  async function downloadAllStandardLayouts() {
    setLayoutError("");
    setExportingAll(true);
    try {
      const res = await fetch("/api/layout-gallery/export-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ background: galleryTheme }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not export the slide templates.");
      }
      triggerDownload(await res.blob(), "superba-slide-templates.pptx");
    } catch (e) {
      setLayoutError((e as Error).message);
    } finally {
      setExportingAll(false);
    }
  }

  // ---------- edit round trip, half 2: download / replace a slide ALREADY in "Your slides" ----------
  async function downloadCustomSlide(id: string, name: string) {
    setCustomError("");
    setExportingSlide(id);
    try {
      const res = await fetch(`/api/custom-slides/${id}/export`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not export the slide.");
      }
      triggerDownload(await res.blob(), `${name || "slide"}.pptx`);
    } catch (e) {
      setCustomError((e as Error).message);
    } finally {
      setExportingSlide(null);
    }
  }

  async function replaceCustomSlide(id: string, file: File) {
    setCustomError("");
    setReplacingSlide(id);
    let storagePath: string | null = null;
    try {
      // Upload the edited file straight to Storage once, then reuse that same path for both the
      // rasterised preview and the save — the same "upload once" flow the main upload above
      // uses, so a big edited file never rides through Vercel's body ceiling twice. If the
      // edited file has several slides, the first one is what gets saved.
      const urlRes = await fetch("/api/custom-slides/upload-url", { method: "POST" });
      const uploadUrl = await urlRes.json();
      if (!urlRes.ok) throw new Error(uploadUrl.error || "Could not prepare the upload.");
      storagePath = uploadUrl.path;
      const uploadForm = new FormData();
      uploadForm.append("cacheControl", "3600");
      uploadForm.append("", file);
      const putRes = await fetch(uploadUrl.signedUrl, { method: "PUT", body: uploadForm });
      if (!putRes.ok) throw new Error(`Could not upload the file (status ${putRes.status}).`);

      const inspectRes = await fetch("/api/custom-slides/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storage_path: storagePath, filename: file.name }),
      });
      const inspected = await safeJson(inspectRes);
      if (!inspectRes.ok) throw new Error((inspected.error as string) || "Could not read the presentation.");
      const slides = await pollInspect(inspected.job_id as string);
      const preview_b64: string | null = slides[0]?.preview_b64 ?? null;

      const res = await fetch(`/api/custom-slides/${id}/replace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storage_path: storagePath,
          filename: file.name,
          preview_b64,
          slide_index: 0,
          author: reviewer,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save the replacement.");
      setCustomSlides((s) => s.map((x) => (x.id === id ? { ...x, ...d.slide } : x)));
    } catch (e) {
      setCustomError((e as Error).message);
      if (storagePath) {
        void fetch("/api/custom-slides/discard-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ storage_path: storagePath }),
        }).catch(() => {});
      }
    } finally {
      setReplacingSlide(null);
    }
  }

  // ---------- derived ----------
  const entries = (gallery as GalleryEntry[]).filter((g) => {
    if (layoutRemoved.has(g.key)) return false; // removed slides live only in Deleted items
    if (filter === "off") return disabled.has(g.key);
    if (filter === "favourites") return preferred.has(g.key);
    if (filter === "on") return !disabled.has(g.key) && g.kind !== "verbatim";
    return true;
  });
  const shownCustom = customSlides.filter((c) => {
    if (c.removed) return false;
    if (filter === "on") return c.mode !== "off";
    if (filter === "off") return c.mode === "off";
    if (filter === "favourites") return false;
    return true; // all
  });
  const offCount =
    disabled.size + customSlides.filter((c) => !c.removed && c.mode === "off").length;
  const removedLayoutEntries = (gallery as GalleryEntry[]).filter((g) => layoutRemoved.has(g.key));
  const removedCustomSlides = customSlides.filter((c) => c.removed);
  const deletedSlidesCount = removedLayoutEntries.length + removedCustomSlides.length;
  const slideCount =
    (gallery as GalleryEntry[]).length - removedLayoutEntries.length + customSlides.length - removedCustomSlides.length;

  const shownCustomPhotos = customPhotos.filter((p) => {
    if (p.removed) return false;
    if (photoFilter === "on") return p.enabled;
    if (photoFilter === "off") return !p.enabled;
    if (photoFilter === "favourites") return p.enabled && p.preferred;
    return true; // all
  });
  const shownBuiltinPhotos = (photoLibrary as BuiltinPhoto[]).filter((p) => {
    if (builtinPhotoRemoved.has(p.id)) return false;
    if (photoFilter === "on") return !photoDisabled.has(p.id);
    if (photoFilter === "off") return photoDisabled.has(p.id);
    if (photoFilter === "favourites") return !photoDisabled.has(p.id) && photoPreferred.has(p.id);
    return true; // all
  });
  const photoOffCount =
    photoDisabled.size + customPhotos.filter((p) => !p.removed && !p.enabled).length;
  const photoFavCount =
    photoPreferred.size + customPhotos.filter((p) => !p.removed && p.enabled && p.preferred).length;
  const removedBuiltinPhotos = (photoLibrary as BuiltinPhoto[]).filter((p) => builtinPhotoRemoved.has(p.id));
  const removedCustomPhotos = customPhotos.filter((p) => p.removed);
  const deletedPhotosCount = removedBuiltinPhotos.length + removedCustomPhotos.length;

  const switchCls = (on: boolean) =>
    `relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
      on ? "bg-[#3FD0C9]" : "bg-zinc-300"
    }`;
  const knobCls = (on: boolean) =>
    `absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`;

  const numField = (
    label: string,
    key: keyof DesignSettings,
    placeholder: string,
    min: number,
    max: number,
    step: number,
    unit?: string
  ) => (
    <label className="block text-xs font-semibold text-[#06456B]">
      {label}
      <span className="mt-1 flex items-center gap-1">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={(design[key] as number | string | undefined) ?? ""}
          placeholder={placeholder}
          onChange={(e) => setDesignField(key, e.target.value)}
          disabled={!designMigrated}
          className="w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm font-normal outline-none focus:border-[#3FD0C9] disabled:bg-zinc-50"
        />
        {unit && <span className="text-[11px] font-normal text-zinc-400">{unit}</span>}
      </span>
    </label>
  );

  return (
    <div className="min-h-screen bg-[#FBFBFD]">
      <style>{`
        @keyframes aboutV2Pop { 0% { opacity: 0; transform: scale(.97); } 100% { opacity: 1; transform: scale(1); } }
        .aboutv2-pop { animation: aboutV2Pop .2s cubic-bezier(.16,1,.3,1); }
      `}</style>

      <div className="mx-auto max-w-5xl px-4 pb-3 pt-10">
        {/* ----- slim masthead — no descriptive paragraph, unlike /about ----- */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#0A7A8A]">About V2</div>
            <h1 className="mt-1 text-[26px] font-bold tracking-tight text-[#1D1D1F]">Generation settings</h1>
          </div>
          <ReviewerField value={reviewer} onChange={onReviewerChange} placeholder="Your name (recorded on changes)" />
        </div>

        {/* ----- brand — same picker as /about ----- */}
        <section className="mt-7">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6E6E73]">
            Which brand are these settings for?
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PRODUCTS.map((p) => {
              const valgt = product === p.id && p.available;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => p.available && setProduct(p.id)}
                  disabled={!p.available}
                  className={`relative rounded-2xl border p-4 text-center transition-colors ${
                    valgt ? "border-[#3FD0C9] bg-[#EEFAF9]" : "border-[#E8E8ED] bg-white hover:border-[#D9D9DE]"
                  } ${!p.available ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  {!p.available && (
                    <span className="absolute right-2 top-2 rounded-md bg-[#F2F2F4] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#AEAEB2]">
                      Soon
                    </span>
                  )}
                  {/* The real brand mark when we have it; nothing at all when we don't, rather than
                      a stand-in shape that would misrepresent the brand. */}
                  {p.logo && (
                    <div className="mb-2 flex justify-center">
                      <img src={p.logo} alt={p.label} className="h-8 w-8 object-contain" />
                    </div>
                  )}
                  <div className="text-sm font-semibold text-[#1D1D1F]">{p.label}</div>
                  {p.hint && <div className="text-xs text-[#6E6E73]">{p.hint}</div>}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-[#6E6E73]">
            Settings below are for <strong className="text-[#1D1D1F]">{selectedProduct.label}</strong>.
            Revervia, Lysoveta and PL+ will get their own rules, design settings and slide library once
            they are onboarded — they will not inherit Superba&apos;s.
          </p>
        </section>

        {/* ----- tabs — one section visible at a time ----- */}
        <div className="mt-7 flex gap-1 rounded-2xl bg-[#EFEFF1] p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-[13.5px] font-semibold transition-colors ${
                activeTab === t.id ? "bg-[#1D1D1F] text-white shadow-sm" : "text-[#6E6E73] hover:text-[#1D1D1F]"
              }`}
            >
              <TabIcon id={t.id} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-5">
        <div key={activeTab} className="aboutv2-pop">
          {/* ============================================================ RULES ============================================================ */}
          {activeTab === "rules" && (
            <section className="rounded-[4px] border border-[#C2D9E3] bg-white p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-[#031B34]">Writing rules & principles</h2>
                  <Strength kind="checked" />
                </div>
                <span className="text-xs text-zinc-500">
                  {rules.filter((r) => r.enabled).length} active · applied to every new PowerPoint deck
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-zinc-600">
                Standing instructions for every deck, for everyone using the tool. Write them like you
                would brief a colleague — content rules (&quot;Always end with open research
                questions&quot;) or writing principles (&quot;Bullet points are one sentence each&quot;,
                &quot;Action titles must state the number, not just the direction&quot;). After a deck is
                drafted it is read back against these rules, and anything that breaks one is sent back to
                be fixed before you see it. For fonts, sizes and spacing use{" "}
                <span className="font-semibold">Design</span> instead — those are written by the code and
                the AI is never asked.
              </p>

              {!canEdit ? (
                <p className="mt-4 rounded-[4px] border border-dashed border-[#C2D9E3] bg-[#F7FAFC] p-4 text-sm text-zinc-500">
                  Rules live in the shared database and it is not ready yet
                  {rulesConfigured
                    ? ": run migration 0004_generation_rules_and_layouts.sql in the Supabase SQL editor."
                    : " (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set)."}
                </p>
              ) : (
                <>
                  <ul className="mt-4 space-y-2">
                    {rules.length === 0 && (
                      <li className="rounded-[4px] border border-dashed border-[#C2D9E3] p-4 text-sm text-zinc-500">
                        No rules yet. The first one you add applies to the very next generation.
                      </li>
                    )}
                    {rules.map((r) => (
                      <li
                        key={r.id}
                        className={`flex items-start gap-3 rounded-[4px] border p-3 ${
                          r.enabled ? "border-[#C2D9E3] bg-white" : "border-[#E3EDF2] bg-[#F7FAFC]"
                        }`}
                      >
                        <button
                          type="button"
                          role="switch"
                          aria-checked={r.enabled}
                          title={r.enabled ? "On: applied to every generation" : "Off: kept but not applied"}
                          onClick={() => void patchRule(r.id, { enabled: !r.enabled })}
                          className={`mt-0.5 ${switchCls(r.enabled)}`}
                        >
                          <span className={knobCls(r.enabled)} />
                        </button>

                        {editingId === r.id ? (
                          <div className="min-w-0 flex-1">
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              rows={2}
                              className="w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm outline-none focus:border-[#3FD0C9]"
                            />
                            <div className="mt-1 flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  void patchRule(r.id, { text: editText });
                                  setEditingId(null);
                                }}
                                className="rounded-[4px] bg-[#031B34] px-3 py-1 text-xs font-semibold text-white"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="rounded-[4px] px-3 py-1 text-xs font-semibold text-zinc-500 hover:bg-zinc-100"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm ${r.enabled ? "text-[#031B34]" : "text-zinc-400"}`}>{r.text}</p>
                            <p className="mt-1 text-[11px] text-zinc-400">
                              {r.updated_by || r.created_by
                                ? `By ${r.updated_by || r.created_by} · ${new Date(r.updated_at || r.created_at).toLocaleDateString()}`
                                : new Date(r.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        )}

                        {editingId !== r.id && (
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(r.id);
                                setEditText(r.text);
                              }}
                              className="rounded-[4px] px-2 py-1 text-xs font-semibold text-[#06456B] hover:bg-[#EAF3F7]"
                            >
                              ✎ Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteRule(r.id)}
                              className="rounded-[4px] px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4 flex items-start gap-2">
                    <textarea
                      value={newRule}
                      onChange={(e) => setNewRule(e.target.value)}
                      rows={2}
                      placeholder='Add a rule, e.g. "Bullet points are one sentence each, never two" or "Always include a krill oil vs fish oil comparison when the source allows it"'
                      className="flex-1 rounded-[4px] border border-[#C2D9E3] p-2 text-sm outline-none focus:border-[#3FD0C9]"
                    />
                    <button
                      type="button"
                      onClick={() => void addRule()}
                      disabled={!newRule.trim() || savingRule}
                      className="rounded-[4px] bg-[#031B34] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      {savingRule ? "Saving…" : "＋ Add rule"}
                    </button>
                  </div>
                </>
              )}
              {ruleError && <p className="mt-2 text-sm text-red-700">{ruleError}</p>}

              {/* Photo and icon density: standing preferences, and NOT enforced (they used to sit
                  in Design settings under an "enforced in code" heading, which was untrue —
                  photo level is a prompt paragraph plus a soft coverage check, and only "No
                  icons" is actually guaranteed by the renderer). Still saved into
                  design_settings, so nothing about generation changed with the move. */}
              <div className="mt-6 border-t border-[#EEF4F7] pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-[#031B34]">How many photos and icons</h3>
                  <Strength kind="checked" />
                </div>
                <p className="mt-1 max-w-3xl text-xs text-zinc-600">
                  How richly a deck uses the photo and icon libraries. These are preferences the AI
                  works to, and the finished deck is checked against the photo target — with one
                  exception that is a hard guarantee: <span className="font-semibold">No icons</span>{" "}
                  is applied by the code, so no icon can slip through.
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block text-xs font-semibold text-[#06456B]">
                    Photos in decks
                    <select
                      value={design.photo_level || "default"}
                      disabled={!designMigrated}
                      onChange={(e) => setDesignField("photo_level", e.target.value === "default" ? "" : e.target.value)}
                      className="mt-1 w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm font-normal outline-none disabled:opacity-50"
                    >
                      <option value="less">Fewer photos</option>
                      <option value="default">Standard</option>
                      <option value="more">More photos</option>
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-[#06456B]">
                    Icons in decks
                    <select
                      value={design.icon_level || "default"}
                      disabled={!designMigrated}
                      onChange={(e) => setDesignField("icon_level", e.target.value === "default" ? "" : e.target.value)}
                      className="mt-1 w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm font-normal outline-none disabled:opacity-50"
                    >
                      <option value="none">No icons</option>
                      <option value="less">Fewer icons</option>
                      <option value="default">Standard</option>
                    </select>
                  </label>
                  <div className="flex items-end sm:col-span-2">
                    <button
                      type="button"
                      onClick={() => void saveDesign()}
                      disabled={!designDirty || designSaving}
                      className="rounded-[4px] bg-[#031B34] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      {designSaving ? "Saving…" : "Save"}
                    </button>
                    {designSavedTick && <span className="ml-2 self-center text-xs text-[#0A7A8A]">Saved.</span>}
                  </div>
                </div>
                {designError && <p className="mt-2 text-sm text-red-700">{designError}</p>}
              </div>
            </section>
          )}

          {/* ============================================================ DESIGN ============================================================ */}
          {activeTab === "design" && (
            <section className="rounded-[4px] border border-[#C2D9E3] bg-white p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-[#031B34]">Design settings</h2>
                  <Strength kind="enforced" />
                </div>
                <span className="text-xs text-zinc-500">written by the code on every generated deck</span>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-zinc-600">
                These override the brand template deterministically — no AI involved, so they cannot come
                out wrong. Leave a field empty to keep the brand default (shown in grey). Fonts must be
                installed on the machines that open the decks; the page margin and box gutter apply to the
                code drawn slide types. How many photos and icons a deck uses is a judgement call rather
                than a measurement, so those two live under <span className="font-semibold">Rules</span>.
              </p>

              {/* ----- color themes — informational only; the AI alternates between these per slide
                  for rhythm by default, or the Content Generator's "Color theme" picker can force
                  every slide in a deck to one of them ----- */}
              <div className="mt-4 rounded-[4px] border border-[#E3EDF2] bg-[#FBFBFD] p-4">
                <div className="text-xs font-bold uppercase tracking-[0.08em] text-[#6E6E73]">Color themes</div>
                <p className="mt-1 max-w-2xl text-xs text-zinc-500">
                  By default a deck alternates between these backgrounds, slide by slide, for visual
                  rhythm — the AI picks which one fits each slide. The Content Generator's &quot;Color
                  theme&quot; setting can also force every slide in a deck to just one of them.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <div className="flex items-center gap-2 rounded-[4px] border border-[#E3EDF2] bg-white px-3 py-2">
                    <span
                      className="h-6 w-6 shrink-0 rounded-[4px]"
                      style={{ background: "linear-gradient(135deg, #163536, #003462)" }}
                    />
                    <div>
                      <div className="text-xs font-bold text-[#031B34]">Blue Ocean</div>
                      <div className="text-[10.5px] text-zinc-400">Dark theme &middot; deep-sea gradient</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-[4px] border border-[#E3EDF2] bg-white px-3 py-2">
                    <span className="h-6 w-6 shrink-0 rounded-[4px] border border-[#E3EDF2]" style={{ background: "#FFFFFF" }} />
                    <div>
                      <div className="text-xs font-bold text-[#031B34]">White</div>
                      <div className="text-[10.5px] text-zinc-400">Light theme &middot; plain white</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-[4px] border border-[#E3EDF2] bg-white px-3 py-2">
                    <span className="h-6 w-6 shrink-0 rounded-[4px] border border-[#E3EDF2]" style={{ background: "#A9DBD5" }} />
                    <div>
                      <div className="text-xs font-bold text-[#031B34]">Pastel Blue</div>
                      <div className="text-[10.5px] text-zinc-400">Light theme &middot; solid mint</div>
                    </div>
                  </div>
                </div>
              </div>

              {!designMigrated ? (
                <p className="mt-4 rounded-[4px] border border-dashed border-[#C2D9E3] bg-[#F7FAFC] p-4 text-sm text-zinc-500">
                  Design settings live in the shared database and it is not ready yet: run migration
                  0005_design_settings_and_custom_slides.sql in the Supabase SQL editor. Until then decks
                  use the brand defaults.
                </p>
              ) : (
                <>
                  <datalist id="font-suggestions">
                    {FONT_SUGGESTIONS.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="block text-xs font-semibold text-[#06456B]">
                      Title font
                      <input
                        list="font-suggestions"
                        value={design.title_font ?? ""}
                        placeholder="Exo 2 (brand)"
                        onChange={(e) => setDesignField("title_font", e.target.value)}
                        className="mt-1 w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm font-normal outline-none focus:border-[#3FD0C9]"
                      />
                    </label>
                    <label className="block text-xs font-semibold text-[#06456B]">
                      Body font
                      <input
                        list="font-suggestions"
                        value={design.body_font ?? ""}
                        placeholder="Manrope (brand)"
                        onChange={(e) => setDesignField("body_font", e.target.value)}
                        className="mt-1 w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm font-normal outline-none focus:border-[#3FD0C9]"
                      />
                    </label>
                    {numField("Title size", "size_title", "18", 14, 40, 1, "pt")}
                    {numField("Body size", "size_body", "14", 9, 24, 1, "pt")}
                    {numField("Small text size", "size_small", "12", 8, 18, 1, "pt")}
                    {numField("Line spacing", "line_spacing", "1.06", 0.8, 2, 0.05)}
                    {numField("Page margin", "margin_in", "0.5", 0.2, 1.5, 0.05, "in")}
                    {numField("Box gutter", "gutter_in", "0.3", 0.1, 1, 0.05, "in")}
                  </div>

                  <div className="mt-4 grid gap-4 border-t border-[#E3EDF2] pt-4 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="block text-xs font-semibold text-[#06456B]">
                      Footer text (every slide)
                      <input
                        value={design.footer_text ?? ""}
                        placeholder='e.g. "Confidential, for internal use"'
                        onChange={(e) => setDesignField("footer_text", e.target.value)}
                        className="mt-1 w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm font-normal outline-none focus:border-[#3FD0C9]"
                      />
                    </label>
                    <div className="text-xs font-semibold text-[#06456B]">
                      Footer extras
                      <label className="mt-2 flex items-center gap-2 font-normal text-zinc-600">
                        <input
                          type="checkbox"
                          checked={design.page_numbers !== false}
                          onChange={(e) => {
                            setDesign((d) => ({ ...d, page_numbers: e.target.checked ? undefined : false }));
                            setDesignDirty(true);
                            setDesignSavedTick(false);
                          }}
                        />
                        Page numbers
                      </label>
                      <label className="mt-1 flex items-center gap-2 font-normal text-zinc-600">
                        <input
                          type="checkbox"
                          checked={design.date_stamp === true}
                          onChange={(e) => {
                            setDesign((d) => ({ ...d, date_stamp: e.target.checked ? true : undefined }));
                            setDesignDirty(true);
                            setDesignSavedTick(false);
                          }}
                        />
                        Date of generation
                      </label>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void saveDesign()}
                      disabled={!designDirty || designSaving}
                      className="rounded-[4px] bg-[#031B34] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      {designSaving ? "Saving…" : "Save design settings"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void previewDesign()}
                      disabled={previewBusy}
                      className="rounded-[4px] border border-[#031B34] px-4 py-2 text-sm font-semibold text-[#031B34] disabled:opacity-40"
                    >
                      {previewBusy ? "Rendering preview…" : "Preview sample slides"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDesign({});
                        void saveDesign({});
                      }}
                      disabled={designSaving}
                      className="rounded-[4px] px-3 py-2 text-sm font-semibold text-[#06456B] hover:bg-[#EAF3F7]"
                    >
                      Reset to brand defaults
                    </button>
                    {designSavedTick && !designDirty && (
                      <span className="text-xs font-semibold text-emerald-700">Saved — applies to the next generation.</span>
                    )}
                    {designMeta.by && !designDirty && !designSavedTick && (
                      <span className="text-[11px] text-zinc-400">
                        Last changed by {designMeta.by}
                        {designMeta.at ? ` · ${new Date(designMeta.at).toLocaleDateString()}` : ""}
                      </span>
                    )}
                  </div>
                </>
              )}
              {designError && <p className="mt-2 text-sm text-red-700">{designError}</p>}
              {previewError && <p className="mt-2 text-sm text-red-700">{previewError}</p>}
              {previewImgs && (
                <div className="mt-4">
                  <p className="text-xs text-zinc-500">
                    Sample slides rendered with the settings above (fixed example content — your decks
                    keep their own content):
                  </p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {previewImgs.map((b64, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={`data:image/jpeg;base64,${b64}`}
                        alt={`Design preview slide ${i + 1}`}
                        className="w-full rounded-[4px] border border-[#C2D9E3]"
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ============================================================ SLIDES ============================================================ */}
          {activeTab === "slides" && (
            <section>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-[#031B34]">Slide library</h2>
                  <Strength kind="enforced" />
                </div>
                <span className="text-xs text-zinc-500">
                  {slideCount} slides · {offCount} turned off
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-zinc-600">
                Every slide the tool can put in a deck, with real example renders. Turn a slide type off
                and the AI can no longer pick it; turn it back on any time. Add your own finished slides
                from a PowerPoint file — they are inserted exactly as designed, either where the AI
                judges they fit or in every deck. Cover and Agenda are required and stay on. Every slide
                works the same way: the switch turns it on or off, the star marks a house favourite, and{" "}
                <span className="font-semibold">✎ Edit</span> holds everything else — its name, its
                description, when to use it, and the slide design itself (download it, restyle it in
                PowerPoint, upload it back; the AI keeps writing the text).{" "}
                <span className="font-semibold">Remove</span> moves a slide to Deleted items, where it can
                be restored.
              </p>
              <p className="mt-1.5 max-w-3xl text-xs text-zinc-500">
                A slide switched off is removed from the AI&rsquo;s vocabulary outright, so it can never
                appear. The <span className="font-semibold">star</span> is a preference rather than a
                rule: it is what the AI reaches for first when several slides fit a point equally well.
              </p>

              {!layoutsMigrated && (
                <p className="mt-4 rounded-[4px] border border-dashed border-[#C2D9E3] bg-white p-4 text-sm text-zinc-500">
                  The on/off switches live in the shared database and it is not ready yet: run migration
                  0004_generation_rules_and_layouts.sql in the Supabase SQL editor. Until then every
                  slide type stays on.
                </p>
              )}
              {layoutError && <p className="mt-2 text-sm text-red-700">{layoutError}</p>}
              {customError && <p className="mt-2 text-sm text-red-700">{customError}</p>}
              {overrideNotice && <p className="mt-2 text-sm font-semibold text-[#0A7A8A]">{overrideNotice}</p>}

              {/* upload flow */}
              {slidesView === "library" && (
              <div className="mt-4 rounded-[4px] border border-[#C2D9E3] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-[#031B34]">Add your own slides</div>
                    <p className="text-xs text-zinc-500">
                      Upload a .pptx, pick the slides you want, give each a name and a line on when
                      to use it. Each one can either be a design the AI writes fresh text into, or a
                      finished slide inserted exactly as drawn.
                    </p>
                  </div>
                  <label className="cursor-pointer rounded-[4px] bg-[#031B34] px-4 py-2 text-sm font-semibold text-white">
                    {uploadBusy ? "Rendering previews…" : "＋ Upload PowerPoint"}
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".pptx"
                      className="hidden"
                      disabled={uploadBusy || !slidesMigrated}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void inspectUpload(f);
                      }}
                    />
                  </label>
                </div>
                {!slidesMigrated && (
                  <p className="mt-3 rounded-[4px] border border-dashed border-[#C2D9E3] bg-[#F7FAFC] p-3 text-xs text-zinc-500">
                    Your slides live in the shared database and it is not ready yet: run migration
                    0005_design_settings_and_custom_slides.sql in the Supabase SQL editor.
                  </p>
                )}
                {uploadError && <p className="mt-2 text-sm text-red-700">{uploadError}</p>}
                {uploadBusy && (
                  <div className="mt-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm text-zinc-500">
                        {uploadProgress ? uploadProgress.step : "Uploading the file…"}
                      </p>
                      {uploadProgress && (
                        <span className="text-xs font-semibold text-[#06456B]">{uploadProgress.pct}%</span>
                      )}
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#EAF3F7]">
                      <div
                        className="h-full rounded-full bg-[#031B34] transition-all duration-700"
                        style={{ width: `${uploadProgress?.pct ?? 3}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">
                      A big file (many slides) renders for a few minutes on the server — leave this open.
                    </p>
                  </div>
                )}

                {picks && (
                  <div className="mt-4">
                    <p className="text-xs text-zinc-500">
                      Tick the slides to add from <span className="font-semibold">{uploadFile?.name}</span>:
                    </p>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {picks.map((p, i) => (
                        <div
                          key={p.index}
                          className={`overflow-hidden rounded-[4px] border ${p.picked ? "border-[#3FD0C9]" : "border-[#E3EDF2]"}`}
                        >
                          <button
                            type="button"
                            className="relative block w-full"
                            onClick={() => {
                              const nowPicked = !p.picked;
                              setPicks((ps) => ps!.map((x, j) => (j === i ? { ...x, picked: nowPicked } : x)));
                              // Measure the design as soon as it is ticked, so the "N text areas"
                              // confirmation is there before the user hits Add.
                              if (nowPicked && p.aiFills && !p.slots?.length) void measurePick(p.index);
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`data:image/jpeg;base64,${p.preview_b64}`}
                              alt={`Slide ${p.index + 1}`}
                              className="aspect-video w-full object-cover"
                            />
                            <span
                              className={`absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-[3px] border text-xs font-bold ${
                                p.picked ? "border-[#3FD0C9] bg-[#3FD0C9] text-[#031B34]" : "border-zinc-300 bg-white text-transparent"
                              }`}
                            >
                              ✓
                            </span>
                          </button>
                          {p.picked && (
                            <div className="space-y-2 border-t border-[#E3EDF2] p-2">
                              <input
                                value={p.name}
                                placeholder="Short name (required)"
                                onChange={(e) =>
                                  setPicks((ps) => ps!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                                }
                                className="w-full rounded-[4px] border border-[#C2D9E3] p-1.5 text-xs outline-none focus:border-[#3FD0C9]"
                              />
                              <input
                                value={p.description}
                                placeholder="When should the AI use it? e.g. 'Company overview for intros'"
                                onChange={(e) =>
                                  setPicks((ps) => ps!.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))
                                }
                                className="w-full rounded-[4px] border border-[#C2D9E3] p-1.5 text-xs outline-none focus:border-[#3FD0C9]"
                              />
                              <select
                                value={p.mode}
                                onChange={(e) =>
                                  setPicks((ps) =>
                                    ps!.map((x, j) => (j === i ? { ...x, mode: e.target.value as "auto" | "always" } : x))
                                  )
                                }
                                className="w-full rounded-[4px] border border-[#C2D9E3] p-1.5 text-xs outline-none"
                              >
                                <option value="auto">AI decides when it fits</option>
                                <option value="always" disabled={p.aiFills}>
                                  In every deck{p.aiFills ? " (needs 'use exactly as is')" : ""}
                                </option>
                              </select>
                              {/* The choice that decides whether this is a design or a finished
                                  slide. Default is AI-filled: someone who restyled one of our
                                  slides and uploaded it back means "keep my design, keep writing
                                  the text", and that used to be impossible here. */}
                              <div className="rounded-[4px] border border-dashed border-[#C2D9E3] bg-[#F7FAFC] p-2">
                                <label className="flex cursor-pointer items-start gap-2">
                                  <input
                                    type="checkbox"
                                    checked={p.aiFills}
                                    className="mt-0.5"
                                    onChange={(e) => {
                                      const on = e.target.checked;
                                      setPicks((ps) =>
                                        ps!.map((x, j) =>
                                          j === i
                                            ? {
                                                ...x,
                                                aiFills: on,
                                                slotsError: "",
                                                mode: on && x.mode === "always" ? "auto" : x.mode,
                                              }
                                            : x
                                        )
                                      );
                                      if (on && !p.slots?.length) void measurePick(p.index);
                                    }}
                                  />
                                  <span className="text-[11px] text-zinc-600">
                                    <span className="font-semibold text-[#031B34]">
                                      Let the AI write this slide&rsquo;s text
                                    </span>
                                    <br />
                                    Keeps your design exactly as it is and writes fresh text into its
                                    boxes for every deck. Untick to insert the slide unchanged, text
                                    and all.
                                  </span>
                                </label>
                                {p.slotsBusy && (
                                  <p className="mt-1 text-[11px] text-zinc-500">Reading its text areas…</p>
                                )}
                                {p.aiFills && !p.slotsBusy && p.slots?.length ? (
                                  <p className="mt-1 text-[11px] font-semibold text-[#0A7A8A]">
                                    {p.slots.length} text area(s) the AI will write.
                                  </p>
                                ) : null}
                                {p.slotsError && (
                                  <p className="mt-1 text-[11px] text-red-700">
                                    {p.slotsError} Saved as a fixed slide instead.
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void savePicks()}
                        disabled={savingPicks || !picks.some((p) => p.picked)}
                        className="rounded-[4px] bg-[#031B34] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                      >
                        {savingPicks
                          ? "Adding…"
                          : `Add ${picks.filter((p) => p.picked).length || ""} slide${picks.filter((p) => p.picked).length === 1 ? "" : "s"}`}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void discardUploadedFile();
                          setPicks(null);
                          setUploadFile(null);
                          if (fileInput.current) fileInput.current.value = "";
                        }}
                        className="rounded-[4px] px-3 py-2 text-sm font-semibold text-zinc-500 hover:bg-zinc-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
              )}

              {/* filters */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {slidesView === "library" &&
                    (
                      [
                        ["all", "All"],
                        ["on", "In use"],
                        ["off", `Turned off (${offCount})`],
                        ["favourites", `Favourites (${preferred.size})`],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setFilter(k)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                          filter === k ? "bg-[#031B34] text-white" : "bg-white text-[#06456B] hover:bg-[#EAF3F7]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  {slidesView === "deleted" && (
                    <button
                      type="button"
                      onClick={() => setSlidesView("library")}
                      className="rounded-full px-3 py-1 text-xs font-semibold text-[#06456B] hover:bg-[#EAF3F7]"
                    >
                      ← Back to the library
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!metaMigrated && customSlides.every((c) => !c.removed)}
                    title={
                      metaMigrated
                        ? "Removed slides land here and can be restored"
                        : "Run migration 0009_deleted_items_and_layout_overrides.sql in the Supabase SQL editor"
                    }
                    onClick={() => setSlidesView((v) => (v === "deleted" ? "library" : "deleted"))}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      slidesView === "deleted"
                        ? "border-[#031B34] bg-[#031B34] text-white"
                        : "border-[#C2D9E3] bg-white text-[#6E6E73] hover:bg-[#EAF3F7]"
                    }`}
                  >
                    🗑 Deleted items ({deletedSlidesCount})
                  </button>
                  {slidesView === "library" && (
                    <div className="flex items-center gap-1.5 rounded-full border border-[#C2D9E3] bg-white p-1">
                      {(
                        [
                          ["dark", "Blue Ocean"],
                          ["light", "White"],
                          ["pastel", "Pastel Blue"],
                        ] as const
                      ).map(([k, label]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setGalleryTheme(k)}
                          title={`Preview slides in the ${label} color theme`}
                          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                            galleryTheme === k ? "bg-[#031B34] text-white" : "text-[#06456B] hover:bg-[#EAF3F7]"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {slidesView === "library" && (
              <div className="mt-3 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => void downloadAllStandardLayouts()}
                  disabled={exportingAll}
                  title="Download all 42 standard slides as one PowerPoint file to edit several at once"
                  className="rounded-[4px] border border-[#C2D9E3] bg-white px-3 py-1.5 text-xs font-semibold text-[#06456B] hover:bg-[#EAF3F7] disabled:opacity-40"
                >
                  {exportingAll ? "Preparing download…" : "⬇ Download all template slides to edit"}
                </button>
              </div>
              )}

              {/* Deleted items: removed slides, restorable (team slides can also be purged) */}
              {slidesView === "deleted" && (
                <div className="mt-4">
                  {deletedSlidesCount === 0 ? (
                    <p className="rounded-[4px] border border-dashed border-[#C2D9E3] bg-white p-6 text-sm text-zinc-500">
                      Nothing here. Removed slides land in this list and can be restored.
                    </p>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {removedCustomSlides.map((c) => (
                        <div key={c.id} className="overflow-hidden rounded-[4px] border border-[#E3EDF2] bg-white">
                          {c.preview_b64 ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`data:image/jpeg;base64,${c.preview_b64}`}
                              alt={c.name}
                              className="aspect-video w-full border-b border-[#E3EDF2] object-cover opacity-60"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex aspect-video w-full items-center justify-center border-b border-[#E3EDF2] bg-[#F7FAFC] text-xs text-zinc-400">
                              No preview
                            </div>
                          )}
                          <div className="p-3">
                            <div className="truncate text-sm font-bold text-[#031B34]">{c.name}</div>
                            <div className="text-[11px] uppercase tracking-wide text-zinc-400">Removed</div>
                            <div className="mt-2 flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => void restoreSlide(c.id)}
                                className="rounded-[4px] bg-[#031B34] px-3 py-1 text-xs font-semibold text-white"
                              >
                                Restore
                              </button>
                              <button
                                type="button"
                                onClick={() => void purgeSlide(c.id, c.name)}
                                className="rounded-[4px] px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                              >
                                Delete permanently
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                      {removedLayoutEntries.map((g) => (
                        <div key={g.key} className="overflow-hidden rounded-[4px] border border-[#E3EDF2] bg-white">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={
                              overrides[g.key]?.preview_b64
                                ? `data:image/jpeg;base64,${overrides[g.key].preview_b64}`
                                : `/layout-gallery${galleryTheme === "dark" ? "" : `-${galleryTheme}`}/${g.key}.png`
                            }
                            alt={`Example of the ${pretty(g.key)} slide`}
                            className="aspect-video w-full border-b border-[#E3EDF2] object-cover opacity-60"
                            loading="lazy"
                          />
                          <div className="p-3">
                            <div className="truncate text-sm font-bold text-[#031B34]">
                              {layoutNames[g.key]?.display_name || pretty(g.key)}
                            </div>
                            <div className="text-[11px] uppercase tracking-wide text-zinc-400">Removed</div>
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => void restoreLayout(g.key)}
                                className="rounded-[4px] bg-[#031B34] px-3 py-1 text-xs font-semibold text-white"
                              >
                                Restore
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* the grid: team slides first, then built-ins — one uniform library */}
              {slidesView === "library" && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shownCustom.map((c) => (
                  <div
                    key={c.id}
                    className={`overflow-hidden rounded-[4px] border bg-white ${
                      c.mode === "off" ? "border-[#E3EDF2] opacity-60" : "border-[#C2D9E3]"
                    }`}
                  >
                    {c.preview_b64 ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`data:image/jpeg;base64,${c.preview_b64}`}
                        alt={c.name}
                        className="aspect-video w-full border-b border-[#E3EDF2] object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex aspect-video w-full items-center justify-center border-b border-[#E3EDF2] bg-[#F7FAFC] text-xs text-zinc-400">
                        No preview
                      </div>
                    )}
                    <div className="p-3">
                      {editingSlide === c.id ? (
                        <div className="space-y-2">
                          <input
                            value={slideName}
                            onChange={(e) => setSlideName(e.target.value)}
                            className="w-full rounded-[4px] border border-[#C2D9E3] p-1.5 text-xs outline-none focus:border-[#3FD0C9]"
                          />
                          <input
                            value={slideDesc}
                            placeholder="When should the AI use it?"
                            onChange={(e) => setSlideDesc(e.target.value)}
                            className="w-full rounded-[4px] border border-[#C2D9E3] p-1.5 text-xs outline-none focus:border-[#3FD0C9]"
                          />
                          <label className="block text-[11px] font-semibold text-[#06456B]">
                            When to use it
                            <select
                              value={c.mode}
                              onChange={(e) => void patchSlide(c.id, { mode: e.target.value })}
                              className="mt-1 w-full rounded-[4px] border border-[#C2D9E3] p-1.5 text-xs font-normal outline-none"
                            >
                              <option value="auto">{MODE_LABEL.auto}</option>
                              <option value="always">{MODE_LABEL.always}</option>
                            </select>
                          </label>
                          {/* The design round trip lives here, next to the other edits, rather
                              than as extra buttons on the card face. */}
                          <div className="rounded-[4px] border border-dashed border-[#C2D9E3] bg-[#F7FAFC] p-2">
                            <p className="text-[11px] text-zinc-500">
                              Change how it looks: download the slide, restyle it in PowerPoint and
                              upload it back.
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void downloadCustomSlide(c.id, c.name)}
                                disabled={exportingSlide === c.id}
                                className="rounded-[4px] px-2 py-1 text-[11px] font-semibold text-[#06456B] hover:bg-[#EAF3F7] disabled:opacity-40"
                              >
                                {exportingSlide === c.id ? "Downloading…" : "⬇ Download to edit"}
                              </button>
                              <label
                                className={`rounded-[4px] px-2 py-1 text-[11px] font-semibold text-[#06456B] hover:bg-[#EAF3F7] ${
                                  replacingSlide === c.id ? "opacity-40" : "cursor-pointer"
                                }`}
                              >
                                {replacingSlide === c.id ? "Replacing…" : "↑ Upload edited design"}
                                <input
                                  type="file"
                                  accept=".pptx"
                                  className="hidden"
                                  disabled={replacingSlide === c.id}
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) void replaceCustomSlide(c.id, f);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                void patchSlide(c.id, { name: slideName, description: slideDesc });
                                setEditingSlide(null);
                              }}
                              className="rounded-[4px] bg-[#031B34] px-3 py-1.5 text-xs font-semibold text-white"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingSlide(null)}
                              className="rounded-[4px] px-2 py-1.5 text-xs font-semibold text-zinc-500 hover:bg-zinc-100"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <div className="truncate text-sm font-bold text-[#031B34]">{c.name}</div>
                              {c.slots?.length ? (
                                <span
                                  className={PILL_AI}
                                  title={`Your design, ${c.slots.length} text area(s) the AI writes for each deck`}
                                >
                                  AI writes text
                                </span>
                              ) : (
                                <span className={PILL_ASIS} title="Inserted exactly as drawn — the AI writes nothing on it">
                                  As is
                                </span>
                              )}
                              {c.mode === "always" && (
                                <span className={PILL_ASIS} title="Included in every deck">
                                  Every deck
                                </span>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-4">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={c.mode !== "off"}
                                title={c.mode === "off" ? "Off: not used in new decks" : "On: available to the AI"}
                                onClick={() => void patchSlide(c.id, { mode: c.mode === "off" ? "auto" : "off" })}
                                className={switchCls(c.mode !== "off")}
                              >
                                <span className={knobCls(c.mode !== "off")} />
                              </button>
                            </div>
                          </div>
                          {c.description && <p className="mt-1.5 line-clamp-2 text-xs text-zinc-500">{c.description}</p>}
                          <div className={CARD_ACTIONS}>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSlide(c.id);
                                setSlideName(c.name);
                                setSlideDesc(c.description);
                              }}
                              className={BTN_EDIT}
                            >
                              ✎ Edit
                            </button>
                            <button type="button" onClick={() => void deleteSlide(c.id)} className={BTN_REMOVE}>
                              Remove
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}

                {entries.map((g) => {
                  const off = disabled.has(g.key);
                  const locked = LOCKED.has(g.key) || g.kind === "verbatim";
                  const ov = overrides[g.key];
                  const displayName = layoutNames[g.key]?.display_name || pretty(g.key);
                  const displayDesc = layoutNames[g.key]?.description || cleanUsage(g.usage);
                  return (
                    <div
                      key={g.key}
                      className={`overflow-hidden rounded-[4px] border bg-white ${
                        off ? "border-[#E3EDF2] opacity-60" : "border-[#C2D9E3]"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={
                          ov?.preview_b64
                            ? `data:image/jpeg;base64,${ov.preview_b64}`
                            : `/layout-gallery${galleryTheme === "dark" ? "" : `-${galleryTheme}`}/${g.key}.png`
                        }
                        alt={`Example of the ${displayName} slide${ov ? "" : ` in ${GALLERY_THEME_LABEL[galleryTheme]}`}`}
                        className="aspect-video w-full border-b border-[#E3EDF2] object-cover"
                        loading="lazy"
                      />
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <div className="truncate text-sm font-bold text-[#031B34]">{displayName}</div>
                            {ov && (
                              <span
                                className={PILL_AI}
                                title="The team replaced this slide's design — the AI keeps writing its text"
                              >
                                Custom design
                              </span>
                            )}
                            {locked && (
                              <span
                                className={PILL_ASIS}
                                title={
                                  g.kind === "verbatim"
                                    ? "A fixed brand slide — always included, never rewritten"
                                    : "Required in every deck, so it cannot be turned off or removed"
                                }
                              >
                                {g.kind === "verbatim" ? "Fixed" : "Always on"}
                              </span>
                            )}
                          </div>
                          {!locked && (
                            <div className="flex shrink-0 items-center gap-4">
                              {!off && starsMigrated && (
                                <button
                                  type="button"
                                  onClick={() => void toggleStar(g.key, !preferred.has(g.key))}
                                  title={
                                    preferred.has(g.key)
                                      ? "House favourite: the AI prefers this when several layouts fit"
                                      : "Star as a house favourite"
                                  }
                                  className={`${STAR_BTN} ${
                                    preferred.has(g.key) ? "text-amber-500" : "text-zinc-300 hover:text-amber-400"
                                  }`}
                                >
                                  {preferred.has(g.key) ? "★" : "☆"}
                                </button>
                              )}
                              <button
                                type="button"
                                role="switch"
                                aria-checked={!off}
                                disabled={!layoutsMigrated}
                                title={off ? "Off: the AI cannot pick this slide type" : "On: available to the AI"}
                                onClick={() => void toggleLayout(g.key, off)}
                                className={switchCls(!off)}
                              >
                                <span className={knobCls(!off)} />
                              </button>
                            </div>
                          )}
                        </div>
                        {editingLayout === g.key ? (
                          <div className="mt-2 space-y-2">
                            <input
                              value={layoutNameDraft}
                              placeholder={pretty(g.key)}
                              onChange={(e) => setLayoutNameDraft(e.target.value)}
                              className="w-full rounded-[4px] border border-[#C2D9E3] p-1.5 text-xs outline-none focus:border-[#3FD0C9]"
                            />
                            <textarea
                              value={layoutDescDraft}
                              rows={3}
                              placeholder={cleanUsage(g.usage)}
                              onChange={(e) => setLayoutDescDraft(e.target.value)}
                              className="w-full rounded-[4px] border border-[#C2D9E3] p-1.5 text-xs outline-none focus:border-[#3FD0C9]"
                            />
                            <div className="rounded-[4px] border border-dashed border-[#C2D9E3] bg-[#F7FAFC] p-2">
                              <p className="text-[11px] text-zinc-500">
                                Want a different look? Download the slide, restyle it in PowerPoint, and
                                upload it back. The AI keeps writing this slide&rsquo;s text — your upload
                                changes only the design.
                              </p>
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void downloadStandardLayout(g.key)}
                                  disabled={exportingLayout === g.key}
                                  className="rounded-[4px] px-2 py-1 text-[11px] font-semibold text-[#06456B] hover:bg-[#EAF3F7] disabled:opacity-40"
                                >
                                  {exportingLayout === g.key ? "Downloading…" : "⬇ Download to edit"}
                                </button>
                                <label
                                  className={`rounded-[4px] px-2 py-1 text-[11px] font-semibold text-[#06456B] hover:bg-[#EAF3F7] ${
                                    overridingLayout === g.key ? "opacity-40" : "cursor-pointer"
                                  }`}
                                >
                                  {overridingLayout === g.key ? "Analysing design…" : "↑ Upload edited design"}
                                  <input
                                    type="file"
                                    accept=".pptx"
                                    className="hidden"
                                    disabled={overridingLayout === g.key}
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      if (f) void uploadLayoutOverride(g.key, f);
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                                {ov && (
                                  <button
                                    type="button"
                                    onClick={() => void revertOverride(g.key, displayName)}
                                    title="Delete the uploaded design and go back to the standard one"
                                    className="rounded-[4px] px-2 py-1 text-[11px] font-semibold text-zinc-500 hover:bg-zinc-100"
                                  >
                                    ↩ Revert to standard design
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => void saveLayoutMeta(g.key)}
                                className="rounded-[4px] bg-[#031B34] px-3 py-1.5 text-xs font-semibold text-white"
                              >
                                Save
                              </button>
                              <button type="button" onClick={() => setEditingLayout(null)} className={BTN_SUBTLE}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p
                              className={`mt-2 cursor-pointer text-xs text-zinc-500 ${expanded === g.key ? "" : "line-clamp-2"}`}
                              onClick={() => setExpanded(expanded === g.key ? null : g.key)}
                              title={expanded === g.key ? "Click to collapse" : "Click to read the full guidance"}
                            >
                              {displayDesc}
                            </p>
                            {g.kind !== "verbatim" && metaMigrated && (
                              <div className={CARD_ACTIONS}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingLayout(g.key);
                                    setLayoutNameDraft(layoutNames[g.key]?.display_name ?? "");
                                    setLayoutDescDraft(layoutNames[g.key]?.description ?? "");
                                  }}
                                  title="Edit the name, the description, or the slide design itself"
                                  className={BTN_EDIT}
                                >
                                  ✎ Edit
                                </button>
                                {!locked && (
                                  <button
                                    type="button"
                                    onClick={() => void removeLayout(g.key, displayName)}
                                    className={BTN_REMOVE}
                                  >
                                    Remove
                                  </button>
                                )}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
            </section>
          )}

          {/* ============================================================ PHOTOS ============================================================ */}
          {activeTab === "photos" && (
            <section>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-[#031B34]">Photo library</h2>
                  <Strength kind="enforced" />
                </div>
                <span className="text-xs text-zinc-500">
                  {(photoLibrary as BuiltinPhoto[]).length} brand photos · {customPhotos.length} added by the team ·{" "}
                  {photoOffCount} turned off
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm text-zinc-600">
                The photos the AI can place on slides. Turn a photo off and the AI can no longer pick
                it; star one as a house favourite and the AI prefers it when several photos fit
                equally well. Add your own brand photos with a short description — the description is
                how the AI decides when to use a photo, so write it like a caption (&quot;Athlete
                stretching outdoors, for sports performance slides&quot;). Use{" "}
                <span className="font-semibold">✎ Edit</span> to change a photo&rsquo;s name or
                description (to change the image itself, remove the photo and add a new one);{" "}
                <span className="font-semibold">Remove</span> moves it to Deleted items, where it can
                be restored. Images are downscaled automatically before saving.
              </p>
              {!photoSettingsMigrated && (
                <p className="mt-4 rounded-[4px] border border-dashed border-[#C2D9E3] bg-white p-4 text-sm text-zinc-500">
                  The built-in photo on/off switches and stars live in the shared database and it is
                  not ready yet: run migration 0007_photo_settings.sql in the Supabase SQL editor.
                  Until then every built-in photo stays on.
                </p>
              )}
              {photoError && <p className="mt-2 text-sm text-red-700">{photoError}</p>}

              {photosView === "library" && (
              <div className="mt-4 rounded-[4px] border border-[#C2D9E3] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-[#031B34]">Add a photo</div>
                    <p className="text-xs text-zinc-500">JPG or PNG; name + description required.</p>
                  </div>
                  <label className="cursor-pointer rounded-[4px] bg-[#031B34] px-4 py-2 text-sm font-semibold text-white">
                    ＋ Upload photo
                    <input
                      ref={photoInput}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={!photosMigrated}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void pickPhoto(f);
                      }}
                    />
                  </label>
                </div>
                {!photosMigrated && (
                  <p className="mt-3 rounded-[4px] border border-dashed border-[#C2D9E3] bg-[#F7FAFC] p-3 text-xs text-zinc-500">
                    Team photos live in the shared database and it is not ready yet: run migration
                    0006_custom_photos_and_preferred_layouts.sql in the Supabase SQL editor.
                  </p>
                )}
                {photoDraft && (
                  <div className="mt-4 flex flex-wrap items-start gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`data:image/jpeg;base64,${photoDraft.thumb_b64}`}
                      alt="New photo"
                      className="w-56 rounded-[4px] border border-[#C2D9E3]"
                    />
                    <div className="min-w-64 flex-1 space-y-2">
                      <input
                        value={photoDraft.name}
                        placeholder="Short name (required)"
                        onChange={(e) => setPhotoDraft((d) => d && { ...d, name: e.target.value })}
                        className="w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm outline-none focus:border-[#3FD0C9]"
                      />
                      <textarea
                        value={photoDraft.description}
                        rows={2}
                        placeholder='When should the AI use it? e.g. "Runner at sunrise, for sports performance and recovery slides" (required)'
                        onChange={(e) => setPhotoDraft((d) => d && { ...d, description: e.target.value })}
                        className="w-full rounded-[4px] border border-[#C2D9E3] p-2 text-sm outline-none focus:border-[#3FD0C9]"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void savePhoto()}
                          disabled={photoSaving || !photoDraft.name.trim() || !photoDraft.description.trim()}
                          className="rounded-[4px] bg-[#031B34] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                        >
                          {photoSaving ? "Saving…" : "Add photo"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPhotoDraft(null);
                            if (photoInput.current) photoInput.current.value = "";
                          }}
                          className="rounded-[4px] px-3 py-2 text-sm font-semibold text-zinc-500 hover:bg-zinc-100"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              )}

              {/* filters */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {photosView === "library" &&
                    (
                      [
                        ["all", "All"],
                        ["on", "In use"],
                        ["off", `Turned off (${photoOffCount})`],
                        ["favourites", `Favourites (${photoFavCount})`],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setPhotoFilter(k)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                          photoFilter === k ? "bg-[#031B34] text-white" : "bg-white text-[#06456B] hover:bg-[#EAF3F7]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  {photosView === "deleted" && (
                    <button
                      type="button"
                      onClick={() => setPhotosView("library")}
                      className="rounded-full px-3 py-1 text-xs font-semibold text-[#06456B] hover:bg-[#EAF3F7]"
                    >
                      ← Back to the library
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!photoMetaMigrated && customPhotos.every((p) => !p.removed)}
                  title={
                    photoMetaMigrated
                      ? "Removed photos land here and can be restored"
                      : "Run migration 0009_deleted_items_and_layout_overrides.sql in the Supabase SQL editor"
                  }
                  onClick={() => setPhotosView((v) => (v === "deleted" ? "library" : "deleted"))}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    photosView === "deleted"
                      ? "border-[#031B34] bg-[#031B34] text-white"
                      : "border-[#C2D9E3] bg-white text-[#6E6E73] hover:bg-[#EAF3F7]"
                  }`}
                >
                  🗑 Deleted items ({deletedPhotosCount})
                </button>
              </div>

              {/* Deleted items: removed photos, restorable (team photos can also be purged) */}
              {photosView === "deleted" && (
                <div className="mt-4">
                  {deletedPhotosCount === 0 ? (
                    <p className="rounded-[4px] border border-dashed border-[#C2D9E3] bg-white p-6 text-sm text-zinc-500">
                      Nothing here. Removed photos land in this list and can be restored.
                    </p>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
                      {removedCustomPhotos.map((p) => (
                        <div key={p.id} className="overflow-hidden rounded-[4px] border border-[#E3EDF2] bg-white">
                          {p.thumb_b64 ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`data:image/jpeg;base64,${p.thumb_b64}`}
                              alt={p.name}
                              className="aspect-video w-full border-b border-[#E3EDF2] object-cover opacity-60"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex aspect-video items-center justify-center border-b border-[#E3EDF2] bg-[#F7FAFC] text-xs text-zinc-400">
                              No preview
                            </div>
                          )}
                          <div className="p-3">
                            <div className="truncate text-sm font-bold text-[#031B34]">{p.name}</div>
                            <div className="text-[11px] uppercase tracking-wide text-zinc-400">Removed</div>
                            <div className="mt-2 flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => void restorePhoto(p.id)}
                                className="rounded-[4px] bg-[#031B34] px-3 py-1 text-xs font-semibold text-white"
                              >
                                Restore
                              </button>
                              <button
                                type="button"
                                onClick={() => void purgePhoto(p.id, p.name)}
                                className="rounded-[4px] px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                              >
                                Delete permanently
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                      {removedBuiltinPhotos.map((p) => (
                        <div key={p.id} className="overflow-hidden rounded-[4px] border border-[#E3EDF2] bg-white">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/photo-library/${p.id}.jpg`}
                            alt={p.description}
                            className="aspect-video w-full border-b border-[#E3EDF2] object-cover opacity-60"
                            loading="lazy"
                          />
                          <div className="p-3">
                            <div className="truncate text-sm font-bold text-[#031B34]">
                              {photoNames[p.id]?.display_name || pretty(p.id.replace(/^photo_/, ""))}
                            </div>
                            <div className="text-[11px] uppercase tracking-wide text-zinc-400">Removed</div>
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => void restoreBuiltinPhoto(p.id)}
                                className="rounded-[4px] bg-[#031B34] px-3 py-1 text-xs font-semibold text-white"
                              >
                                Restore
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* team photos first, then the built-in library — one uniform grid */}
              {photosView === "library" && (
              <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {shownCustomPhotos.map((p) => (
                    <div
                      key={p.id}
                      className={`overflow-hidden rounded-[4px] border bg-white ${
                        p.enabled ? "border-[#C2D9E3]" : "border-[#E3EDF2] opacity-60"
                      }`}
                    >
                      {p.thumb_b64 ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`data:image/jpeg;base64,${p.thumb_b64}`}
                          alt={p.name}
                          className="aspect-video w-full border-b border-[#E3EDF2] object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex aspect-video items-center justify-center border-b border-[#E3EDF2] bg-[#F7FAFC] text-xs text-zinc-400">
                          No preview
                        </div>
                      )}
                      <div className="p-3">
                        {editingPhoto === p.id ? (
                          <div className="space-y-2">
                            <input
                              value={photoName}
                              onChange={(e) => setPhotoName(e.target.value)}
                              className="w-full rounded-[4px] border border-[#C2D9E3] p-1.5 text-xs outline-none focus:border-[#3FD0C9]"
                            />
                            <textarea
                              value={photoDesc}
                              rows={2}
                              onChange={(e) => setPhotoDesc(e.target.value)}
                              className="w-full rounded-[4px] border border-[#C2D9E3] p-1.5 text-xs outline-none focus:border-[#3FD0C9]"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  void patchPhoto(p.id, { name: photoName, description: photoDesc });
                                  setEditingPhoto(null);
                                }}
                                className="rounded-[4px] bg-[#031B34] px-3 py-1 text-xs font-semibold text-white"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingPhoto(null)}
                                className="rounded-[4px] px-2 py-1 text-xs font-semibold text-zinc-500 hover:bg-zinc-100"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 truncate text-sm font-bold text-[#031B34]">{p.name}</div>
                              <div className="flex shrink-0 items-center gap-4">
                                {p.enabled && (
                                  <button
                                    type="button"
                                    onClick={() => void patchPhoto(p.id, { preferred: !p.preferred })}
                                    title={
                                      p.preferred
                                        ? "House favourite: the AI prefers this when several photos fit"
                                        : "Star as a house favourite"
                                    }
                                    className={`${STAR_BTN} ${
                                      p.preferred ? "text-amber-500" : "text-zinc-300 hover:text-amber-400"
                                    }`}
                                  >
                                    {p.preferred ? "★" : "☆"}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={p.enabled}
                                  title={p.enabled ? "On: the AI can use this photo" : "Off: kept but not offered"}
                                  onClick={() => void patchPhoto(p.id, { enabled: !p.enabled })}
                                  className={switchCls(p.enabled)}
                                >
                                  <span className={knobCls(p.enabled)} />
                                </button>
                              </div>
                            </div>
                            <p className="mt-1.5 line-clamp-2 text-xs text-zinc-500">{p.description}</p>
                            <div className={CARD_ACTIONS}>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingBuiltinPhoto(null); // the two photo editors share drafts
                                  setEditingPhoto(p.id);
                                  setPhotoName(p.name);
                                  setPhotoDesc(p.description);
                                }}
                                className={BTN_EDIT}
                              >
                                ✎ Edit
                              </button>
                              <button type="button" onClick={() => void deletePhoto(p.id)} className={BTN_REMOVE}>
                                Remove
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                ))}

                {shownBuiltinPhotos.map((p) => {
                  const off = photoDisabled.has(p.id);
                  const displayName = photoNames[p.id]?.display_name || pretty(p.id.replace(/^photo_/, ""));
                  const displayDesc = photoNames[p.id]?.description || p.description;
                  return (
                    <div
                      key={p.id}
                      className={`overflow-hidden rounded-[4px] border bg-white ${
                        off ? "border-[#E3EDF2] opacity-60" : "border-[#C2D9E3]"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/photo-library/${p.id}.jpg`}
                        alt={displayDesc}
                        className="aspect-video w-full border-b border-[#E3EDF2] object-cover"
                        loading="lazy"
                      />
                      <div className="p-3">
                        {editingBuiltinPhoto === p.id ? (
                          <div className="space-y-2">
                            <input
                              value={photoName}
                              placeholder={pretty(p.id.replace(/^photo_/, ""))}
                              onChange={(e) => setPhotoName(e.target.value)}
                              className="w-full rounded-[4px] border border-[#C2D9E3] p-1.5 text-xs outline-none focus:border-[#3FD0C9]"
                            />
                            <textarea
                              value={photoDesc}
                              rows={2}
                              placeholder={p.description}
                              onChange={(e) => setPhotoDesc(e.target.value)}
                              className="w-full rounded-[4px] border border-[#C2D9E3] p-1.5 text-xs outline-none focus:border-[#3FD0C9]"
                            />
                            <p className="text-[11px] text-zinc-400">
                              To change the image itself, remove this photo and add a new one.
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => void saveBuiltinPhotoMeta(p.id)}
                                className="rounded-[4px] bg-[#031B34] px-3 py-1 text-xs font-semibold text-white"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingBuiltinPhoto(null)}
                                className="rounded-[4px] px-2 py-1 text-xs font-semibold text-zinc-500 hover:bg-zinc-100"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 truncate text-sm font-bold text-[#031B34]">{displayName}</div>
                              <div className="flex shrink-0 items-center gap-4">
                                {!off && photoSettingsMigrated && (
                                  <button
                                    type="button"
                                    onClick={() => void toggleBuiltinPhotoStar(p.id, !photoPreferred.has(p.id))}
                                    title={
                                      photoPreferred.has(p.id)
                                        ? "House favourite: the AI prefers this when several photos fit"
                                        : "Star as a house favourite"
                                    }
                                    className={`${STAR_BTN} ${
                                      photoPreferred.has(p.id) ? "text-amber-500" : "text-zinc-300 hover:text-amber-400"
                                    }`}
                                  >
                                    {photoPreferred.has(p.id) ? "★" : "☆"}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={!off}
                                  disabled={!photoSettingsMigrated}
                                  title={off ? "Off: the AI cannot pick this photo" : "On: available to the AI"}
                                  onClick={() => void toggleBuiltinPhoto(p.id, off)}
                                  className={switchCls(!off)}
                                >
                                  <span className={knobCls(!off)} />
                                </button>
                              </div>
                            </div>
                            <p className="mt-1.5 line-clamp-2 text-xs text-zinc-500">{displayDesc}</p>
                            {photoMetaMigrated && (
                              <div className={CARD_ACTIONS}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingPhoto(null); // the two photo editors share drafts
                                    setEditingBuiltinPhoto(p.id);
                                    setPhotoName(photoNames[p.id]?.display_name ?? "");
                                    setPhotoDesc(photoNames[p.id]?.description ?? "");
                                  }}
                                  className={BTN_EDIT}
                                >
                                  ✎ Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void removeBuiltinPhoto(p.id, displayName)}
                                  className={BTN_REMOVE}
                                >
                                  Remove
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
