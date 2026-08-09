"use client";

// About — what the tool is, plus the levers the team can pull without a developer:
//
//   1. Generation rules: free text writing & design principles injected into the deck
//      planner's prompt on every generation (bullet discipline, action title style, what to
//      include or avoid). They steer the AI's writing; claim fidelity always wins.
//   2. Design settings: deterministic overrides the RENDERER enforces in code — fonts, the
//      three text sizes, line spacing, page margin and box gutter. A non-technical "use
//      Arial, tighter titles" actually happens, on every slide, every deck.
//   3. The slide library: every slide the tool can produce, in ONE combined menu (no
//      code-built vs template distinction — that is an implementation detail), each with an
//      on/off switch. Plus the team's OWN slides: upload a .pptx, pick slides from real
//      previews, and they are spliced verbatim into generated decks — either wherever the AI
//      judges they fit the storyline, or in every deck.
//
// Everything is stored in the shared database (migrations 0004 + 0005), so a rule, a design
// setting or a slide added by one person applies to everyone's generations.

import { useCallback, useEffect, useRef, useState } from "react";
import PageHero, { ReviewerField } from "../PageHero";
import gallery from "../layout-gallery.json";

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
  created_by?: string | null;
  created_at?: string;
};

type UploadPick = {
  index: number;
  preview_b64: string;
  picked: boolean;
  name: string;
  description: string;
  mode: "auto" | "always";
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
};

