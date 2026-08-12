"use client";

// A category picker that shows every category's brand icon (the same line art icons the
// Scientific Studies sidebar uses) — shared by every "pick a category for this finding" spot:
// add-finding-modal.tsx, add-study-modal.tsx and findings-v2.tsx's New finding modal. A native
// <option> can't carry an image, so this is a small custom dropdown instead of a <select>, which
// lets every row (not just the closed, selected state) carry its icon.

/* eslint-disable @next/next/no-img-element -- tiny local line-art PNGs, next/image adds nothing */

import { useEffect, useRef, useState } from "react";
import { benefitIcon } from "./v2/benefit-icons";

export default function CategorySelect({
  value,
  onChange,
  categories,
  placeholder = "Select a category…",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  categories: { id: string; name: string }[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = categories.find((c) => c.id === value);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-[10px] border border-[#E8E8ED] bg-white py-1.5 pl-3 pr-8 text-left text-[12.5px] outline-none focus:border-[#C7C7CC]"
      >
        {selected && <img src={benefitIcon(selected.name)} alt="" className="h-4 w-4 shrink-0" />}
        <span className={`min-w-0 flex-1 truncate ${selected ? "text-[#1D1D1F]" : "text-[#AEAEB2]"}`}>
          {selected ? selected.name : placeholder}
        </span>
        <svg
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 opacity-50"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#1D1D1F"
          strokeWidth="2.5"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-20 max-h-64 w-full min-w-[200px] overflow-y-auto rounded-[12px] border border-[#E8E8ED] bg-white p-1.5 shadow-lg">
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={`flex w-full items-center rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] ${
              !value ? "bg-[#F0F0F2] font-semibold text-[#1D1D1F]" : "text-[#AEAEB2] hover:bg-[#F5F5F7]"
            }`}
          >
            {placeholder}
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[12.5px] ${
                value === c.id ? "bg-[#F0F0F2] font-semibold text-[#1D1D1F]" : "text-[#1D1D1F] hover:bg-[#F5F5F7]"
              }`}
            >
              <img src={benefitIcon(c.name)} alt="" className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
