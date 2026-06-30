"use client";

import { useState } from "react";

export default function Home() {
  const [antall, setAntall] = useState(0);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-zinc-50 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-zinc-900">
        Min første app 🎉
      </h1>
      <p className="max-w-md text-lg text-zinc-600">
        Det funker! Og se nå — denne teksten endret seg helt av seg selv. ✨
      </p>
      <button
        onClick={() => setAntall(antall + 1)}
        className="rounded-full bg-zinc-900 px-8 py-4 text-lg font-medium text-white transition-colors hover:bg-zinc-700"
      >
        Trykket {antall} ganger
      </button>
    </div>
  );
}
