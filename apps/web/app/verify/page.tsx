import { Suspense } from "react";

import { Verifier } from "./verifier";

/*
 * useSearchParams forces a client bailout, which a statically exported route
 * cannot prerender without a boundary. The fallback is the page's own opening,
 * so the deep link from the execution record does not flash empty on the way in.
 */
export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl px-5 py-14">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">
            Check a payment yourself.
          </h1>
          {/* The shell the form fills, ruled so the layout does not jump. */}
          <div className="mt-14 space-y-4">
            <div className="h-10 bg-[var(--surface)]" />
            <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
              <div className="h-10 bg-[var(--surface)]" />
              <div className="h-10 bg-[var(--surface)]" />
            </div>
          </div>
        </div>
      }
    >
      <Verifier />
    </Suspense>
  );
}
