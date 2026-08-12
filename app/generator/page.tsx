"use client";

// Content Generator — the guided, step-by-step flow ("Option B: Guided" from the redesign pitch).
// Started life as a separate /generator-v2 page beside the original long-form page; the team
// adopted it on 2026-08-09, so it replaced the original at /generator (the old page is deleted,
// /generator-v2 redirects here — see next.config.ts).

import { useEffect, useMemo, useRef, useState } from "react";
import type { Studie } from "../studies";
import { loadOverrides, type Override } from "../summary-overrides";
import { applyStudyMeta, loadStudyMeta } from "../study-meta";
import {
  loadApprovedClaims,
  buildClaimsSourceFile,
  recordAssetClaims,
  type ApprovedClaim,
} from "../claims-source";
import { appendDeckSettings, deckGenerationSettings } from "../generation-settings";
import { PRODUCTS, type ProductId } from "../products";

const REVIEWER_KEY = "claimsReviewerName:v1";

type ContentType = "deck" | "blog" | "video" | "podcast" | "whitepaper_mix";

const CONTENT_TYPES: { id: ContentType; label: string; hint: string; available: boolean }[] = [
  { id: "deck", label: "PowerPoint deck", hint: "Branded slides", available: true },
  { id: "whitepaper_mix", label: "Whitepaper", hint: "Designed, on brand", available: true },
  { id: "blog", label: "Blog post", hint: "Grounded in science", available: true },
  { id: "video", label: "Video", hint: "Script & storyboard", available: false },
  { id: "podcast", label: "Podcast", hint: "Episode audio", available: false },
];

/** The product's brand mark, or nothing at all when we don't have the official asset yet — a
 *  stand-in shape would misrepresent the brand, so the tile falls back to its name alone. */
function ProductLogo({ product }: { product: (typeof PRODUCTS)[0] }) {
  if (!product.logo) return null;
  return <img src={product.logo} alt={product.label} className="h-8 w-8 object-contain" />;
}

function ContentTypeIcon({ type }: { type: ContentType }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8 } as const;
  if (type === "deck")
    return (
      <svg {...common} className="h-5 w-5">
        <rect x="3" y="5" width="18" height="12" rx="1.5" />
        <path d="M8 21h8M3 8h18" />
      </svg>
    );
  if (type === "whitepaper_mix")
    return (
      <svg {...common} className="h-5 w-5">
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <path d="M8 6h8M8 10h8M8 14h6" />
      </svg>
    );
  if (type === "blog")
    return (
      <svg {...common} className="h-5 w-5">
        <path d="M4 6h16M4 10h16M4 14h12M4 18h10" />
      </svg>
    );
  if (type === "video")
    return (
      <svg {...common} className="h-5 w-5">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <polygon points="9 8 9 16 16 12" fill="currentColor" />
      </svg>
    );
  return (
    <svg {...common} className="h-5 w-5">
      <circle cx="12" cy="9" r="4" />
      <path d="M4 19c0-3 2.7-6 8-6s8 3 8 6" />
    </svg>
  );
}

const TEXT_TYPES = new Set<ContentType>(["blog"]);

const LANGUAGES: { name: string; flag: string }[] = [
  { name: "English", flag: "🇬🇧" }, { name: "Norwegian", flag: "🇳🇴" }, { name: "Swedish", flag: "🇸🇪" },
  { name: "Danish", flag: "🇩🇰" }, { name: "Finnish", flag: "🇫🇮" }, { name: "Icelandic", flag: "🇮🇸" },
  { name: "German", flag: "🇩🇪" }, { name: "French", flag: "🇫🇷" }, { name: "Spanish", flag: "🇪🇸" },
  { name: "Portuguese", flag: "🇵🇹" }, { name: "Portuguese (Brazil)", flag: "🇧🇷" }, { name: "Italian", flag: "🇮🇹" },
  { name: "Dutch", flag: "🇳🇱" }, { name: "Polish", flag: "🇵🇱" }, { name: "Czech", flag: "🇨🇿" },
  { name: "Slovak", flag: "🇸🇰" }, { name: "Hungarian", flag: "🇭🇺" }, { name: "Romanian", flag: "🇷🇴" },
  { name: "Bulgarian", flag: "🇧🇬" }, { name: "Greek", flag: "🇬🇷" }, { name: "Croatian", flag: "🇭🇷" },
  { name: "Serbian", flag: "🇷🇸" }, { name: "Slovenian", flag: "🇸🇮" }, { name: "Lithuanian", flag: "🇱🇹" },
  { name: "Latvian", flag: "🇱🇻" }, { name: "Estonian", flag: "🇪🇪" }, { name: "Russian", flag: "🇷🇺" },
  { name: "Ukrainian", flag: "🇺🇦" }, { name: "Turkish", flag: "🇹🇷" }, { name: "Arabic", flag: "🇸🇦" },
  { name: "Hebrew", flag: "🇮🇱" }, { name: "Persian", flag: "🇮🇷" }, { name: "Hindi", flag: "🇮🇳" },
  { name: "Bengali", flag: "🇧🇩" }, { name: "Urdu", flag: "🇵🇰" }, { name: "Chinese (Simplified)", flag: "🇨🇳" },
  { name: "Chinese (Traditional)", flag: "🇹🇼" }, { name: "Japanese", flag: "🇯🇵" }, { name: "Korean", flag: "🇰🇷" },
  { name: "Vietnamese", flag: "🇻🇳" }, { name: "Thai", flag: "🇹🇭" }, { name: "Indonesian", flag: "🇮🇩" },
  { name: "Malay", flag: "🇲🇾" }, { name: "Filipino", flag: "🇵🇭" }, { name: "Swahili", flag: "🇰🇪" },
  { name: "Afrikaans", flag: "🇿🇦" }, { name: "Irish", flag: "🇮🇪" },
];

