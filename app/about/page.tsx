"use client";

// About — what the tool is, plus the two levers the team can pull without a developer:
//
//   1. Generation rules: free text rules injected into the deck planner's prompt on every
//      generation (high priority guidance; they can never override claim fidelity or the
//      template's character limits).
//   2. The slide layout catalog: a visual review of every layout the tool can produce (the
//      same slides as the design-review gallery decks), with an on/off switch per layout.
//      A layout turned off is removed from the planner's vocabulary entirely, so the AI
//      cannot pick it. Cover and Agenda are required by every deck and stay locked on.
//
// Both are stored in the shared database (migration 0004), so a rule or a toggle set by one
// person applies to everyone's generations. Brand-new layouts are code built (each one is a
// small rendering program), so adding one is a development task, not a switch here.

import { useCallback, useEffect, useState } from "react";
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

const LOCKED = new Set(["title", "agenda"]);
const KIND_LABEL: Record<GalleryEntry["kind"], string> = {
  synthetic: "Code built",
  template: "Template",
  verbatim: "Fixed brand slide",
};

function pretty(key: string): string {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The planner-facing usage strings are written for the AI; lightly clean them for people. */
function cleanUsage(s: string): string {
  return s.replace(/`/g, "");
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

  // ----- layouts -----
  const [layoutsMigrated, setLayoutsMigrated] = useState(true);
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [layoutError, setLayoutError] = useState("");
  const [filter, setFilter] = useState<"all" | "synthetic" | "template" | "off">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

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

  async function toggleLayout(key: string, enable: boolean) {
    setLayoutError("");
    const before = new Set(disabled);
    const next = new Set(disabled);
    if (enable) next.delete(key);
    else next.add(key);
    setDisabled(next); // optimistic — a toggle should feel instant
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

  const entries = (gallery as GalleryEntry[]).filter((g) => {
    if (filter === "all") return true;
    if (filter === "off") return disabled.has(g.key);
    return g.kind === filter;
  });
  const offCount = disabled.size;

  return (
    <div className="min-h-screen bg-[#F2F7F9]">
      <PageHero
        eyebrow="About"
        title="How the generator works, and your rules"
        actions={
          <ReviewerField value={reviewer} onChange={onReviewerChange} placeholder="Your name (recorded on changes)" />
        }
      >
        Decks are planned by AI but drawn by code on the real Superba template. Here you can review
        every slide layout the tool can produce, switch layouts on or off, and write rules that every
        future generation follows.
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
                plan: the storyline, a layout per slide, and the copy. It never chooses colours,
                fonts or positions.
              </p>
            </div>
            <div>
              <div className="font-semibold text-[#06456B]">2 · Code draws</div>
              <p className="mt-1">
                A rendering program fills the real Superba PowerPoint template with that plan, so all
                design is inherited from the brand template. Each layout below is one of those
                rendering programs.
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
            <h2 className="text-lg font-bold text-[#031B34]">Generation rules</h2>
            <span className="text-xs text-zinc-500">
              {rules.filter((r) => r.enabled).length} active · applied to every new PowerPoint deck
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            Standing instructions the AI follows on every deck it plans, for everyone using the tool.
            Write them like you would brief a colleague, e.g. &quot;Always end with a slide of open
            research questions&quot; or &quot;Never use more than one chart per section&quot;. They
            guide content and structure; the built in claim fidelity and brand rules always win.
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
                      className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
                        r.enabled ? "bg-[#3FD0C9]" : "bg-zinc-300"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                          r.enabled ? "left-[18px]" : "left-0.5"
                        }`}
                      />
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
                  placeholder='Add a rule, e.g. "Always include a slide comparing krill oil to fish oil when the source allows it"'
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

        {/* ----- layout catalog ----- */}
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold text-[#031B34]">Slide layouts the deck is built from</h2>
            <span className="text-xs text-zinc-500">
              {(gallery as GalleryEntry[]).length} layouts · {offCount} turned off
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600">
            These are real renders of every slide type the tool can produce, with example content.
            Turn a layout off and the AI can no longer pick it for any deck; turn it back on any
            time. Cover and Agenda are required by every deck and stay on. A brand new layout is a
            small rendering program, so adding one is a development request, not a switch here.
          </p>

          {!layoutsMigrated && (
            <p className="mt-4 rounded-[4px] border border-dashed border-[#C2D9E3] bg-white p-4 text-sm text-zinc-500">
              Layout switches live in the shared database and it is not ready yet: run migration
              0004_generation_rules_and_layouts.sql in the Supabase SQL editor. Until then every
              layout stays on.
            </p>
          )}
          {layoutError && <p className="mt-2 text-sm text-red-700">{layoutError}</p>}

          <div className="mt-4 flex flex-wrap gap-1.5">
            {(
              [
                ["all", "All"],
                ["synthetic", "Code built"],
                ["template", "Template"],
                ["off", `Turned off (${offCount})`],
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

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                    alt={`Example of the ${pretty(g.key)} layout`}
                    className="aspect-video w-full border-b border-[#E3EDF2] object-cover"
                    loading="lazy"
                  />
                  <div className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-[#031B34]">{pretty(g.key)}</div>
                        <div className="text-[11px] uppercase tracking-wide text-zinc-400">
                          {KIND_LABEL[g.kind]}
                          {LOCKED.has(g.key) ? " · always on" : ""}
                        </div>
                      </div>
                      {!locked && (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={!off}
                          disabled={!layoutsMigrated}
                          title={off ? "Off: the AI cannot pick this layout" : "On: available to the AI"}
                          onClick={() => void toggleLayout(g.key, off)}
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                            off ? "bg-zinc-300" : "bg-[#3FD0C9]"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                              off ? "left-0.5" : "left-[18px]"
                            }`}
                          />
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