const LOCKED = new Set(["title", "agenda"]);
const FONT_SUGGESTIONS = ["Arial", "Calibri", "Georgia", "Montserrat", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana"];
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

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export default function AboutPage() {
  const [reviewer, setReviewer] = useState("");

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
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [layoutError, setLayoutError] = useState("");
  const [filter, setFilter] = useState<"all" | "on" | "off" | "mine">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  // ----- custom slides -----
  const [slidesMigrated, setSlidesMigrated] = useState(true);
  const [customSlides, setCustomSlides] = useState<CustomSlide[]>([]);
  const [customError, setCustomError] = useState("");
  const [editingSlide, setEditingSlide] = useState<string | null>(null);
  const [slideName, setSlideName] = useState("");
  const [slideDesc, setSlideDesc] = useState("");

  // ----- upload flow -----
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
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
      setDisabled(new Set<string>(l.disabled ?? []));
    } catch {
      setLayoutsMigrated(false);
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
    if (!window.confirm("Remove this slide from the tool? Decks already generated keep it.")) return;
    setCustomError("");
    try {
      const res = await fetch(`/api/custom-slides/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Could not remove the slide.");
      }
      setCustomSlides((s) => s.filter((x) => x.id !== id));
    } catch (e) {
      setCustomError((e as Error).message);
    }
  }

  // ---------- upload flow ----------
  async function inspectUpload(file: File) {
    setUploadError("");
    setUploadBusy(true);
    setPicks(null);
    setUploadFile(file);
    try {
      if (file.size > 4 * 1024 * 1024)
        throw new Error("Keep the file under 4 MB — save just the slides you want as a smaller .pptx first.");
      const form = new FormData();
      form.append("file", file, file.name);
      const res = await fetch("/api/custom-slides/inspect", { method: "POST", body: form });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not read the presentation.");
      setPicks(
        (d.slides ?? []).map((s: { index: number; preview_b64: string }) => ({
          index: s.index,
          preview_b64: s.preview_b64,
          picked: false,
          name: "",
          description: "",
          mode: "auto" as const,
        }))
      );
    } catch (e) {
      setUploadError((e as Error).message);
      setUploadFile(null);
    } finally {
      setUploadBusy(false);
    }
  }

  async function savePicks() {
    if (!uploadFile || !picks) return;
    const chosen = picks.filter((p) => p.picked);
    if (!chosen.length) {
      setUploadError("Tick at least one slide to add.");
      return;
    }
    if (chosen.some((p) => !p.name.trim())) {
      setUploadError("Give every ticked slide a short name.");
      return;
    }
    setSavingPicks(true);
    setUploadError("");
    try {
      const pptx_b64 = toB64(await uploadFile.arrayBuffer());
      const res = await fetch("/api/custom-slides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: uploadFile.name,
          pptx_b64,
          author: reviewer,
          slides: chosen.map((p) => ({
            slide_index: p.index,
            name: p.name,
            description: p.description,
            mode: p.mode,
            preview_b64: p.preview_b64,
          })),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save the slides.");
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

  // ---------- derived ----------
  const entries = (gallery as GalleryEntry[]).filter((g) => {
    if (filter === "mine") return false;
    if (filter === "off") return disabled.has(g.key);
    if (filter === "on") return !disabled.has(g.key) && g.kind !== "verbatim";
    return true;
  });
  const shownCustom = customSlides.filter((c) => {
    if (filter === "on") return c.mode !== "off";
    if (filter === "off") return c.mode === "off";
    return true; // all + mine
  });
  const offCount = disabled.size + customSlides.filter((c) => c.mode === "off").length;

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
          value={design[key] ?? ""}
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
    <div className="min-h-screen bg-[#F2F7F9]">
      <PageHero
        eyebrow="About"
        title="How the generator works, and your rules"
        actions={
          <ReviewerField value={reviewer} onChange={onReviewerChange} placeholder="Your name (recorded on changes)" />
        }
      >
        Decks are planned by AI but drawn by code on the real Superba template. Here you write the
        rules and design principles every deck follows, set the typography, and manage the slide
        library — including slides you add yourself.
      </PageHero>

      <main className="mx-auto max-w-5xl px-4 py-8">
        {/* ----- what the tool is ----- */}
        <section className="rounded-[4px] border border-[#C2D9E3] bg-white p-6">
          <h2 className="text-lg font-bold text-[#031B34]">What this tool is</h2>
          <div className="mt-3 grid gap-4 text-sm text-zinc-600 sm:grid-cols-3">
            <div>
              <div className="font-semibold text-[#06456B]">1 · The AI plans</div>
              <p className="mt-1">
                Claude reads your sources (studies, uploads, approved findings) and writes a slide
                plan: the storyline, a slide type per point, and the copy. Your rules below steer
                that writing.
              </p>
            </div>
            <div>
              <div className="font-semibold text-[#06456B]">2 · Code draws</div>
              <p className="mt-1">
                A rendering program fills the real Superba PowerPoint template with that plan. Your
                design settings below are enforced here, in code — fonts, sizes and spacing are
                never left to the AI.
              </p>
            </div>
            <div>
              <div className="font-semibold text-[#06456B]">3 · You review</div>
              <p className="mt-1">
                Every generated asset carries an AI disclaimer and is a draft for human review. Claim
                fidelity rules are built in and always win over anything configured on this page.
              </p>
            </div>
          </div>
        </section>

        {/* ----- generation rules ----- */}
        <section className="mt-8 rounded-[4px] border border-[#C2D9E3] bg-white p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold text-[#031B34]">Writing rules & principles</h2>
            <span className="text-xs text-zinc-500">
              {rules.filter((r) => r.enabled).length} active · applied to every new PowerPoint deck
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            Standing instructions the AI follows on every deck, for everyone using the tool. Write
            them like you would brief a colleague — content rules (&quot;Always end with open
            research questions&quot;) or writing principles (&quot;At most two sentences per bullet
            point&quot;, &quot;Action titles must state the number, not just the direction&quot;).
            For fonts, sizes and spacing, use the Design settings below instead — those are enforced
            in code, not asked of the AI.
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
        </section>

        {/* ----- design settings ----- */}
        <section className="mt-8 rounded-[4px] border border-[#C2D9E3] bg-white p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold text-[#031B34]">Design settings</h2>
            <span className="text-xs text-zinc-500">enforced in code on every generated deck</span>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            These override the brand template deterministically — no AI involved. Leave a field
            empty to keep the brand default (shown in grey). Fonts must be installed on the machines
            that open the decks; the page margin and box gutter apply to the code drawn slide types.
          </p>

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
        </section>

        {/* ----- slide library ----- */}
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold text-[#031B34]">Slide library</h2>
            <span className="text-xs text-zinc-500">
              {(gallery as GalleryEntry[]).length + customSlides.length} slides · {offCount} turned off
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            Every slide the tool can put in a deck, with real example renders. Turn a slide type off
            and the AI can no longer pick it; turn it back on any time. Add your own finished slides
            from a PowerPoint file — they are inserted exactly as designed, either where the AI
            judges they fit or in every deck. Cover and Agenda are required and stay on.
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

          {/* upload flow */}
          <div className="mt-4 rounded-[4px] border border-[#C2D9E3] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-[#031B34]">Add your own slides</div>
                <p className="text-xs text-zinc-500">
                  Upload a .pptx (under 4 MB), pick the slides you want, give each a name and a line
                  on when to use it.
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
              <p className="mt-3 text-sm text-zinc-500">
                Rendering slide previews — this can take up to half a minute for a big file…
              </p>
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
                        onClick={() =>
                          setPicks((ps) => ps!.map((x, j) => (j === i ? { ...x, picked: !x.picked } : x)))
                        }
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
                            <option value="always">In every deck</option>
                          </select>
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

          {/* filters */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {(
              [
                ["all", "All"],
                ["on", "In use"],
                ["off", `Turned off (${offCount})`],
                ["mine", `Your slides (${customSlides.length})`],
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
          </div>

          {/* the grid: custom slides first, then built-ins */}
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shownCustom.map((c) => (
              <div
                key={c.id}
                className={`overflow-hidden rounded-[4px] border bg-white ${
                  c.mode === "off" ? "border-[#E3EDF2] opacity-60" : "border-[#3FD0C9]"
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
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void patchSlide(c.id, { name: slideName, description: slideDesc });
                            setEditingSlide(null);
                          }}
                          className="rounded-[4px] bg-[#031B34] px-3 py-1 text-xs font-semibold text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingSlide(null)}
                          className="rounded-[4px] px-2 py-1 text-xs font-semibold text-zinc-500 hover:bg-zinc-100"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-[#031B34]">{c.name}</div>
                          <div className="text-[11px] uppercase tracking-wide text-[#0E7490]">Your slide</div>
                        </div>
                      </div>
                      {c.description && <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{c.description}</p>}
                      <div className="mt-2 flex items-center gap-1.5">
                        <select
                          value={c.mode}
                          onChange={(e) => void patchSlide(c.id, { mode: e.target.value })}
                          title="How this slide is used"
                          className="min-w-0 flex-1 rounded-[4px] border border-[#C2D9E3] p-1.5 text-xs outline-none"
                        >
                          {(Object.keys(MODE_LABEL) as CustomSlide["mode"][]).map((m) => (
                            <option key={m} value={m}>
                              {MODE_LABEL[m]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSlide(c.id);
                            setSlideName(c.name);
                            setSlideDesc(c.description);
                          }}
                          className="rounded-[4px] px-2 py-1 text-xs font-semibold text-[#06456B] hover:bg-[#EAF3F7]"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteSlide(c.id)}
                          className="rounded-[4px] px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                        >
                          Delete
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
              return (
                <div
                  key={g.key}
                  className={`overflow-hidden rounded-[4px] border bg-white ${
                    off ? "border-[#E3EDF2] opacity-60" : "border-[#C2D9E3]"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/layout-gallery/${g.key}.png`}
                    alt={`Example of the ${pretty(g.key)} slide`}
                    className="aspect-video w-full border-b border-[#E3EDF2] object-cover"
                    loading="lazy"
                  />
                  <div className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-[#031B34]">{pretty(g.key)}</div>
                        <div className="text-[11px] uppercase tracking-wide text-zinc-400">
                          {g.kind === "verbatim"
                            ? "Fixed brand slide"
                            : LOCKED.has(g.key)
                              ? "Always on"
                              : "Standard slide"}
                        </div>
                      </div>
                      {!locked && (
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
                      )}
                    </div>
                    <p
                      className={`mt-2 cursor-pointer text-xs text-zinc-500 ${expanded === g.key ? "" : "line-clamp-2"}`}
                      onClick={() => setExpanded(expanded === g.key ? null : g.key)}
                      title={expanded === g.key ? "Click to collapse" : "Click to read the full guidance"}
                    >
                      {cleanUsage(g.usage)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
