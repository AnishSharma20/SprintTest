"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AkbmLogo from "./AkbmLogo";

const TABS = [
  { href: "/", label: "Scientific Studies" },
  { href: "/generator", label: "Deck Generator" },
];

export default function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#031B34]">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="shrink-0">
          <AkbmLogo className="h-5 w-auto text-white" />
        </Link>
        <div className="flex gap-1">
          {TABS.map((t) => {
            const aktiv =
              t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  aktiv
                    ? "bg-[#3FD0C9] text-[#031B34]"
                    : "text-[#BFE3EF] hover:bg-white/10"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
