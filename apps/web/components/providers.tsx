"use client";

/**
 * The SDK's own React provider, wired once at the root.
 *
 * `OutcomeProvider` and the hooks under it ship in `outcome-sdk/react`; nothing
 * about this site's data layer is local to this site.
 */

import type { ReactNode } from "react";
import { OutcomeProvider } from "outcome-sdk/react";
import { outcome } from "@/lib/outcome";

export function Providers({ children }: { children: ReactNode }) {
  return <OutcomeProvider client={outcome}>{children}</OutcomeProvider>;
}
