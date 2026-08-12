"use client";

// Shared layout primitives for the V2 pages (Scientific Studies V2 + Findings Library V2).
// Both pages use the same three pane shell — filter sidebar on the left, a scannable list in
// the middle, and a reading/evidence panel on the right — so the two pages stay identical to
// interact with. The V1 pages do not use anything in this file.
//
// Design language (the "floating & focused" concept the client picked from three mockups,
// 2026-08-10): calm, Apple-like. One near-white background, black/gray typography, hairlines
// instead of boxed borders, a sidebar that is pure text (no chrome), study/finding cards that
// float with soft shadows, and ONE quiet accent (the brand teal) for links and the verified
// mark. Status is words, not colored badge pills; the red Superba benefit icons are the only
// illustration.

/* eslint-disable @next/next/no-img-element -- tiny local line-art PNGs, next/image adds nothing */

// TopNav is sticky; the sidebar and the docked panel stick right below it.
const NAV_H = "57px";

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif";

export function V2Shell({
  sidebar,
  children,
  panel,
  onClosePanel,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  /** The reading/evidence panel. null = closed. */
  panel?: React.ReactNode;
  onClosePanel?: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#FBFBFD] text-[#1D1D1F]" style={{ fontFamily: FONT_STACK }}>
      <div className="mx-auto flex w-full max-w-[1480px]">
        <aside
          className="hidden w-[280px] shrink-0 self-start px-8 lg:sticky lg:block lg:overflow-y-auto"
          style={{ top: NAV_H, height: `calc(100vh - ${NAV_H})` }}
        >
          {sidebar}
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
        {panel ? (
          <>
            {/* Below xl the panel becomes a full height drawer; the backdrop closes it. */}
            <div
              className="fixed inset-0 z-[55] bg-[#1D1D1F]/30 backdrop-blur-sm xl:hidden"
              onClick={onClosePanel}
            />
            <aside className="fixed bottom-0 right-0 top-0 z-[56] w-full max-w-[520px] overflow-y-auto border-l border-[#E8E8ED] bg-white shadow-xl xl:sticky xl:bottom-auto xl:top-[57px] xl:z-auto xl:h-[calc(100vh-57px)] xl:w-[480px] xl:max-w-none xl:shrink-0 xl:self-start xl:shadow-none">
            {panel}
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function SideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pt-8">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[#AEAEB2]">
        {title}
      </div>
      {children}
    </div>
  );
}

/** A row in the sidebar: pure text with an optional brand icon, bold when selected. */
export function SideItem({
  active,
  onClick,
  count,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count?: number | string;
  /** URL of a small brand icon shown before the label. */
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 py-[5px] text-left text-[14px] transition-colors ${
        active ? "font-bold text-[#1D1D1F]" : "text-[#6E6E73] hover:text-[#1D1D1F]"
      }`}
    >
      {icon && (
        <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
          <img src={icon} alt="" className={`max-h-full max-w-full ${active ? "" : "opacity-60"}`} />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate" title={typeof children === "string" ? children : undefined}>
        {children}
      </span>
      {count !== undefined && (
        <span className="shrink-0 text-[12.5px] tabular-nums text-[#C7C7CC]">{count}</span>
      )}
    </button>
  );
}

export function SideCheck({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-[5px] text-[13.5px] text-[#6E6E73]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-[15px] w-[15px] shrink-0 accent-[#1D1D1F]"
      />
      {children}
    </label>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <svg
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-40"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#1D1D1F"
        strokeWidth="2.2"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[12px] border border-[#E8E8ED] bg-white py-2.5 pl-[38px] pr-3 text-[14px] shadow-[0_1px_3px_rgba(29,29,31,.04)] outline-none placeholder:text-[#AEAEB2] focus:border-[#C7C7CC]"
      />
    </div>
  );
}

/** The header every V2 reading/evidence panel shares: eyebrow + close, title, meta. */
export function PanelHeader({
  eyebrow,
  onClose,
  title,
  children,
}: {
  eyebrow: string;
  onClose: () => void;
  title: React.ReactNode;
  /** Meta line(s), badges and links under the title. */
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-[#E8E8ED] px-7 py-6">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-[#AEAEB2]">{eyebrow}</span>
        <button
          onClick={onClose}
          className="rounded-[6px] px-1.5 text-[12px] font-semibold text-[#AEAEB2] hover:bg-[#F2F2F4] hover:text-[#6E6E73]"
        >
          Close ✕
        </button>
      </div>
      <h2 className="text-[18px] font-bold leading-snug tracking-[-0.015em] text-[#1D1D1F]">
        {title}
      </h2>
      {children}
    </div>
  );
}

/** Small status marker: a muted dot + word instead of a colored badge pill. */
export function Pill({
  tone,
  title,
  children,
}: {
  tone: "teal" | "green" | "amber" | "red" | "gray";
  title?: string;
  children: React.ReactNode;
}) {
  const dot =
    tone === "green"
      ? "bg-[#2E7D4F]"
      : tone === "amber"
      ? "bg-[#E0A93E]"
      : tone === "red"
      ? "bg-[#B3403A]"
      : tone === "gray"
      ? "bg-[#C7C7CC]"
      : "bg-[#0A7A8A]";
  return (
    <span title={title} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#6E6E73]">
      <span className={`h-[7px] w-[7px] rounded-full ${dot}`} />
      {children}
    </span>
  );
}

/** The Reviewer identity as it appears at the bottom of both V2 sidebars: the signed-in Microsoft
 *  account, not a typed name. */
export function SideReviewer({ value, hint }: { value: string; hint: string }) {
  return (
    <div className="mb-8 pt-9">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[#AEAEB2]">
        Reviewer
      </div>
      <div className="w-full rounded-[10px] border border-[#E8E8ED] bg-[#F5F5F7] px-3 py-2 text-[13.5px] text-[#1D1D1F]">
        {value || "Signing in…"}
      </div>
      <p className="mt-1.5 text-[11.5px] leading-snug text-[#AEAEB2]">{hint}</p>
    </div>
  );
}
