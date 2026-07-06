"use client";

import { useEffect, useState } from "react";
import type { Studie } from "../wiki";
import { loadOverrides, type Override } from "../summary-overrides";

type ContentType = "deck" | "blog" | "video" | "podcast" | "whitepaper";

const CONTENT_TYPES: {
  id: ContentType;
  label: string;
  icon: string;
  hint: string;
  available: boolean;
}[] = [
  { id: "deck", label: "PowerPoint deck", icon: "📊", hint: "On-brand slides", available: true },
  { id: "blog", label: "Blog post", icon: "✍️", hint: "Article draft", available: false },
  { id: "video", label: "Video", icon: "🎬", hint: "Script & storyboard", available: false },
  { id: "podcast", label: "Podcast", icon: "🎙️", hint: "Episode audio", available: false },
  { id: "whitepaper", label: "Whitepaper", icon: "📄", hint: "In-depth report", available: false },
];

export default function ContentGenerator() {
  const [contentType, setContentType] = useState<ContentType>("deck");
  const [filer, setFiler] = useState<File[]>([]);
  const [lengde, setLengde] = useState("standard");
  const [tone, setTone] = useState("balansert");
  const [kontekst, setKontekst] = useState("");
  const [studier, setStudier] = useState<Studie[]>([]);
  const [valgteStudier, setValgteStudier] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, Override>>({});

  useEffect(() => {
    setOverrides(loadOverrides());
    fetch("/api/studies")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setStudier(Array.isArray(d) ? d.filter((s: Studie) => s.summary) : []))
      .catch(() => setStudier([]));
  }, []);

  function toggleStudie(pmid: string) {
    setValgteStudier((prev) => {
      const n = new Set(prev);
      n.has(pmid) ? n.delete(pmid) : n.add(pmid);
      return n;
    });
    setFerdig(false);
  }
  const [laster, setLaster] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);
  const [ferdig, setFerdig] = useState(false);
  const [fremdrift, setFremdrift] = useState(0);
  const [steg, setSteg] = useState("");

  const aktiv = CONTENT_TYPES.find((t) => t.id === contentType)!;

  function velgType(t: ContentType) {
    setContentType(t);
    setFeil(null);
    setFerdig(false);
  }

  function leggTilFiler(nye: FileList | null) {
    if (!nye) return;
    setFiler((f) => [...f, ...Array.from(nye)]);
    setFerdig(false);
    setFeil(null);
  }

  function fjern(i: number) {
    setFiler((f) => f.filter((_, idx) => idx !== i));
  }

  const sov = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function produser() {
    // Only the PowerPoint deck is wired to a backend today. The other content
    // types are selectable but not yet available.
    if (!aktiv.available) {
      setFerdig(false);
      setFeil(`${aktiv.label} generation isn't available yet — only PowerPoint deck works for now.`);
      return;
    }
    if (filer.length === 0 && valgteStudier.size === 0) {
      setFeil("Add at least one source file or pick a study to base the deck on.");
      return;
    }
    setLaster(true);
    setFeil(null);
    setFerdig(false);
    setFremdrift(0);
    setSteg("Starting…");

    try {
      // 1) Start the job — returns immediately with a job id.
      const form = new FormData();
      filer.forEach((f) => form.append("filer", f));

      // Selected scientific-study summaries → one synthesized source file (uses any edited versions).
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
        form.append(
          "filer",
          new File([`Selected Aker BioMarine scientific studies\n\n${tekst}`],
            "Selected-scientific-studies.txt", { type: "text/plain" })
        );
      }

      form.append("lengde", lengde);
      form.append("tone", tone);
      form.append("instruksjoner", kontekst.trim());

      const start = await fetch("/api/generate-deck", { method: "POST", body: form });
      const startData = await start.json().catch(() => ({}));
      if (!start.ok || !startData.job_id) {
        throw new Error(startData.feil || `Server responded ${start.status}`);
      }
      const jobId = startData.job_id as string;

      // 2) Poll status until the job is done (or fails).
      for (;;) {
        await sov(1500);
        const res = await fetch(`/api/generate-deck?id=${jobId}`);
        const s = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(s.feil || `Server responded ${res.status}`);
        setFremdrift(s.progress ?? 0);
        if (s.step) setSteg(s.step);
        if (s.status === "done") break;
        if (s.status === "error") throw new Error(s.error || "Generation failed");
      }

      // 3) Download the finished deck.
      setSteg("Downloading…");
      const dl = await fetch(`/api/generate-deck?id=${jobId}&download=1`);
      if (!dl.ok) {
        const d = await dl.json().catch(() => ({}));
        throw new Error(d.feil || `Server responded ${dl.status}`);
      }
      const blob = await dl.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const zip = blob.type.includes("zip");
      a.download = zip ? "content-decks.zip" : "content-deck.pptx";
      a.click();
      URL.revokeObjectURL(url);
      setFerdig(true);
    } catch (e) {
      setFeil((e as Error).message);
    } finally {
      setLaster(false);
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
            Upload your source files and choose what to produce. Our AI turns
            them into ready-to-use, on-brand content — starting with polished
            PowerPoint decks.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {/* Content type selector */}
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B8B95]">
          What do you want to create?
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {CONTENT_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => velgType(t.id)}
              className={`relative rounded-2xl border px-3 py-4 text-left transition-colors ${
                contentType === t.id
                  ? "border-[#E30917] bg-[#FDECEC]"
                  : "border-[#D6E6EE] bg-white hover:border-[#9FC9D9]"
              }`}
            >
              {!t.available && (
                <span className="absolute right-2 top-2 rounded-full bg-[#E1EEF3] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#6B8B95]">
                  Soon
                </span>
              )}
              <div className="text-2xl">{t.icon}</div>
              <div className="mt-2 text-sm font-semibold text-[#052A4E]">{t.label}</div>
              <div className="text-xs text-zinc-500">{t.hint}</div>
            </button>
          ))}
        </div>

        {aktiv.available ? (
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
              One deck is generated per file. Multiple files download as a zip.
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
                <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                  {studier.map((s) => {
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
                  })}
                </div>
              )}
              <p className="mt-2 text-xs text-zinc-500">
                Selected summaries are sent to the AI as source material, alongside any files.
              </p>
            </div>

            {/* Options */}
            <div className="mt-6 space-y-4">
              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B8B95]">
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
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B8B95]">
                  Tone
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ["salg", "Sales", "Benefit-led"],
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

              <div>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6B8B95]">
                  Context & instructions <span className="text-zinc-400">(optional)</span>
                </div>
                <textarea
                  value={kontekst}
                  onChange={(e) => setKontekst(e.target.value)}
                  rows={4}
                  placeholder="Tell the AI anything specific — audience, angle, must-include points, claims to avoid, terminology, structure. E.g. 'Audience is pharmacy buyers in Germany; lead with the Omega-3 Index data; don't mention competitors; keep it to the joint-health story.'"
                  className="w-full resize-y rounded-xl border border-[#D6E6EE] bg-white p-3 text-sm text-[#052A4E] shadow-sm outline-none placeholder:text-zinc-400 focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
                />
                <p className="mt-1 text-xs text-zinc-500">
                  Free text — the model follows this on top of the source files (it never overrides
                  brand styling or claim-accuracy rules).
                </p>
              </div>
            </div>
          </>
        ) : (
          /* Coming-soon panel for content types that aren't wired yet */
          <div className="mt-6 rounded-2xl border border-[#D6E6EE] bg-white p-8 text-center">
            <div className="text-4xl">🚧</div>
            <div className="mt-3 text-lg font-semibold text-[#052A4E]">
              {aktiv.label} generation is coming soon
            </div>
            <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">
              Right now the tool can produce <strong>PowerPoint decks</strong>.
              Blog, video, podcast and whitepaper generation are on the way — pick
              PowerPoint deck above to get started today.
            </p>
          </div>
        )}

        {/* Produce */}
        <button
          onClick={produser}
          disabled={laster || (aktiv.available && filer.length === 0 && valgteStudier.size === 0)}
          className="mt-6 w-full rounded-xl bg-[#E30917] py-4 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-[#c40813] disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {laster ? "AI is building your deck…" : `Generate ${aktiv.label.toLowerCase()}`}
        </button>

        {/* Progress */}
        {laster && (
          <div className="mt-4 rounded-xl border border-[#D6E6EE] bg-white p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium text-[#052A4E]">{steg || "Working…"}</span>
              <span className="tabular-nums text-[#6B8B95]">{fremdrift}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#E1EEF3]">
              <div
                className="h-full rounded-full bg-[#E30917] transition-all duration-700 ease-out"
                style={{ width: `${Math.max(3, fremdrift)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              A full deck takes a couple of minutes — you can keep this tab open.
            </p>
          </div>
        )}

        {/* Status */}
        {feil && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {feil}
          </div>
        )}
        {ferdig && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
            ✅ Done! Your deck was downloaded — check your downloads folder.
          </div>
        )}

        <p className="mt-8 text-center text-xs text-zinc-400">
          Powered by AI · rendered on the Superba brand template
        </p>
      </main>
    </div>
  );
}