function flaggFor(name: string): string {
  return LANGUAGES.find((l) => l.name === name)?.flag ?? "🌐";
}

const STEPS = [
  { id: 1, eyebrow: "Step 1 of 3 · Create", title: "What are you creating?" },
  { id: 2, eyebrow: "Step 2 of 3 · Sources", title: "What should it be based on?" },
  { id: 3, eyebrow: "Step 3 of 3 · Style", title: "How should it sound?" },
] as const;

function LanguagePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const q = query.trim().toLowerCase();
  const treff = LANGUAGES.filter((l) => l.name.toLowerCase().includes(q));
  const exact = LANGUAGES.some((l) => l.name.toLowerCase() === q);

  function pick(name: string) {
    onChange(name);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-2xl border border-[#E4EDF0] bg-white px-4 py-3 text-sm text-[#052A4E] shadow-sm outline-none hover:border-[#9FC9D9] focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
      >
        <span className="flex items-center gap-2">
          <span className="text-base leading-none">{flaggFor(value)}</span>
          <span>{value || "Select language"}</span>
        </span>
        <span className="text-zinc-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-2xl border border-[#E4EDF0] bg-white shadow-lg">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search language…"
            className="w-full border-b border-[#EEF4F7] px-4 py-2.5 text-sm outline-none placeholder:text-zinc-400"
          />
          <ul className="max-h-60 overflow-y-auto py-1">
            {q && !exact && (
              <li>
                <button
                  type="button"
                  onClick={() => pick(query.trim())}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-[#EEFAF9]"
                >
                  <span className="text-base leading-none">🌐</span>
                  <span>Use “{query.trim()}”</span>
                </button>
              </li>
            )}
            {treff.map((l) => (
              <li key={l.name}>
                <button
                  type="button"
                  onClick={() => pick(l.name)}
                  className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-[#EEFAF9] ${
                    l.name === value ? "bg-[#F4FBFC] font-semibold text-[#0A7A8A]" : "text-[#052A4E]"
                  }`}
                >
                  <span className="text-base leading-none">{l.flag}</span>
                  <span>{l.name}</span>
                </button>
              </li>
            ))}
            {treff.length === 0 && !q && <li className="px-4 py-2 text-sm text-zinc-400">No languages</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function PickChip({ aktiv, onClick, children }: { aktiv: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
        aktiv ? "bg-[#0A7A8A] text-white" : "bg-white text-zinc-600 ring-1 ring-[#E4EDF0] hover:bg-[#EEFAF9]"
      }`}
    >
      {children}
    </button>
  );
}

type Kjoring = {
  type: ContentType;
  progress: number;
  step: string;
  status: "running" | "done" | "error";
  error?: string;
  downloadUrl?: string;
};

export default function ContentGenerator() {
  const [wizardStep, setWizardStep] = useState(1);

  const [produkt, setProdukt] = useState<ProductId>("superba");
  const [valgteTyper, setValgteTyper] = useState<Set<ContentType>>(new Set<ContentType>(["deck"]));
  const [filer, setFiler] = useState<File[]>([]);
  const [lengde, setLengde] = useState("standard");
  const [tone, setTone] = useState("balansert");
  const [fargeTema, setFargeTema] = useState("dark");
  const [sprak, setSprak] = useState("English");
  const [kontekst, setKontekst] = useState("");
  const [studier, setStudier] = useState<Studie[]>([]);
  const [valgteStudier, setValgteStudier] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [studieSok, setStudieSok] = useState("");
  const [studieKat, setStudieKat] = useState<string | null>(null);

  const [approvedClaims, setApprovedClaims] = useState<ApprovedClaim[]>([]);
  const [claimsConfigured, setClaimsConfigured] = useState(true);
  const [inkluderClaims, setInkluderClaims] = useState(false);
  const [claimKatFilter, setClaimKatFilter] = useState<Set<string>>(new Set());
  const [valgteFunn, setValgteFunn] = useState<Set<string>>(new Set());

  const [laster, setLaster] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [kjoringer, setKjoringer] = useState<Kjoring[]>([]);
  const [utkast, setUtkast] = useState<{ type: ContentType; markdown: string }[]>([]);
  const [lagerWord, setLagerWord] = useState(false);

  const claimKategorier = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    approvedClaims.forEach((c) => {
      const e = m.get(c.category_id) ?? { name: c.categoryName, count: 0 };
      e.count += 1;
      m.set(c.category_id, e);
    });
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [approvedClaims]);

  // The category toggle's candidates — only "in play" while the master switch is on.
  const kategoriKandidater = useMemo(
    () => (!inkluderClaims ? [] : approvedClaims.filter((c) => claimKatFilter.size === 0 || claimKatFilter.has(c.category_id))),
    [inkluderClaims, approvedClaims, claimKatFilter]
  );

  // Findings that restate ONE study's own endpoint result (scope "paper"), keyed by that study's
  // pmid — picking a study surfaces its own findings as candidates below, alongside the category
  // toggle's, in the single unified "Approved findings" picker (no separate per-study checklist).
  const funnByPmid = useMemo(() => {
    const m: Record<string, ApprovedClaim[]> = {};
    approvedClaims.forEach((c) => {
      if (c.scope === "paper" && c.pmid) (m[c.pmid] ??= []).push(c);
    });
    return m;
  }, [approvedClaims]);

  const studieKandidater = useMemo(
    () => [...valgteStudier].flatMap((pmid) => funnByPmid[pmid] ?? []),
    [valgteStudier, funnByPmid]
  );

  // Union of both sources, deduped — this is what renders as individually checkable findings.
  const kandidatFunn = useMemo(() => {
    const seen = new Set<string>();
    const out: ApprovedClaim[] = [];
    for (const c of [...studieKandidater, ...kategoriKandidater]) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }
    return out;
  }, [studieKandidater, kategoriKandidater]);

  // Auto-include a finding the moment it becomes a candidate (picking its study, or turning on/
  // widening the category filter) — but once offered, respect the user unchecking it: only an
  // outright loss of eligibility (its study gets deselected, or the category filter narrows past
  // it) removes it again, never re-adding it on some unrelated re-render.
  const tilbudtFunn = useRef<Set<string>>(new Set());
  useEffect(() => {
    const eligible = new Set(kandidatFunn.map((c) => c.id));
    // Snapshot the ref BEFORE scheduling the state update: the updater below runs after this
    // effect body finishes (not synchronously at the setValgteFunn call), so if we mutated
    // tilbudtFunn.current first, the updater would read the ALREADY-updated value and think
    // every id had already been offered — silently skipping the auto-include entirely.
    const forhandsTilbudt = tilbudtFunn.current;
    setValgteFunn((prev) => {
      const next = new Set([...prev].filter((id) => eligible.has(id)));
      for (const id of eligible) {
        if (!forhandsTilbudt.has(id)) next.add(id);
      }
      return next;
    });
    tilbudtFunn.current = eligible;
  }, [kandidatFunn]);

  function toggleFunn(id: string) {
    setValgteFunn((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    setKjoringer([]);
  }

  const studieKategorier = useMemo(() => {
    const m = new Map<string, number>();
    studier.forEach((s) => s.kategori.forEach((k) => m.set(k, (m.get(k) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [studier]);

  const filtrerteStudier = useMemo(() => {
    const q = studieSok.toLowerCase().trim();
    return studier.filter(
      (s) =>
        (!studieKat || s.kategori.includes(studieKat)) &&
        (!q || s.tittel.toLowerCase().includes(q) || s.forfattere.toLowerCase().includes(q) || s.tidsskrift.toLowerCase().includes(q))
    );
  }, [studier, studieSok, studieKat]);

  useEffect(() => {
    void loadOverrides().then(setOverrides);
    // Same overlay as V1: the picker's categories follow the reviewer edits on the studies page.
    void Promise.all([
      fetch("/api/studies").then((r) => (r.ok ? r.json() : [])),
      loadStudyMeta(),
    ])
      .then(([d, meta]) =>
        setStudier(
          applyStudyMeta(Array.isArray(d) ? d.filter((s: Studie) => s.summary) : [], meta).filter(
            (s) => !s.removed
          )
        )
      )
      .catch(() => setStudier([]));
    void loadApprovedClaims().then((res) => {
      setClaimsConfigured(res.configured);
      setApprovedClaims(res.claims);
    });
  }, []);

  const valgteTilgjengelige = CONTENT_TYPES.filter((t) => valgteTyper.has(t.id) && t.available);
  const harValgt = valgteTilgjengelige.length > 0;
  const visDeckOpsjoner = valgteTyper.has("deck");
  const harKilder = filer.length > 0 || valgteStudier.size > 0 || valgteFunn.size > 0;

  function toggleType(t: ContentType) {
    const meta = CONTENT_TYPES.find((x) => x.id === t)!;
    if (!meta.available) return;
    setValgteTyper((prev) => {
      const n = new Set(prev);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });
    setFeil(null);
    setKjoringer([]);
  }

  function toggleStudie(pmid: string) {
    setValgteStudier((prev) => {
      const n = new Set(prev);
      n.has(pmid) ? n.delete(pmid) : n.add(pmid);
      return n;
    });
    setKjoringer([]);
  }

  function toggleClaimKat(id: string) {
    setClaimKatFilter((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    setKjoringer([]);
  }

  function leggTilFiler(nye: FileList | null) {
    if (!nye) return;
    setFiler((f) => [...f, ...Array.from(nye)]);
    setKjoringer([]);
    setFeil(null);
  }

  function fjern(i: number) {
    setFiler((f) => f.filter((_, idx) => idx !== i));
  }

  const sov = (ms: number) => new Promise((r) => setTimeout(r, ms));

  function oppdaterKjoring(type: ContentType, patch: Partial<Kjoring>) {
    setKjoringer((prev) => prev.map((k) => (k.type === type ? { ...k, ...patch } : k)));
  }

  function byggKilder(): { files: File[]; claimIds: string[]; studyMeta: { pmid: string; cite: string }[] } {
    const kilder = [...filer];
    let claimIds: string[] = [];
    // valgteFunn is the single unified selection now — whatever's individually checked in the
    // "Approved findings" picker, whether it got there via a study pick or the category toggle.
    const funnValgt = approvedClaims.filter((c) => valgteFunn.has(c.id));
    const claimsKilde = buildClaimsSourceFile(funnValgt);
    if (claimsKilde) {
      kilder.push(claimsKilde.file);
      claimIds = claimsKilde.claimIds;
    }
    const valgte = studier.filter((s) => valgteStudier.has(s.pmid));
    let studyMeta: { pmid: string; cite: string }[] = [];
    if (valgte.length) {
      studyMeta = valgte.map((s) => ({
        pmid: s.pmid,
        cite: `${s.forfattere}${s.flereForfattere ? " et al." : ""} · ${s.tidsskrift} ${s.ar}`,
      }));
      const tekst = valgte
        .map((s) => {
          const sum = overrides[s.pmid]?.summary ?? s.summary;
          const cite = `${s.forfattere}${s.flereForfattere ? " et al." : ""} · ${s.tidsskrift} ${s.ar}`;
          return (
            `# ${s.tittel}\n${cite}\n${s.akerNote ? `(${s.akerNote})\n` : ""}` +
            (sum
              ? `\nBackground & rationale: ${sum.background}\nDesign & participants: ${sum.design}\n` +
                `Key findings: ${sum.findings}\nLimitations & quality: ${sum.limitations}\n`
              : "")
          );
        })
        .join("\n\n---\n\n");
      kilder.push(new File([`Selected Aker BioMarine scientific studies\n\n${tekst}`], "Selected-scientific-studies.txt", { type: "text/plain" }));
    }
    return { files: kilder, claimIds, studyMeta };
  }

  async function kjorEn(type: ContentType, kilder: File[], claimIds: string[], studyMeta: { pmid: string; cite: string }[]) {
    try {
      const form = new FormData();
      kilder.forEach((f) => form.append("filer", f));
      form.append("lengde", lengde);
      form.append("tone", tone);
      form.append("sprak", sprak.trim() || "English");
      form.append("instruksjoner", kontekst.trim());
      form.append("innholdstype", type);
      if (type === "deck") form.append("color_theme", fargeTema);
      if (type === "deck" && studyMeta.length) form.append("study_meta", JSON.stringify(studyMeta));
      // The About page's rules, design settings, layout switches and team slides govern deck
      // planning/rendering only.
      if (type === "deck") {
        appendDeckSettings(form, await deckGenerationSettings());
      }

      const start = await fetch("/api/generate-deck", { method: "POST", body: form });
      const startData = await start.json().catch(() => ({}));
      if (!start.ok || !startData.job_id) throw new Error(startData.feil || `Server responded ${start.status}`);
      const jobId = startData.job_id as string;

      for (;;) {
        await sov(1500);
        const res = await fetch(`/api/generate-deck?id=${jobId}`);
        const s = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(s.feil || `Server responded ${res.status}`);
        oppdaterKjoring(type, { progress: s.progress ?? 0, step: s.step || "Working…" });
        if (s.status === "done") break;
        if (s.status === "error") throw new Error(s.error || "Generation failed");
      }

      if (TEXT_TYPES.has(type)) {
        oppdaterKjoring(type, { step: "Writing the draft…" });
        const dl = await fetch(`/api/generate-deck?id=${jobId}&download=1`);
        if (!dl.ok) {
          const d = await dl.json().catch(() => ({}));
          throw new Error(d.feil || `Server responded ${dl.status}`);
        }
        const md = await dl.text();
        setUtkast((prev) => [...prev.filter((u) => u.type !== type), { type, markdown: md }]);
        oppdaterKjoring(type, { status: "done", progress: 100, step: "Done" });
      } else {
        oppdaterKjoring(type, { status: "done", progress: 100, step: "Done", downloadUrl: `/api/generate-deck?id=${jobId}&download=1` });
      }

      if (claimIds.length && (type === "deck" || type === "blog" || type === "whitepaper_mix")) {
        const reviewer = typeof window !== "undefined" ? window.localStorage.getItem(REVIEWER_KEY) || undefined : undefined;
        void recordAssetClaims(type, claimIds, { title: `${type} · ${new Date().toISOString().slice(0, 10)}`, createdBy: reviewer });
      }
    } catch (e) {
      oppdaterKjoring(type, { status: "error", step: "Failed", error: (e as Error).message });
    }
  }

  async function produser() {
    const typer = valgteTilgjengelige.map((t) => t.id);
    if (typer.length === 0) {
      setFeil("Pick at least one thing to create.");
      return;
    }
    if (!harKilder) {
      setFeil("Add at least one source file, pick a study, or include approved findings to base the content on.");
      return;
    }
    setLaster(true);
    setFeil(null);
    setUtkast([]);
    setKjoringer(typer.map((type) => ({ type, progress: 0, step: "Starting…", status: "running" })));
    const { files, claimIds, studyMeta } = byggKilder();
    await Promise.all(typer.map((type) => kjorEn(type, files, claimIds, studyMeta)));
    setLaster(false);
  }

  async function lastNedWord(markdown: string, base: string) {
    if (!markdown) return;
    setLagerWord(true);
    setFeil(null);
    try {
      const res = await fetch("/api/blog-docx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown, filename: base }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.feil || `Server responded ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setFeil("Could not create the Word file: " + (e as Error).message);
    } finally {
      setLagerWord(false);
    }
  }

  function goNext() {
    if (wizardStep === 1 && !harValgt) {
      setFeil("Pick at least one thing to create.");
      return;
    }
    if (wizardStep === 2 && !harKilder) {
      setFeil("Add at least one source file, pick a study, or include approved findings.");
      return;
    }
    setFeil(null);
    setWizardStep((s) => Math.min(3, s + 1));
  }

  function goBack() {
    setFeil(null);
    setWizardStep((s) => Math.max(1, s - 1));
  }

  const current = STEPS[wizardStep - 1];

  return (
    <div className="min-h-screen bg-[#FAFCFD]">
      <div className="mx-auto max-w-2xl px-5 py-10">
        {/* Compact wizard header — deliberately NOT the full PageHero banner every other page
            uses: the point of this layout is fewer things competing for attention per screen. */}
        <div className="mb-7 flex items-center justify-between">
          <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#6D8894]">
            Content Generator
          </span>
          <span className="rounded-full bg-[#EEFAF9] px-3 py-1 text-[11px] font-semibold text-[#0A7A8A]">Guided mode</span>
        </div>

        <div className="mb-8 flex gap-1.5" role="progressbar" aria-valuenow={wizardStep} aria-valuemin={1} aria-valuemax={3}>
          {STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={s.id > wizardStep}
              onClick={() => s.id <= wizardStep && setWizardStep(s.id)}
              aria-label={`${s.title}${s.id === wizardStep ? " (current step)" : ""}`}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                s.id < wizardStep ? "bg-[#1B7A3D]" : s.id === wizardStep ? "bg-[#0A7A8A]" : "bg-[#E4EDF0]"
              } ${s.id <= wizardStep ? "cursor-pointer" : "cursor-default"}`}
            />
          ))}
        </div>

        <div className="mb-1 text-[12.5px] font-bold uppercase tracking-[0.06em] text-[#0A7A8A]">{current.eyebrow}</div>
        <h1 className="mb-8 text-[26px] font-extrabold leading-tight tracking-tight text-[#052A4E]">{current.title}</h1>

        {/* ============================= STEP 1 ============================= */}
        {wizardStep === 1 && (
          <div className="space-y-8">
            <div>
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6D8894]">Which product is this for?</div>
              <div className="grid grid-cols-4 gap-2">
                {PRODUCTS.map((p) => {
                  const valgt = produkt === p.id && p.available;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => p.available && setProdukt(p.id)}
                      disabled={!p.available}
                      className={`relative rounded-2xl border p-4 text-center transition-colors ${
                        valgt ? "border-[#3FD0C9] bg-[#EEFAF9]" : "border-[#E4EDF0] bg-white hover:border-[#9FC9D9]"
                      } ${!p.available ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      {!p.available && <span className="absolute right-2 top-2 rounded-md bg-[#F1F5F7] px-1.5 py-0.5 text-[9px] font-semibold uppercase text-[#8FA5AE]">Soon</span>}
                      {p.logo && (
                        <div className="mb-2 flex justify-center">
                          <ProductLogo product={p} />
                        </div>
                      )}
                      <div className="text-sm font-semibold text-[#052A4E]">{p.label}</div>
                      {p.hint && <div className="text-xs text-zinc-500">{p.hint}</div>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6D8894]">
                What do you want to create? <span className="normal-case tracking-normal text-zinc-400">(pick one or several)</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {CONTENT_TYPES.map((t) => {
                  const valgt = valgteTyper.has(t.id) && t.available;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleType(t.id)}
                      disabled={!t.available}
                      className={`relative flex items-center gap-3 rounded-2xl border p-4 text-left transition-colors ${
                        valgt ? "border-[#3FD0C9] bg-[#EEFAF9] shadow-[0_0_0_3px_rgba(63,208,201,0.14)]" : "border-[#E4EDF0] bg-white hover:border-[#9FC9D9]"
                      } ${!t.available ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      <ContentTypeIcon type={t.id} />
                      <span>
                        <span className="block text-sm font-bold text-[#052A4E]">{t.label}</span>
                        <span className="block text-[11px] text-zinc-500">{t.available ? t.hint : "Soon"}</span>
                      </span>
                      {valgt && <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[#0A7A8A] text-[11px] font-bold text-white">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ============================= STEP 2 ============================= */}
        {wizardStep === 2 && (
          <div className="space-y-6">
            <p className="text-[14px] leading-relaxed text-[#5C7A85]">
              You&apos;re creating <strong className="text-[#052A4E]">{valgteTilgjengelige.map((t) => t.label.toLowerCase()).join(" + ") || "…"}</strong>. Now pick the material it should draw on — upload files, choose from the study library, or both.
            </p>

            <div className="rounded-2xl border border-[#E4EDF0] bg-white p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6D8894]">Or pick from Scientific Studies</div>
                {valgteStudier.size > 0 && (
                  <span className="rounded-full bg-[#EEFAF9] px-2.5 py-0.5 text-xs font-bold text-[#0A7A8A]">
                    {valgteStudier.size} selected{valgteFunn.size > 0 && ` · ${valgteFunn.size} finding${valgteFunn.size === 1 ? "" : "s"}`}
                  </span>
                )}
              </div>
              {studier.length === 0 ? (
                <p className="text-xs text-zinc-400">Loading studies…</p>
              ) : (
                <>
                  <input
                    type="text"
                    value={studieSok}
                    onChange={(e) => setStudieSok(e.target.value)}
                    placeholder="Search studies…"
                    className="mb-2 w-full rounded-xl border border-[#E4EDF0] bg-white px-3 py-2 text-sm outline-none focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
                  />
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    <PickChip aktiv={studieKat === null} onClick={() => setStudieKat(null)}>All ({studier.length})</PickChip>
                    {studieKategorier.map(([navn, antall]) => (
                      <PickChip key={navn} aktiv={studieKat === navn} onClick={() => setStudieKat(navn)}>{navn} ({antall})</PickChip>
                    ))}
                  </div>
                  <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                    {filtrerteStudier.length === 0 ? (
                      <p className="py-4 text-center text-xs text-zinc-400">No studies match.</p>
                    ) : (
                      filtrerteStudier.map((s) => {
                        const valgt = valgteStudier.has(s.pmid);
                        const verified = !!overrides[s.pmid] || s.verified;
                        const funn = funnByPmid[s.pmid] ?? [];
                        return (
                          <div key={s.pmid}>
                            <label
                              className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 text-sm transition-colors ${
                                valgt ? "border-[#3FD0C9] bg-[#F4FBFC]" : "border-[#E9F1F4] hover:bg-[#F7FBFC]"
                              }`}
                            >
                              <input type="checkbox" checked={valgt} onChange={() => toggleStudie(s.pmid)} className="mt-1 h-4 w-4 accent-[#0A7A8A]" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium text-[#052A4E]">{s.tittel}</span>
                                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                                  {verified ? (
                                    <span className="rounded-md bg-[#DFF3E4] px-1.5 py-0.5 font-bold uppercase text-[#1B7A3D]">Verified</span>
                                  ) : (
                                    <span className="rounded-md bg-[#EEE7D6] px-1.5 py-0.5 font-bold uppercase text-[#8A6A2B]">AI</span>
                                  )}
                                  {s.quality && <span className="text-zinc-400">Quality {s.quality.score}%</span>}
                                  <span className="text-zinc-400">{s.ar}</span>
                                </span>
                              </span>
                            </label>
                            {valgt && funn.length > 0 && (
                              <p className="ml-6 mt-1 text-[10.5px] font-semibold text-[#0A7A8A]">
                                {funn.length} approved finding{funn.length === 1 ? "" : "s"} for this study — added to
                                Approved findings below
                              </p>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="rounded-2xl border border-[#E4EDF0] bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0A7A8A]">✓ Approved findings</div>
                  <p className="mt-1 max-w-sm text-xs text-zinc-500">
                    {claimsConfigured
                      ? "Facts reviewed and approved by the science team. Picking a study above adds its own findings here automatically."
                      : "The findings library is not set up yet."}
                  </p>
                </div>
                {claimsConfigured && approvedClaims.length > 0 && (
                  <label className="flex shrink-0 items-center gap-2 text-sm font-semibold text-[#052A4E]">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#0A7A8A]"
                      checked={inkluderClaims}
                      onChange={(e) => {
                        setInkluderClaims(e.target.checked);
                        setKjoringer([]);
                      }}
                    />
                    Browse all ({approvedClaims.length})
                  </label>
                )}
              </div>
              {inkluderClaims && approvedClaims.length > 0 && (
                <div className="mb-2 mt-3 flex flex-wrap gap-2">
                  <PickChip aktiv={claimKatFilter.size === 0} onClick={() => { setClaimKatFilter(new Set()); setKjoringer([]); }}>All ({approvedClaims.length})</PickChip>
                  {claimKategorier.map(([id, { name, count }]) => (
                    <PickChip key={id} aktiv={claimKatFilter.has(id)} onClick={() => toggleClaimKat(id)}>{name} ({count})</PickChip>
                  ))}
                </div>
              )}
              {kandidatFunn.length > 0 ? (
                <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {kandidatFunn.map((c) => (
                    <label
                      key={c.id}
                      className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2.5 text-xs transition-colors ${
                        valgteFunn.has(c.id) ? "border-[#3FD0C9] bg-[#F4FBFC]" : "border-[#E9F1F4] hover:bg-[#F7FBFC]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={valgteFunn.has(c.id)}
                        onChange={() => toggleFunn(c.id)}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#0A7A8A]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[#052A4E]">{c.text}</span>
                        <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                          {c.categoryName}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-zinc-400">
                  Pick a study above, or check &quot;Browse all&quot; to include findings by category — either way,
                  they&apos;ll show up here to review and toggle individually.
                </p>
              )}
              {valgteFunn.size > 0 && (
                <p className="mt-2 text-xs font-semibold text-[#0A7A8A]">
                  {valgteFunn.size} finding{valgteFunn.size === 1 ? "" : "s"} will be cited in the output.
                </p>
              )}
            </div>

            <label className="block cursor-pointer rounded-2xl border-2 border-dashed border-[#B9D8E0] bg-white p-7 text-center transition-colors hover:border-[#3FD0C9] hover:bg-[#EEFAF9]">
              <input type="file" accept=".docx,.pptx,.txt,.md" multiple className="hidden" onChange={(e) => leggTilFiler(e.target.files)} />
              <div className="text-3xl">📄</div>
              <div className="mt-2 text-sm font-bold text-[#052A4E]">Click to add source files</div>
              <div className="mt-1 text-xs text-zinc-500">.docx, .pptx, .txt or .md · you can add several · an existing PowerPoint is remade as a new on brand deck</div>
            </label>

            {filer.length > 0 && (
              <ul className="space-y-2">
                {filer.map((f, i) => (
                  <li key={i} className="flex items-center justify-between rounded-xl border border-[#E4EDF0] bg-white px-4 py-2 text-sm">
                    <span className="truncate text-[#052A4E]">📎 {f.name}</span>
                    <button onClick={() => fjern(i)} className="ml-3 shrink-0 text-xs font-medium text-zinc-400 hover:text-red-500">Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ============================= STEP 3 ============================= */}
        {wizardStep === 3 && (
          <div className="space-y-6">
            {visDeckOpsjoner && (
              <div className="rounded-2xl border border-[#E4EDF0] bg-white p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#0A7A8A]">📊 PowerPoint deck settings</div>
                <p className="mt-0.5 text-xs text-zinc-500">These apply to the deck only.</p>
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6D8894]">Length</div>
                    <div className="flex rounded-full border border-[#E4EDF0] p-1">
                      {[["kort", "Short", "~9 slides"], ["standard", "Standard", "~15 slides"], ["detaljert", "Detailed", "~19 slides"]].map(([val, label, hint]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setLengde(val)}
                          className={`flex-1 rounded-full px-3 py-2 text-center transition-colors ${lengde === val ? "bg-[#052A4E] text-white" : "text-[#5C7A85]"}`}
                        >
                          <div className="text-[13px] font-bold">{label}</div>
                          <div className={`text-[11px] ${lengde === val ? "text-[#BFE3EF]" : "text-[#95AAB1]"}`}>{hint}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6D8894]">Tone</div>
                    <div className="flex rounded-full border border-[#E4EDF0] p-1">
                      {[["salg", "Sales"], ["balansert", "Balanced"], ["vitenskap", "Scientific"]].map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setTone(val)}
                          className={`flex-1 rounded-full px-3 py-2 text-[13px] font-bold transition-colors ${tone === val ? "bg-[#052A4E] text-white" : "text-[#5C7A85]"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6D8894]">Color theme</div>
                    <div className="flex rounded-full border border-[#E4EDF0] p-1">
                      {[
                        ["dark", "Blue Ocean", "linear-gradient(135deg, #163536, #003462)", "text-white"],
                        ["pastel", "Pastel Blue", "#A9DBD5", "text-[#052A4E]"],
                        ["light", "White", "#FFFFFF", "text-[#052A4E] shadow-[inset_0_0_0_1px_#E3EDF2]"],
                      ].map(([val, label, swatch, activeText]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setFargeTema(val)}
                          style={fargeTema === val ? { background: swatch } : undefined}
                          className={`flex-1 rounded-full px-3 py-2 text-[13px] font-bold transition-colors ${
                            fargeTema === val ? activeText : "text-[#5C7A85]"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-xs text-zinc-500">
                      Forces every slide in the deck to this one background theme.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6D8894]">Output language</div>
              <LanguagePicker value={sprak} onChange={setSprak} />
              <p className="mt-1.5 text-xs text-zinc-500">Search and pick a language, or type your own — applies to everything you create.</p>
            </div>

            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6D8894]">Context &amp; instructions <span className="normal-case tracking-normal text-zinc-400">(optional)</span></div>
              <textarea
                value={kontekst}
                onChange={(e) => setKontekst(e.target.value)}
                rows={4}
                placeholder="e.g. Audience is pharmacy buyers in Germany; lead with the Omega 3 Index data; keep it to the joint health story."
                className="w-full resize-y rounded-2xl border border-[#E4EDF0] bg-white p-3.5 text-sm text-[#052A4E] shadow-sm outline-none placeholder:text-zinc-400 focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
              />
            </div>

            <button
              onClick={produser}
              disabled={laster || !harValgt || !harKilder}
              className="w-full rounded-full bg-[#E30917] py-4 text-base font-bold text-white shadow-sm transition-colors hover:bg-[#C40813] disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              {laster ? "AI is working…" : `Generate ${valgteTilgjengelige.map((t) => t.label.toLowerCase()).join(" + ") || ""}`}
            </button>

            {kjoringer.length > 0 && (
              <div className="space-y-3">
                {kjoringer.map((k) => {
                  const meta = CONTENT_TYPES.find((t) => t.id === k.type)!;
                  return (
                    <div key={k.type} className="rounded-2xl border border-[#E4EDF0] bg-white p-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 font-medium text-[#052A4E]"><ContentTypeIcon type={k.type} /> {meta.label}</span>
                        <span className="tabular-nums text-[#6D8894]">{k.status === "running" ? `${k.progress}%` : k.status === "done" ? "✅" : "⚠️"}</span>
                      </div>
                      {k.status === "running" && (
                        <>
                          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#EEF3F5]">
                            <div className="h-full rounded-full bg-[#E30917] transition-all duration-700 ease-out" style={{ width: `${Math.max(3, k.progress)}%` }} />
                          </div>
                          <p className="mt-2 text-xs text-zinc-500">{k.step || "Working…"}</p>
                        </>
                      )}
                      {k.status === "done" && TEXT_TYPES.has(k.type) && <p className="mt-1 text-xs text-emerald-700">✅ Draft ready. Review &amp; edit below.</p>}
                      {k.status === "done" && !TEXT_TYPES.has(k.type) && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <span className="text-emerald-700">✅ Ready.</span>
                          {k.downloadUrl && (
                            <a href={k.downloadUrl} target="_blank" rel="noopener" className="font-semibold text-[#0A7A8A] underline hover:text-[#086472]">📥 Open {meta.label}</a>
                          )}
                        </div>
                      )}
                      {k.status === "error" && <p className="mt-1 text-xs text-red-600">{k.error}</p>}
                    </div>
                  );
                })}
              </div>
            )}

            {utkast.map((u) => {
              const label = CONTENT_TYPES.find((t) => t.id === u.type)?.label ?? "Draft";
              const base = "superba-blog-draft";
              return (
                <div key={u.type} className="rounded-2xl border border-[#E4EDF0] bg-white p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6D8894]">{label} draft · review &amp; edit</div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => navigator.clipboard?.writeText(u.markdown)} className="rounded-xl border border-[#E4EDF0] bg-white px-3 py-1.5 text-xs font-semibold text-[#0A7A8A] hover:bg-[#EEFAF9]">Copy</button>
                      <button type="button" onClick={() => lastNedWord(u.markdown, base)} disabled={lagerWord} className="rounded-xl bg-[#0A7A8A] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#086472] disabled:cursor-not-allowed disabled:bg-zinc-300">
                        {lagerWord ? "Creating…" : "Download Word (.docx)"}
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={u.markdown}
                    onChange={(e) => setUtkast((prev) => prev.map((x) => (x.type === u.type ? { ...x, markdown: e.target.value } : x)))}
                    className="h-[24rem] w-full resize-y rounded-xl border border-[#E4EDF0] bg-[#FAFDFE] p-3 font-mono text-xs leading-relaxed text-[#052A4E] outline-none focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
                  />
                </div>
              );
            })}
          </div>
        )}

        {feil && (
          <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{feil}</div>
        )}

        {/* Nav footer */}
        <div className="mt-9 flex items-center justify-between border-t border-[#E4EDF0] pt-6">
          {wizardStep > 1 ? (
            <button onClick={goBack} className="text-sm font-semibold text-[#6D8894] hover:text-[#052A4E]">← Back</button>
          ) : (
            <span />
          )}
          {wizardStep < 3 && (
            <button onClick={goNext} className="rounded-full bg-[#052A4E] px-7 py-3 text-sm font-bold text-white transition-colors hover:bg-[#0a3a63]">
              Continue →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
