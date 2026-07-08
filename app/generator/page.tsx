"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Studie } from "../wiki";
import { loadOverrides, type Override } from "../summary-overrides";
import {
  loadApprovedClaims,
  buildClaimsSourceFile,
  recordAssetClaims,
  type ApprovedClaim,
} from "../claims-source";

const REVIEWER_KEY = "claimsReviewerName:v1";

type ProductId = "superba" | "lysoveta" | "revervia";

const PRODUCTS: { id: ProductId; label: string; hint: string; available: boolean }[] = [
  { id: "superba", label: "Superba", hint: "Krill oil", available: true },
  { id: "lysoveta", label: "Lysoveta", hint: "", available: false },
  { id: "revervia", label: "Revervia", hint: "", available: false },
];

type ContentType = "deck" | "blog" | "video" | "podcast" | "whitepaper";

const CONTENT_TYPES: {
  id: ContentType;
  label: string;
  icon: string;
  hint: string;
  available: boolean;
}[] = [
  { id: "deck", label: "PowerPoint deck", icon: "📊", hint: "Branded slides", available: true },
  { id: "blog", label: "Blog post", icon: "✍️", hint: "Grounded in science", available: true },
  { id: "video", label: "Video", icon: "🎬", hint: "Script & storyboard", available: false },
  { id: "podcast", label: "Podcast", icon: "🎙️", hint: "Episode audio", available: false },
  { id: "whitepaper", label: "Whitepaper", icon: "📄", hint: "Clinical long-form", available: true },
];

// Content types whose result is a Markdown draft (shown in an editable panel + Word download),
// as opposed to a binary file (the deck) that downloads directly.
const TEXT_TYPES = new Set<ContentType>(["blog", "whitepaper"]);

// Languages with the flag of the main country that speaks them. Not exhaustive — the picker
// also lets you type any language in the world (a custom entry appears when nothing matches).
const LANGUAGES: { name: string; flag: string }[] = [
  { name: "English", flag: "🇬🇧" },
  { name: "Norwegian", flag: "🇳🇴" },
  { name: "Swedish", flag: "🇸🇪" },
  { name: "Danish", flag: "🇩🇰" },
  { name: "Finnish", flag: "🇫🇮" },
  { name: "Icelandic", flag: "🇮🇸" },
  { name: "German", flag: "🇩🇪" },
  { name: "French", flag: "🇫🇷" },
  { name: "Spanish", flag: "🇪🇸" },
  { name: "Portuguese", flag: "🇵🇹" },
  { name: "Portuguese (Brazil)", flag: "🇧🇷" },
  { name: "Italian", flag: "🇮🇹" },
  { name: "Dutch", flag: "🇳🇱" },
  { name: "Polish", flag: "🇵🇱" },
  { name: "Czech", flag: "🇨🇿" },
  { name: "Slovak", flag: "🇸🇰" },
  { name: "Hungarian", flag: "🇭🇺" },
  { name: "Romanian", flag: "🇷🇴" },
  { name: "Bulgarian", flag: "🇧🇬" },
  { name: "Greek", flag: "🇬🇷" },
  { name: "Croatian", flag: "🇭🇷" },
  { name: "Serbian", flag: "🇷🇸" },
  { name: "Slovenian", flag: "🇸🇮" },
  { name: "Lithuanian", flag: "🇱🇹" },
  { name: "Latvian", flag: "🇱🇻" },
  { name: "Estonian", flag: "🇪🇪" },
  { name: "Russian", flag: "🇷🇺" },
  { name: "Ukrainian", flag: "🇺🇦" },
  { name: "Turkish", flag: "🇹🇷" },
  { name: "Arabic", flag: "🇸🇦" },
  { name: "Hebrew", flag: "🇮🇱" },
  { name: "Persian", flag: "🇮🇷" },
  { name: "Hindi", flag: "🇮🇳" },
  { name: "Bengali", flag: "🇧🇩" },
  { name: "Urdu", flag: "🇵🇰" },
  { name: "Chinese (Simplified)", flag: "🇨🇳" },
  { name: "Chinese (Traditional)", flag: "🇹🇼" },
  { name: "Japanese", flag: "🇯🇵" },
  { name: "Korean", flag: "🇰🇷" },
  { name: "Vietnamese", flag: "🇻🇳" },
  { name: "Thai", flag: "🇹🇭" },
  { name: "Indonesian", flag: "🇮🇩" },
  { name: "Malay", flag: "🇲🇾" },
  { name: "Filipino", flag: "🇵🇭" },
  { name: "Swahili", flag: "🇰🇪" },
  { name: "Afrikaans", flag: "🇿🇦" },
  { name: "Irish", flag: "🇮🇪" },
];

