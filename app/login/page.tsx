import { Suspense } from "react";
import AkbmLogo from "../AkbmLogo";
import SignInButton from "./SignInButton";

export default function Login() {
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
            This preview is shared with Aker BioMarine. Sign in with your Microsoft account to
            continue.
          </p>

          <Suspense>
            <SignInButton />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
