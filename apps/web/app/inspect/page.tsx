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
        <div className="mx-auto max-w-3xl px-5 py-14">
          <h1 className="text-3xl font-semibold tracking-tight">Open the execution record.</h1>
          <p className="mt-3 font-mono text-sm text-muted-foreground">loading…</p>
        </div>
      }
    >
      <Inspector />
    </Suspense>
  );
}
