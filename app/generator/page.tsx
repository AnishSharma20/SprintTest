"use client";

import { useState } from "react";

type ContentType = "deck" | "blog" | "video" | "podcast";

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
];

export default function ContentGenerator() {
  const [contentType, setContentType] = useState<ContentType>("deck");
  const [filer, setFiler] = useState<File[]>([]);
  const [lengde, setLengde] = useState("standard");
  const [tone, setTone] = useState("balansert");
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
    if (filer.length === 0) return;
    setLaster(true);
    setFeil(null);
    setFerdig(false);
    setFremdrift(0);
    setSteg("Starting…");

    try {
      // 1) Start the job — returns immediately with a job id.
      const form = new FormData();
      filer.forEach((f) => form.append("filer", f));
      form.append("lengde", lengde);
      form.append("tone", tone);

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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
              Blog, video and podcast generation are on the way — pick
              PowerPoint deck above to get started today.
            </p>
          </div>
        )}

        {/* Produce */}
        <button
          onClick={produser}
          disabled={laster || (aktiv.available && filer.length === 0)}
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