function flaggFor(name: string): string {
  return LANGUAGES.find((l) => l.name === name)?.flag ?? "🌐";
}

function LanguagePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
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
        className="flex w-full items-center justify-between rounded-xl border border-[#D6E6EE] bg-white px-3 py-2 text-sm text-[#052A4E] shadow-sm outline-none hover:border-[#9FC9D9] focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
      >
        <span className="flex items-center gap-2">
          <span className="text-base leading-none">{flaggFor(value)}</span>
          <span>{value || "Select language"}</span>
        </span>
        <span className="text-zinc-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-[#D6E6EE] bg-white shadow-lg">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search language…"
            className="w-full border-b border-[#EEF4F7] px-3 py-2 text-sm outline-none placeholder:text-zinc-400"
          />
          <ul className="max-h-60 overflow-y-auto py-1">
            {q && !exact && (
              <li>
                <button
                  type="button"
                  onClick={() => pick(query.trim())}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#E1F4F3]"
                >
                  <span className="text-base leading-none">🌐</span>
                  <span>
                    Use “{query.trim()}”
                  </span>
                </button>
              </li>
            )}
            {treff.map((l) => (
              <li key={l.name}>
                <button
                  type="button"
                  onClick={() => pick(l.name)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#E1F4F3] ${
                    l.name === value ? "bg-[#F4FBFC] font-semibold text-[#0A7A8A]" : "text-[#052A4E]"
                  }`}
                >
                  <span className="text-base leading-none">{l.flag}</span>
                  <span>{l.name}</span>
                </button>
              </li>
            ))}
            {treff.length === 0 && !q && (
              <li className="px-3 py-2 text-sm text-zinc-400">No languages</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function PickChip({
  aktiv,
  onClick,
  children,
}: {
  aktiv: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
        aktiv ? "bg-[#0A7A8A] text-white" : "bg-white text-zinc-600 ring-1 ring-[#D6E6EE] hover:bg-[#E1F4F3]"
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
};

export default function ContentGenerator() {
  const [produkt, setProdukt] = useState<ProductId>("superba");
  const [valgteTyper, setValgteTyper] = useState<Set<ContentType>>(new Set<ContentType>(["deck"]));
  const [filer, setFiler] = useState<File[]>([]);
  const [lengde, setLengde] = useState("standard");
  const [tone, setTone] = useState("balansert");
  const [sprak, setSprak] = useState("English");
  const [kontekst, setKontekst] = useState("");
  const [studier, setStudier] = useState<Studie[]>([]);
  const [valgteStudier, setValgteStudier] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [studieSok, setStudieSok] = useState("");
  const [studieKat, setStudieKat] = useState<string | null>(null);

  // Phase 2 — approved-claims source. `inkluderClaims` toggles the block on; an empty
  // `claimKatFilter` means "all approved claims", otherwise it narrows to the ticked categories.
  const [approvedClaims, setApprovedClaims] = useState<ApprovedClaim[]>([]);
  const [claimsConfigured, setClaimsConfigured] = useState(true);
  const [inkluderClaims, setInkluderClaims] = useState(false);
  const [claimKatFilter, setClaimKatFilter] = useState<Set<string>>(new Set());

  const claimKategorier = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    approvedClaims.forEach((c) => {
      const e = m.get(c.category_id) ?? { name: c.categoryName, count: 0 };
      e.count += 1;
      m.set(c.category_id, e);
    });
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [approvedClaims]);

  const inkluderteClaims = useMemo(
    () =>
      !inkluderClaims
        ? []
        : approvedClaims.filter(
            (c) => claimKatFilter.size === 0 || claimKatFilter.has(c.category_id)
          ),
    [inkluderClaims, approvedClaims, claimKatFilter]
  );

  const studieKategorier = useMemo(() => {
    const m = new Map<string, number>();
    studier.forEach((s) => m.set(s.kategori, (m.get(s.kategori) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [studier]);

  const filtrerteStudier = useMemo(() => {
    const q = studieSok.toLowerCase().trim();
    return studier.filter(
      (s) =>
        (!studieKat || s.kategori === studieKat) &&
        (!q ||
          s.tittel.toLowerCase().includes(q) ||
          s.forfattere.toLowerCase().includes(q) ||
          s.tidsskrift.toLowerCase().includes(q))
    );
  }, [studier, studieSok, studieKat]);

  useEffect(() => {
    void loadOverrides().then(setOverrides);
    fetch("/api/studies")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setStudier(Array.isArray(d) ? d.filter((s: Studie) => s.summary) : []))
      .catch(() => setStudier([]));
    void loadApprovedClaims().then((res) => {
      setClaimsConfigured(res.configured);
      setApprovedClaims(res.claims);
    });
  }, []);

  function toggleClaimKat(id: string) {
    setClaimKatFilter((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
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
  const [laster, setLaster] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [kjoringer, setKjoringer] = useState<Kjoring[]>([]);
  const [utkast, setUtkast] = useState<{ type: ContentType; markdown: string }[]>([]);
  const [lagerWord, setLagerWord] = useState(false);

  const valgteTilgjengelige = CONTENT_TYPES.filter((t) => valgteTyper.has(t.id) && t.available);
  const harValgt = valgteTilgjengelige.length > 0;
  const visDeckOpsjoner = valgteTyper.has("deck");

  function toggleType(t: ContentType) {
    const meta = CONTENT_TYPES.find((x) => x.id === t)!;
    if (!meta.available) return; // "Soon" types can't be selected yet
    setValgteTyper((prev) => {
      const n = new Set(prev);
      n.has(t) ? n.delete(t) : n.add(t);
      return n;
    });
    setFeil(null);
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

  // Build the source material shared by every asset: uploaded files +
  // the picked scientific studies synthesized into one text file + (optionally) the
  // approved-claims block. Returns the claim ids fed in so each asset can record them.
  function byggKilder(): { files: File[]; claimIds: string[] } {
    const kilder = [...filer];
    let claimIds: string[] = [];
    const claimsKilde = buildClaimsSourceFile(inkluderteClaims);
    if (claimsKilde) {
      kilder.push(claimsKilde.file);
      claimIds = claimsKilde.claimIds;
    }
    const valgte = studier.filter((s) => valgteStudier.has(s.pmid));
    if (valgte.length) {
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
      kilder.push(
        new File([`Selected Aker BioMarine scientific studies\n\n${tekst}`],
          "Selected-scientific-studies.txt", { type: "text/plain" })
      );
    }
    return { files: kilder, claimIds };
  }

  // Run one content type end-to-end: start a job, poll it, then handle its
  // result (deck → download, blog → editable panel). Errors are recorded on
  // that asset's row so the other assets keep running.
  async function kjorEn(type: ContentType, kilder: File[], claimIds: string[]) {
    try {
      const form = new FormData();
      kilder.forEach((f) => form.append("filer", f));
      form.append("lengde", lengde);
      form.append("tone", tone);
      form.append("sprak", sprak.trim() || "English");
      form.append("instruksjoner", kontekst.trim());
      form.append("innholdstype", type);

      const start = await fetch("/api/generate-deck", { method: "POST", body: form });
      const startData = await start.json().catch(() => ({}));
      if (!start.ok || !startData.job_id) {
        throw new Error(startData.feil || `Server responded ${start.status}`);
      }
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

      oppdaterKjoring(type, { step: TEXT_TYPES.has(type) ? "Writing the draft…" : "Downloading…" });
      const dl = await fetch(`/api/generate-deck?id=${jobId}&download=1`);
      if (!dl.ok) {
        const d = await dl.json().catch(() => ({}));
        throw new Error(d.feil || `Server responded ${dl.status}`);
      }
      if (TEXT_TYPES.has(type)) {
        const md = await dl.text();
        setUtkast((prev) => [...prev.filter((u) => u.type !== type), { type, markdown: md }]);
      } else {
        const blob = await dl.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = blob.type.includes("zip") ? "content-decks.zip" : "content-deck.pptx";
        a.click();
        URL.revokeObjectURL(url);
      }
      oppdaterKjoring(type, { status: "done", progress: 100, step: "Done" });

      // Record which approved claims this asset drew on (retraction traceability). Only
      // deck/blog/whitepaper are ever generated, and only when claims were fed in.
      if (claimIds.length && (type === "deck" || type === "blog" || type === "whitepaper")) {
        const reviewer =
          typeof window !== "undefined" ? window.localStorage.getItem(REVIEWER_KEY) || undefined : undefined;
        void recordAssetClaims(type, claimIds, {
          title: `${type} · ${new Date().toISOString().slice(0, 10)}`,
          createdBy: reviewer,
        });
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
    if (filer.length === 0 && valgteStudier.size === 0 && inkluderteClaims.length === 0) {
      setFeil("Add at least one source file, pick a study, or include approved claims to base the content on.");
      return;
    }
    setLaster(true);
    setFeil(null);
    setUtkast([]);
    setKjoringer(typer.map((type) => ({ type, progress: 0, step: "Starting…", status: "running" })));

    // Each asset reads the same sources independently, so run them in parallel.
    const { files, claimIds } = byggKilder();
    await Promise.all(typer.map((type) => kjorEn(type, files, claimIds)));
    setLaster(false);
  }

  // Convert the current (edited) draft to a Word .docx on the backend and download it.
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

  return (
    <div className="min-h-screen bg-[#F2F7F9]">
      <header className="bg-gradient-to-br from-[#031B34] via-[#052A4E] to-[#06456B] px-4 pb-12 pt-8">
        <div className="mx-auto max-w-3xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7FD4E6]">
            Content Generation Tool
          </div>
          <h1 className="mt-3 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
            Create content from your material
          </h1>
          <p className="mt-3 max-w-2xl text-[#BFE3EF]">
            Upload your source files and choose what to produce. Pick one or
            several at once, and our AI turns them into ready to use, on brand
            content: polished PowerPoint decks and science backed blog drafts.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {/* Product selector — which brand the content is for (single choice) */}
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B8B95]">
          Which product is this for?
        </div>
        <div className="mb-6 grid grid-cols-3 gap-2">
          {PRODUCTS.map((p) => {
            const valgt = produkt === p.id && p.available;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => p.available && setProdukt(p.id)}
                disabled={!p.available}
                aria-pressed={valgt}
                className={`relative rounded-2xl border px-3 py-3 text-left transition-colors ${
                  valgt
                    ? "border-[#E30917] bg-[#FDECEC]"
                    : "border-[#D6E6EE] bg-white hover:border-[#9FC9D9]"
                } ${!p.available ? "cursor-not-allowed opacity-60" : ""}`}
              >
                {!p.available && (
                  <span className="absolute right-2 top-2 rounded-full bg-[#E1EEF3] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#6B8B95]">
                    Soon
                  </span>
                )}
                <div className="text-sm font-semibold text-[#052A4E]">{p.label}</div>
                {p.hint && <div className="text-xs text-zinc-500">{p.hint}</div>}
              </button>
            );
          })}
        </div>

        {/* Content type selector — multi-select: pick one or several */}
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B8B95]">
          What do you want to create? <span className="text-zinc-400 normal-case tracking-normal">(pick one or several)</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {CONTENT_TYPES.map((t) => {
            const valgt = valgteTyper.has(t.id) && t.available;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleType(t.id)}
                disabled={!t.available}
                aria-pressed={valgt}
                className={`relative rounded-2xl border px-3 py-4 text-left transition-colors ${
                  valgt
                    ? "border-[#E30917] bg-[#FDECEC]"
                    : "border-[#D6E6EE] bg-white hover:border-[#9FC9D9]"
                } ${!t.available ? "cursor-not-allowed opacity-60" : ""}`}
              >
                {!t.available ? (
                  <span className="absolute right-2 top-2 rounded-full bg-[#E1EEF3] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#6B8B95]">
                    Soon
                  </span>
                ) : (
                  valgt && (
                    <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#E30917] text-[11px] font-bold text-white">
                      ✓
                    </span>
                  )
                )}
                <div className="text-2xl">{t.icon}</div>
                <div className="mt-2 text-sm font-semibold text-[#052A4E]">{t.label}</div>
                <div className="text-xs text-zinc-500">{t.hint}</div>
              </button>
            );
          })}
        </div>

        {harValgt ? (
          <>
            {/* Upload */}
            <label className="mt-6 block cursor-pointer rounded-2xl border-2 border-dashed border-[#9FC9D9] bg-white p-8 text-center transition-colors hover:border-[#3FD0C9] hover:bg-[#E1F4F3]">
              <input
                type="file"
                accept=".docx,.txt,.md"
                multiple
                className="hidden"
                onChange={(e) => leggTilFiler(e.target.files)}
              />
              <div className="text-4xl">📄</div>
              <div className="mt-2 font-semibold text-[#052A4E]">
                Click to add source files
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                .docx, .txt or .md · you can add several
              </div>
            </label>

            {/* File list */}
            {filer.length > 0 && (
              <ul className="mt-4 space-y-2">
                {filer.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-xl border border-[#D6E6EE] bg-white px-4 py-2 text-sm"
                  >
                    <span className="truncate text-[#052A4E]">📎 {f.name}</span>
                    <button
                      onClick={() => fjern(i)}
                      className="ml-3 shrink-0 text-xs font-medium text-zinc-400 hover:text-red-500"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-3 text-xs text-zinc-500">
              Every selected asset is built from the same sources. For a deck, one deck is generated
              per file (multiple files download as a zip).
            </p>

            {/* Pick from Scientific Studies */}
            <div className="mt-4 rounded-2xl border border-[#D6E6EE] bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B8B95]">
                  Or pick from Scientific Studies
                </div>
                {valgteStudier.size > 0 && (
                  <span className="rounded-full bg-[#E1F4F3] px-2.5 py-0.5 text-xs font-semibold text-[#0A7A8A]">
                    {valgteStudier.size} selected
                  </span>
                )}
              </div>
              {studier.length === 0 ? (
                <p className="mt-2 text-xs text-zinc-400">Loading studies…</p>
              ) : (
                <>
                  <input
                    type="text"
                    value={studieSok}
                    onChange={(e) => setStudieSok(e.target.value)}
                    placeholder="Search studies…"
                    className="mt-3 w-full rounded-lg border border-[#D6E6EE] bg-white px-3 py-2 text-sm outline-none focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <PickChip aktiv={studieKat === null} onClick={() => setStudieKat(null)}>
                      All ({studier.length})
                    </PickChip>
                    {studieKategorier.map(([navn, antall]) => (
                      <PickChip key={navn} aktiv={studieKat === navn} onClick={() => setStudieKat(navn)}>
                        {navn} ({antall})
                      </PickChip>
                    ))}
                  </div>
                  <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                    {filtrerteStudier.length === 0 ? (
                      <p className="py-4 text-center text-xs text-zinc-400">No studies match.</p>
                    ) : (
                      filtrerteStudier.map((s) => {
                        const valgt = valgteStudier.has(s.pmid);
                        const verified = !!overrides[s.pmid] || s.verified;
                        return (
                          <label
                            key={s.pmid}
                            className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm transition-colors ${
                              valgt ? "border-[#3FD0C9] bg-[#F4FBFC]" : "border-[#E3EEF2] hover:bg-[#F7FBFC]"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={valgt}
                              onChange={() => toggleStudie(s.pmid)}
                              className="mt-1 accent-[#0A7A8A]"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-[#052A4E]">{s.tittel}</span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                                {verified ? (
                                  <span className="rounded-full bg-[#DFF3E4] px-1.5 py-0.5 font-bold uppercase text-[#1B7A3D]">
                                    Verified
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-[#EEE7D6] px-1.5 py-0.5 font-bold uppercase text-[#8A6A2B]">
                                    AI
                                  </span>
                                )}
                                {s.quality && <span className="text-zinc-400">Quality {s.quality.score}%</span>}
                                <span className="text-zinc-400">{s.ar}</span>
                              </span>
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </>
              )}
              <p className="mt-2 text-xs text-zinc-500">
                Selected summaries are sent to the AI as source material, alongside any files.
              </p>
            </div>

            {/* Approved science claims (Phase 2) — authoritative, science-reviewed facts the
                generators compose from and cite. Recorded per asset for retraction traceability. */}
            <div className="mt-6 rounded-2xl border border-[#D6E6EE] bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0A7A8A]">
                    ✓ Approved science claims
                  </div>
                  <p className="mt-1 max-w-lg text-xs text-zinc-500">
                    {claimsConfigured
                      ? "Facts reviewed and approved by the science team. Included as an authoritative source the AI prefers and cites."
                      : "The claims library is not set up yet, so there are no approved claims to include."}
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
                    Include ({approvedClaims.length})
                  </label>
                )}
              </div>

              {claimsConfigured && approvedClaims.length === 0 && (
                <p className="mt-2 text-xs text-zinc-400">
                  No approved claims yet. Approve some in the Research tab, then they show up here.
                </p>
              )}

              {inkluderClaims && approvedClaims.length > 0 && (
                <div className="mt-3">
                  <div className="mb-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        setClaimKatFilter(new Set());
                        setKjoringer([]);
                      }}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        claimKatFilter.size === 0
                          ? "bg-[#0A7A8A] text-white"
                          : "bg-white text-zinc-600 ring-1 ring-[#D6E6EE] hover:bg-[#E1F4F3]"
                      }`}
                    >
                      All ({approvedClaims.length})
                    </button>
                    {claimKategorier.map(([id, { name, count }]) => (
                      <button
                        key={id}
                        onClick={() => toggleClaimKat(id)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                          claimKatFilter.has(id)
                            ? "bg-[#0A7A8A] text-white"
                            : "bg-white text-zinc-600 ring-1 ring-[#D6E6EE] hover:bg-[#E1F4F3]"
                        }`}
                      >
                        {name} ({count})
                      </button>
                    ))}
                  </div>
                  <p className="text-xs font-semibold text-[#0A7A8A]">
                    {inkluderteClaims.length} claim{inkluderteClaims.length === 1 ? "" : "s"} will be fed to
                    the AI as authoritative source and cited in the output.
                  </p>
                </div>
              )}
            </div>

            {/* Options */}
            <div className="mt-6 space-y-4">
              {/* Deck-specific settings live in their own labelled card, so when a
                  deck AND a blog are selected it's obvious these apply to the deck
                  only — not to the blog. */}
              {visDeckOpsjoner && (
                <div className="rounded-2xl border border-[#D6E6EE] bg-[#F7FBFC] p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0A7A8A]">
                    📊 PowerPoint deck settings
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    These apply to the deck only.
                  </p>

                  <div className="mt-3 space-y-4">
                    <div>
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6B8B95]">
                        Length
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          ["kort", "Short", "~6 slides"],
                          ["standard", "Standard", "~9 slides"],
                          ["detaljert", "Detailed", "~13 slides"],
                        ].map(([val, label, hint]) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => setLengde(val)}
                            className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                              lengde === val
                                ? "border-[#E30917] bg-[#FDECEC]"
                                : "border-[#D6E6EE] bg-white hover:border-[#9FC9D9]"
                            }`}
                          >
                            <div className="text-sm font-semibold text-[#052A4E]">{label}</div>
                            <div className="text-xs text-zinc-500">{hint}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6B8B95]">
                        Tone
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          ["salg", "Sales", "Benefit first"],
                          ["balansert", "Balanced", "Benefit + proof"],
                          ["vitenskap", "Scientific", "More evidence"],
                        ].map(([val, label, hint]) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => setTone(val)}
                            className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                              tone === val
                                ? "border-[#E30917] bg-[#FDECEC]"
                                : "border-[#D6E6EE] bg-white hover:border-[#9FC9D9]"
                            }`}
                          >
                            <div className="text-sm font-semibold text-[#052A4E]">{label}</div>
                            <div className="text-xs text-zinc-500">{hint}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Output language — applies to every selected asset. Free text, so any language works. */}
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B8B95]">
                  Output language{" "}
                  <span className="normal-case tracking-normal text-zinc-400">
                    (any language, applies to everything you create)
                  </span>
                </div>
                <LanguagePicker value={sprak} onChange={setSprak} />
                <p className="mt-1 text-xs text-zinc-500">
                  Search and pick a language, or type your own. Any language in the world works. The AI
                  writes all output text in it, whatever the source language.
                </p>
              </div>

              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B8B95]">
                  Context & instructions{" "}
                  <span className="normal-case tracking-normal text-zinc-400">
                    (optional, applies to everything you create)
                  </span>
                </div>
                <textarea
                  value={kontekst}
                  onChange={(e) => setKontekst(e.target.value)}
                  rows={4}
                  placeholder="Tell the AI anything specific: audience, angle, points to include, claims to avoid, terminology, structure. E.g. 'Audience is pharmacy buyers in Germany; lead with the Omega 3 Index data; don't mention competitors; keep it to the joint health story.'"
                  className="w-full resize-y rounded-xl border border-[#D6E6EE] bg-white p-3 text-sm text-[#052A4E] shadow-sm outline-none placeholder:text-zinc-400 focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
                />
                <p className="mt-1 text-xs text-zinc-500">
                  Free text. Every selected asset follows this on top of the source files (it never
                  overrides brand styling or the accuracy rules for claims).
                </p>
              </div>
            </div>
          </>
        ) : (
          /* Nothing selectable is chosen yet */
          <div className="mt-6 rounded-2xl border border-dashed border-[#D6E6EE] bg-white p-8 text-center">
            <div className="text-4xl">👆</div>
            <div className="mt-3 text-lg font-semibold text-[#052A4E]">
              Pick what you want to create
            </div>
            <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">
              Choose <strong>PowerPoint deck</strong>, <strong>Blog post</strong> or{" "}
              <strong>Whitepaper</strong> above (pick one or several). Video and podcast are on the way.
            </p>
          </div>
        )}

        {/* Produce */}
        <button
          onClick={produser}
          disabled={
            laster ||
            !harValgt ||
            (filer.length === 0 && valgteStudier.size === 0 && inkluderteClaims.length === 0)
          }
          className="mt-6 w-full rounded-xl bg-[#E30917] py-4 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-[#c40813] disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {laster
            ? "AI is working…"
            : harValgt
              ? `Generate ${valgteTilgjengelige.map((t) => t.label.toLowerCase()).join(" + ")}`
              : "Generate"}
        </button>

        {/* Per-asset progress & result status */}
        {kjoringer.length > 0 && (
          <div className="mt-4 space-y-3">
            {kjoringer.map((k) => {
              const meta = CONTENT_TYPES.find((t) => t.id === k.type)!;
              return (
                <div key={k.type} className="rounded-xl border border-[#D6E6EE] bg-white p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-[#052A4E]">
                      {meta.icon} {meta.label}
                    </span>
                    <span className="tabular-nums text-[#6B8B95]">
                      {k.status === "running" ? `${k.progress}%` : k.status === "done" ? "✅" : "⚠️"}
                    </span>
                  </div>
                  {k.status === "running" && (
                    <>
                      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[#E1EEF3]">
                        <div
                          className="h-full rounded-full bg-[#E30917] transition-all duration-700 ease-out"
                          style={{ width: `${Math.max(3, k.progress)}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-zinc-500">{k.step || "Working…"}</p>
                    </>
                  )}
                  {k.status === "done" && (
                    <p className="mt-1 text-xs text-emerald-700">
                      {TEXT_TYPES.has(k.type)
                        ? "✅ Draft ready. Review & edit it below."
                        : "✅ Downloaded. Check your downloads folder."}
                    </p>
                  )}
                  {k.status === "error" && (
                    <p className="mt-1 text-xs text-red-600">{k.error}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Top-level validation error (e.g. nothing picked) */}
        {feil && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {feil}
          </div>
        )}

        {utkast.map((u) => {
          const label = CONTENT_TYPES.find((t) => t.id === u.type)?.label ?? "Draft";
          const base = u.type === "whitepaper" ? "superba-whitepaper-draft" : "superba-blog-draft";
          return (
            <div key={u.type} className="mt-4 rounded-2xl border border-[#D6E6EE] bg-white p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B8B95]">
                  {label} draft · review & edit
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(u.markdown)}
                    className="rounded-lg border border-[#D6E6EE] bg-white px-3 py-1.5 text-xs font-semibold text-[#0A7A8A] hover:bg-[#E1F4F3]"
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => lastNedWord(u.markdown, base)}
                    disabled={lagerWord}
                    className="rounded-lg bg-[#0A7A8A] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#086472] disabled:cursor-not-allowed disabled:bg-zinc-300"
                  >
                    {lagerWord ? "Creating…" : "Download Word (.docx)"}
                  </button>
                </div>
              </div>
              <textarea
                value={u.markdown}
                onChange={(e) =>
                  setUtkast((prev) => prev.map((x) => (x.type === u.type ? { ...x, markdown: e.target.value } : x)))
                }
                className="h-[28rem] w-full resize-y rounded-lg border border-[#D6E6EE] bg-[#FAFDFE] p-3 font-mono text-xs leading-relaxed text-[#052A4E] outline-none focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
              />
              <p className="mt-1 text-xs text-zinc-500">
                AI generated draft based on your sources. Edit it here, then download as Word. Review the
                science and claims before publishing.
              </p>
            </div>
          );
        })}

        <p className="mt-8 text-center text-xs text-zinc-400">
          Powered by AI · rendered on the Superba brand template
        </p>
      </main>
    </div>
  );
}
