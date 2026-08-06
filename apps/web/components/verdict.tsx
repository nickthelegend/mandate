"use client";

/**
 * How a verdict looks.
 *
 * Two rules, both about not overclaiming.
 *
 * There is no third state. "Proven" and "not proven" are the only outcomes, and
 * an unreadable receipt is *not proven* rather than unknown -- an "inconclusive"
 * badge invites a human to wave it through, which is the failure being designed
 * against.
 *
 * And a not-proven verdict is not red. Red reads as *error*, and it is not one:
 * a refund is the system working. The colour that matters is the one on a
 * *proven* claim, because that is the one that moves money.
 */

import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type VerdictShape = {
  proven: boolean;
  reason: string;
  observed: string | bigint;
  logCount?: number;
};

export function VerdictBadge({ proven, className }: { proven: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs font-medium",
        proven
          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
          : "border-amber-400/30 bg-amber-400/10 text-amber-300",
        className
      )}
    >
      {proven ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
      {proven ? "proven" : "not proven"}
    </span>
  );
}

export function VerdictPanel({ verdict }: { verdict: VerdictShape }) {
  const { proven, reason, logCount } = verdict;

  return (
    <div
      className={cn(
        "rounded-xl border p-5",
        proven ? "border-emerald-400/25 bg-emerald-400/[0.04]" : "border-amber-400/25 bg-amber-400/[0.04]"
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <VerdictBadge proven={proven} />
        <span className="font-mono text-xs text-muted-foreground">
          {logCount === undefined ? null : `${logCount} log${logCount === 1 ? "" : "s"} in this receipt`}
        </span>
      </div>

      <p className="mt-3 break-words font-mono text-sm leading-relaxed text-foreground/90">{reason}</p>

      {!proven && (
        <p className="mt-4 border-t border-border/50 pt-3 text-sm leading-relaxed text-muted-foreground">
          This is what a status-only check misses. A transaction can mine, return{" "}
          <code className="font-mono text-foreground/80">status: 0x1</code>, emit no matching{" "}
          <code className="font-mono text-foreground/80">Transfer</code>, and move nothing — and every
          rail that reads only the status byte records it as a payment.
        </p>
      )}
    </div>
  );
}
