"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AkbmLogo from "./AkbmLogo";

const TABS = [
  { href: "/", label: "Scientific Studies" },
  { href: "/claims", label: "Findings Library" },
  { href: "/generator", label: "Content Generator" },
  { href: "/generator-v2", label: "Content Generator V2" },
];

export default function TopNav() {
  const pathname = usePathname();

  // The sign in screen is its own full page: showing tabs that link straight back to gated pages
  // would just bounce the visitor around.
  if (pathname === "/login") return null;

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#031B34]">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="shrink-0">
          <AkbmLogo className="h-5 w-auto text-white" />
        </Link>
        <div className="flex items-center gap-1">
          {TABS.map((t) => {
            // Exact match or a path *segment* boundary ("/generator/" not "/generator-v2") -
            // a bare startsWith would also light up "/generator" while viewing "/generator-v2".
            const aktiv =
              t.href === "/" ? pathname === "/" : pathname === t.href || pathname.startsWith(t.href + "/");
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-[4px] px-3 py-1.5 text-sm font-medium transition-colors ${
                  aktiv
                    ? "bg-[#3FD0C9] text-[#031B34]"
                    : "text-[#BFE3EF] hover:bg-white/10"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={signOut}
            className="ml-2 rounded-[4px] px-3 py-1.5 text-sm font-medium text-[#7FA6BE] transition-colors hover:bg-white/10 hover:text-[#BFE3EF]"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
