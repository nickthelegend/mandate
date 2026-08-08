import { Suspense } from "react";

import { Inspector } from "./inspector";

/*
 * useSearchParams forces a client bailout, which a statically exported route
 * cannot prerender without a boundary. The fallback is the page's own shell, so
 * the deep link from the demo does not flash empty on the way in.
 */
export default function InspectPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl px-6 py-16">
          <p className="plate-label">KeeperHub</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl">
            Open the execution record.
          </h1>
          {/* The shell the real page fills, ruled so the layout does not jump. */}
          <div className="mt-10 border-t-2 border-[var(--ribbon)]">
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-6 border-b border-[var(--perf)] py-4">
                <span className="h-3 w-32 bg-[var(--stock-edge)]" />
                <span className="h-3 flex-1 bg-[var(--stock-edge)]" />
              </div>
            ))}
          </div>
        </div>
      }
    >
      <Inspector />
    </Suspense>
  );
}
