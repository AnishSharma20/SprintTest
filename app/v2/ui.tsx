"use client";

// Shared layout primitives for the V2 pages (Scientific Studies V2 + Findings Library V2).
// Both pages use the same three pane shell — filter sidebar on the left, a scannable list in
// the middle, and a reading/evidence panel on the right — so the two pages stay identical to
// interact with. The V1 pages do not use anything in this file.

// TopNav is sticky; the sidebar and the docked panel stick right below it.
const NAV_H = "57px";

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
    <div className="min-h-screen bg-[#F2F7F9]">
      <div className="mx-auto flex w-full max-w-[1600px]">
        <aside
          className="hidden w-[264px] shrink-0 self-start border-r border-[#D6E6EE] bg-white lg:sticky lg:block lg:overflow-y-auto"
          style={{ top: NAV_H, height: `calc(100vh - ${NAV_H})` }}
        >
          {sidebar}
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
        {panel ? (
          <>
            {/* Below xl the panel becomes a full height drawer; the backdrop closes it. */}
            <div
              className="fixed inset-0 z-[55] bg-[#031B34]/50 backdrop-blur-sm xl:hidden"
              onClick={onClosePanel}
            />
            <aside className="fixed bottom-0 right-0 top-0 z-[56] w-full max-w-[520px] overflow-y-auto border-l border-[#D6E6EE] bg-white shadow-lg xl:sticky xl:bottom-auto xl:top-[57px] xl:z-auto xl:h-[calc(100vh-57px)] xl:w-[480px] xl:max-w-none xl:shrink-0 xl:self-start xl:shadow-none">
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
    <div className="px-3 pt-5">
      <div className="mb-2 px-2 text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-zinc-400">
        {title}
      </div>
      {children}
    </div>
  );
}

/** A row in the sidebar: label + count, highlighted when selected. */
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
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-[6px] px-2.5 py-2 text-left text-[13px] font-semibold transition-colors ${
        active ? "bg-[#0A7A8A] text-white" : "text-zinc-700 hover:bg-[#E1F4F3]"
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count !== undefined && (
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
            active ? "bg-white/20 text-white" : "bg-[#F2F7F9] text-zinc-400"
          }`}
        >
          {count}
        </span>
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
    <label className="flex cursor-pointer items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-[12.5px] text-zinc-600 hover:bg-[#F2F7F9]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-[#0A7A8A]"
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
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-40"
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#052A4E"
        strokeWidth="2.4"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[8px] border border-[#D6E6EE] bg-white py-2.5 pl-9 pr-3 text-[13px] shadow-sm outline-none focus:border-[#3FD0C9] focus:ring-2 focus:ring-[#3FD0C9]/25"
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
    <div className="border-b border-[#D6E6EE] bg-[#F4FBFC] px-6 py-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-[#0A7A8A]">
          {eyebrow}
        </span>
        <button
          onClick={onClose}
          className="rounded-[4px] px-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
        >
          Close ✕
        </button>
      </div>
      <h2 className="text-[17px] font-extrabold leading-snug text-[#052A4E]">{title}</h2>
      {children}
    </div>
  );
}

/** Small rounded status/category pill, shared look across both V2 pages. */
export function Pill({
  tone,
  title,
  children,
}: {
  tone: "teal" | "green" | "amber" | "red" | "gray";
  title?: string;
  children: React.ReactNode;
}) {
  const cls =
    tone === "green"
      ? "bg-[#DFF3E4] text-[#1B7A3D]"
      : tone === "amber"
      ? "bg-[#FBEED6] text-[#8A5A0B]"
      : tone === "red"
      ? "bg-[#F3E0E0] text-[#9A2A2A]"
      : tone === "gray"
      ? "bg-zinc-100 text-zinc-500"
      : "bg-[#E1F4F3] text-[#0A7A8A]";
  return (
    <span
      title={title}
      className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${cls}`}
    >
      {children}
    </span>
  );
}

/** The Reviewer field as it appears at the bottom of both V2 sidebars. */
export function SideReviewer({
  value,
  onChange,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  hint: string;
}) {
  return (
    <div className="mx-3 mb-5 mt-6 rounded-[8px] border border-[#D6E6EE] bg-[#F4FBFC] p-3">
      <label className="mb-1 block text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-[#0A7A8A]">
        Reviewer
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Your name"
        className="w-full rounded-[6px] border border-[#B7D9DE] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[#3FD0C9]"
      />
      <p className="mt-1.5 text-[10.5px] leading-snug text-zinc-400">{hint}</p>
    </div>
  );
}
