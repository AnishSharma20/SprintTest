"use client";

// Category manager — add, rename and delete the benefit categories, shared by the Scientific
// Studies page and the Findings library so both surfaces edit the SAME list (a rename on one
// shows up on the other, because a category is keyed by a stable id, never by its name).
//
// Deleting is the interesting case: a category still holding studies or findings can only be
// removed by naming the category its content moves into. The move is done study by study
// (PUT /api/study-categories), which is also what carries each study's findings across, and
// then the category itself is deleted with reassign_to to sweep up anything left (findings
// whose study is not in the list, and marketing findings, which belong to a category directly).

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Category } from "./lib/claims-types";
import type { Studie } from "./studies";
import { effectiveCategoryIds, type StudyMeta } from "./study-meta";

type CategoryRow = Category & { claim_count: number; study_count: number };

export default function CategoryManager({
  reviewer,
  onClose,
  onChanged,
}: {
  reviewer: string;
  onClose: () => void;
  /** Reload the page data behind the modal after a change. */
  onChanged: () => void | Promise<void>;
}) {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [studier, setStudier] = useState<Studie[]>([]);
  const [studyCategories, setStudyCategories] = useState<Record<string, string[]>>({});
  const [laster, setLaster] = useState(true);
  const [feil, setFeil] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [nyttNavn, setNyttNavn] = useState("");
  const [nyParent, setNyParent] = useState<"science" | "marketing">("science");
  const [redigerer, setRedigerer] = useState<string | null>(null);
  const [redigertNavn, setRedigertNavn] = useState("");
  const [sletter, setSletter] = useState<string | null>(null);
  const [flyttTil, setFlyttTil] = useState("");

  const last = useCallback(async () => {
    setLaster(true);
    try {
      const [cats, studies, links] = await Promise.all([
        fetch("/api/categories").then((r) => r.json()),
        fetch("/api/studies").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/study-categories").then((r) => r.json()),
      ]);
      setRows((cats.categories ?? []) as CategoryRow[]);
      setStudier(Array.isArray(studies) ? studies : []);
      setStudyCategories(links.byPmid ?? {});
      if (cats.configured === false) setFeil("The database is not configured, so categories cannot be edited yet.");
      else if (cats.migrated === false)
        setFeil(
          "Adding and renaming works. Moving studies between categories needs migration 0003 in supabase/migrations to be run first."
        );
    } catch (e) {
      setFeil((e as Error).message);
    } finally {
      setLaster(false);
    }
  }, []);

  useEffect(() => {
    void last();
  }, [last]);

  // Effective study count per category: the reviewer assignment when there is one, otherwise the
  // built in assignment from app/studies.ts (which the API cannot see).
  const meta: StudyMeta = useMemo(
    () => ({ configured: true, editable: true, categories: rows, studyCategories, quality: {} }),
    [rows, studyCategories]
  );
  const studyCount = useMemo(() => {
    const m = new Map<string, number>();
    studier.forEach((s) =>
      effectiveCategoryIds(s, meta).forEach((id) => m.set(id, (m.get(id) ?? 0) + 1))
    );
    return m;
  }, [studier, meta]);

  async function etterEndring(melding: string) {
    setStatus(melding);
    await last();
    await onChanged();
  }

  async function opprett() {
    const navn = nyttNavn.trim();
    if (!navn) return;
    setBusy(true);
    setFeil(null);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: navn, parent: nyParent }),
      });
      const data = await res.json();
      if (!res.ok) return setFeil(data.error || "Could not create the category.");
      setNyttNavn("");
      await etterEndring(`Added "${navn}".`);
    } finally {
      setBusy(false);
    }
  }

  async function endreNavn(cat: CategoryRow) {
    const navn = redigertNavn.trim();
    if (!navn || navn === cat.name) return setRedigerer(null);
    setBusy(true);
    setFeil(null);
    try {
      const res = await fetch(`/api/categories/${cat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: navn }),
      });
      const data = await res.json();
      if (!res.ok) return setFeil(data.error || "Could not rename the category.");
      setRedigerer(null);
      await etterEndring(`Renamed to "${navn}".`);
    } finally {
      setBusy(false);
    }
  }

  async function slett(cat: CategoryRow) {
    const berorte = studier.filter((s) => effectiveCategoryIds(s, meta).includes(cat.id));
    const iBruk = berorte.length > 0 || cat.claim_count > 0;
    if (iBruk && !flyttTil) return setFeil("Pick the category to move the studies and findings into.");
    setBusy(true);
    setFeil(null);
    try {
      // Study by study first: this is what re-files each study's own findings.
      for (const s of berorte) {
        const forrige = effectiveCategoryIds(s, meta);
        const neste = [...new Set([...forrige.filter((id) => id !== cat.id), flyttTil])];
        const res = await fetch("/api/study-categories", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pmid: s.pmid,
            categoryIds: neste,
            previousCategoryIds: forrige,
            actor: reviewer,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          return setFeil(data.error || `Could not move ${s.pmid}.`);
        }
      }

      const url = iBruk ? `/api/categories/${cat.id}?reassign_to=${flyttTil}` : `/api/categories/${cat.id}`;
      const res = await fetch(url, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) return setFeil(data.error || "Could not delete the category.");

      setSletter(null);
      setFlyttTil("");
      const maal = rows.find((r) => r.id === flyttTil)?.name;
      await etterEndring(
        iBruk
          ? `Deleted "${cat.name}". ${berorte.length} studies and their findings moved to "${maal}".`
          : `Deleted "${cat.name}".`
      );
    } finally {
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;

  const grupper: { parent: "science" | "marketing"; tittel: string; hjelp: string }[] = [
    { parent: "science", tittel: "Science categories", hjelp: "Used by both studies and findings." },
    { parent: "marketing", tittel: "Marketing categories", hjelp: "Used by findings only." },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-[#031B34]/60 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="my-6 w-full max-w-2xl overflow-hidden rounded-[4px] border border-[#D6E6EE] bg-white shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#D6E6EE] bg-[#F4FBFC] px-6 py-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0A7A8A]">Manage categories</div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-[4px] p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            <span className="text-xl leading-none">✕</span>
          </button>
        </div>

        <div className="max-h-[76vh] overflow-y-auto px-6 py-5">
          <p className="mb-4 text-sm text-zinc-500">
            Categories are shared by the studies page and the findings library. Renaming one updates
            both. Deleting one moves its studies, and the findings that belong to them, into the
            category you pick.
          </p>

          {status && (
            <p className="mb-3 rounded-[4px] bg-[#DFF3E4] px-3 py-2 text-[12px] font-semibold text-[#1B7A3D]">
              {status}
            </p>
          )}
          {feil && (
            <p className="mb-3 rounded-[4px] bg-[#F3E0E0] px-3 py-2 text-[12px] font-semibold text-[#9A2A2A]">
              {feil}
            </p>
          )}

          {laster ? (
            <p className="text-zinc-400">Loading categories…</p>
          ) : (
            grupper.map((g) => {
              const iGruppen = rows.filter((r) => r.parent === g.parent);
              if (iGruppen.length === 0) return null;
              return (
                <div key={g.parent} className="mb-6">
                  <div className="mb-2 flex items-baseline gap-2">
                    <h3 className="text-[11px] font-bold uppercase tracking-wide text-[#0A7A8A]">{g.tittel}</h3>
                    <span className="text-[11px] text-zinc-400">{g.hjelp}</span>
                  </div>
                  <ul className="space-y-2">
                    {iGruppen.map((cat) => {
                      const antallStudier = g.parent === "science" ? studyCount.get(cat.id) ?? 0 : 0;
                      const kanSlettesDirekte = antallStudier === 0 && cat.claim_count === 0;
                      return (
                        <li key={cat.id} className="rounded-[4px] border border-[#E2EDF2] bg-[#FAFDFE] p-3">
                          {redigerer === cat.id ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                value={redigertNavn}
                                onChange={(e) => setRedigertNavn(e.target.value)}
                                className="min-w-[14rem] flex-1 rounded-[4px] border border-[#B7D9DE] bg-white px-2 py-1.5 text-sm outline-none focus:border-[#3FD0C9]"
                                autoFocus
                              />
                              <button
                                onClick={() => void endreNavn(cat)}
                                disabled={busy || !redigertNavn.trim()}
                                className="rounded-[4px] bg-[#1B7A3D] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#166433] disabled:opacity-40"
                              >
                                Save name
                              </button>
                              <button
                                onClick={() => setRedigerer(null)}
                                className="rounded-[4px] border border-[#D6E6EE] bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-[#052A4E]">{cat.name}</span>
                              <span className="text-[11px] text-zinc-400">
                                {g.parent === "science"
                                  ? `${antallStudier} ${antallStudier === 1 ? "study" : "studies"} · `
                                  : ""}
                                {cat.claim_count} {cat.claim_count === 1 ? "finding" : "findings"}
                              </span>
                              <span className="ml-auto flex gap-2">
                                <button
                                  onClick={() => {
                                    setRedigerer(cat.id);
                                    setRedigertNavn(cat.name);
                                    setSletter(null);
                                  }}
                                  className="rounded-[4px] border border-[#B7D9DE] bg-white px-2.5 py-1 text-xs font-semibold text-[#0A7A8A] hover:bg-[#E1F4F3]"
                                >
                                  ✎ Rename
                                </button>
                                <button
                                  onClick={() => {
                                    setSletter(sletter === cat.id ? null : cat.id);
                                    setFlyttTil("");
                                    setFeil(null);
                                  }}
                                  className="rounded-[4px] border border-[#E6C9C9] bg-white px-2.5 py-1 text-xs font-semibold text-[#9A2A2A] hover:bg-[#F9EFEF]"
                                >
                                  🗑 Delete
                                </button>
                              </span>
                            </div>
                          )}

                          {sletter === cat.id && (
                            <div className="mt-3 rounded-[4px] border border-[#E6C9C9] bg-white p-3">
                              {kanSlettesDirekte ? (
                                <p className="mb-2 text-[12px] text-zinc-600">
                                  Nothing uses this category. Delete it?
                                </p>
                              ) : (
                                <>
                                  <p className="mb-2 text-[12px] text-zinc-600">
                                    {antallStudier} studies and {cat.claim_count} findings are filed
                                    under this category. Pick where they should go.
                                  </p>
                                  <select
                                    value={flyttTil}
                                    onChange={(e) => setFlyttTil(e.target.value)}
                                    className="mb-2 w-full rounded-[4px] border border-[#B7D9DE] bg-white p-2 text-sm outline-none focus:border-[#3FD0C9]"
                                  >
                                    <option value="">Move everything into…</option>
                                    {rows
                                      .filter((r) => r.parent === cat.parent && r.id !== cat.id)
                                      .map((r) => (
                                        <option key={r.id} value={r.id}>
                                          {r.name}
                                        </option>
                                      ))}
                                  </select>
                                </>
                              )}
                              <div className="flex gap-2">
                                <button
                                  onClick={() => void slett(cat)}
                                  disabled={busy || (!kanSlettesDirekte && !flyttTil)}
                                  className="rounded-[4px] bg-[#9A2A2A] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#7f2020] disabled:opacity-40"
                                >
                                  {busy ? "Working…" : "Confirm delete"}
                                </button>
                                <button
                                  onClick={() => setSletter(null)}
                                  className="rounded-[4px] border border-[#D6E6EE] bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}

          <div className="rounded-[4px] border border-[#D6E6EE] bg-[#F4FBFC] p-4">
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#0A7A8A]">New category</h3>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={nyttNavn}
                onChange={(e) => setNyttNavn(e.target.value)}
                placeholder="Category name"
                className="min-w-[14rem] flex-1 rounded-[4px] border border-[#B7D9DE] bg-white px-3 py-2 text-sm outline-none focus:border-[#3FD0C9]"
              />
              <select
                value={nyParent}
                onChange={(e) => setNyParent(e.target.value as "science" | "marketing")}
                className="rounded-[4px] border border-[#B7D9DE] bg-white p-2 text-sm outline-none focus:border-[#3FD0C9]"
              >
                <option value="science">Science</option>
                <option value="marketing">Marketing</option>
              </select>
              <button
                onClick={() => void opprett()}
                disabled={busy || !nyttNavn.trim()}
                className="rounded-[4px] bg-[#0A7A8A] px-4 py-2 text-sm font-bold text-white hover:bg-[#086472] disabled:opacity-40"
              >
                ＋ Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
