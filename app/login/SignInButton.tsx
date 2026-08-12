"use client";

import { useSearchParams } from "next/navigation";

export default function SignInButton() {
  const params = useSearchParams();
  const next = params.get("next");
  const feil = params.get("feil");

  const href = `/api/auth/login${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="mt-6">
      {feil && (
        <p className="mb-3 rounded-[4px] border border-[#E30917]/40 bg-[#E30917]/10 px-3 py-2 text-xs text-[#FFD9DB]">
          {feil}
        </p>
      )}
      {/* Full navigation, not a client-side transition: this has to leave the site and land on
          Microsoft's own login page. */}
      <a
        href={href}
        className="flex w-full items-center justify-center gap-2.5 rounded-[4px] bg-[#3FD0C9] px-4 py-2.5 text-sm font-semibold text-[#031B34] transition-colors hover:bg-[#5FDDD7]"
      >
        <MicrosoftLogo />
        Sign in with Microsoft
      </a>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#031B34" />
      <rect x="11" y="1" width="9" height="9" fill="#031B34" />
      <rect x="1" y="11" width="9" height="9" fill="#031B34" />
      <rect x="11" y="11" width="9" height="9" fill="#031B34" />
    </svg>
  );
}
