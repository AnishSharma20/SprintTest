"use client";

import { useState } from "react";
import AkbmLogo from "../AkbmLogo";

export default function Login() {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [feil, setFeil] = useState("");
  const [sender, setSender] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFeil("");
    setSender(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setFeil(d.feil || "Could not sign in.");
        setSender(false);
        return;
      }
      // Full navigation, not a router push: the cookie has to be on the next request for the
      // proxy to let it through, and the destination is server rendered.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : "/";
    } catch {
      setFeil("Could not reach the server.");
      setSender(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-[#031B34] via-[#052A4E] to-[#06456B]">
      <div className="mx-auto w-full max-w-5xl px-4 py-6">
        <AkbmLogo className="h-5 w-auto text-white" />
      </div>

      <div className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7FD4E6]">
            Research &amp; Content Tools
          </div>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight text-white">
            Sign in
          </h1>
          <p className="mt-3 text-sm text-[#BFE3EF]">
            This preview is shared with Aker BioMarine. Use the credentials you were given.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <div>
              <label htmlFor="user" className="mb-1 block text-xs font-semibold text-[#7FD4E6]">
                Email
              </label>
              <input
                id="user"
                type="email"
                autoFocus
                autoComplete="username"
                placeholder="name@company.com"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                className="w-full rounded-[4px] border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-[#8FB8D0] outline-none focus:border-[#3FD0C9]"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-xs font-semibold text-[#7FD4E6]">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-[4px] border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-[#8FB8D0] outline-none focus:border-[#3FD0C9]"
              />
            </div>

            {feil && (
              <p className="rounded-[4px] border border-[#E30917]/40 bg-[#E30917]/10 px-3 py-2 text-xs text-[#FFD9DB]">
                {feil}
              </p>
            )}

            <button
              type="submit"
              disabled={sender || !user || !password}
              className="w-full rounded-[4px] bg-[#3FD0C9] px-4 py-2.5 text-sm font-semibold text-[#031B34] transition-colors hover:bg-[#5FDDD7] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sender ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
