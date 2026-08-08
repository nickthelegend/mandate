"use client";

/**
 * How a verdict looks, everywhere.
 *
 * Three rules, all about not overclaiming.
 *
 * There is no third state. Proven and not-proven are the only outcomes, and an
 * unreadable receipt is *not proven* rather than unknown -- an "inconclusive"
 * mark invites a human to wave it through, which is the failure being designed
 * against. "Awaiting" is a separate thing entirely: nobody has ruled yet.
 *
 * Not-proven is not an error colour. A refund is the system working. What
 * carries weight is the *absence* of the assay mark, not a red alarm.
 *
 * And the shape carries the state, never the colour alone: a filled shield, an
 * incised empty one, and a blank plate stay distinguishable in greyscale.
 */

import { cn } from "@/lib/utils";

export type VerdictShape = {
  proven: boolean;
  reason: string;
  observed: string | bigint;
  logCount?: number;
};

/** The assay mark at row scale: struck, unstruck, or not yet presented. */
export function VerdictMark({
  state,
  className,
}: {
  state: "proven" | "not_proven" | "awaiting";
  className?: string;
}) {
  const label = state === "proven" ? "assayed" : state === "not_proven" ? "no mark" : "awaiting";

  return (
    <span
      className={cn("verdict-mark", `verdict-mark--${state}`, className)}
      role="img"
      aria-label={
        state === "proven"
          ? "Assay mark struck: the transfer was proven on chain"
          : state === "not_proven"
            ? "No assay mark: the transfer was not proven"
            : "Awaiting a verdict"
      }
    >
      <svg viewBox="0 0 20 22" aria-hidden="true">
        <path d="M1 1 H19 V13 C19 18 15 20.5 10 21.5 C5 20.5 1 18 1 13 Z" />
      </svg>
      {label}
    </span>
  );
}

export function VerdictPanel({ verdict }: { verdict: VerdictShape }) {
  const { proven, reason, logCount } = verdict;

  return (
    <div className={cn("verdict-panel", !proven && "verdict-panel--unassayed")}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <VerdictMark state={proven ? "proven" : "not_proven"} />
        {logCount !== undefined && (
          <span className="figure text-xs text-[var(--quiet)]">
            {logCount} log{logCount === 1 ? "" : "s"} in this receipt
          </span>
        )}
      </div>

      <p className="mt-3 max-w-[68ch] break-words font-mono text-sm leading-relaxed text-[var(--ink)]">
        {reason}
      </p>

      {!proven && (
        <p className="mt-4 max-w-[68ch] border-t border-[var(--rule)] pt-3 text-sm leading-relaxed text-[var(--quiet)]">
          This is what a status-only check misses. A transaction can mine, return{" "}
          <code className="figure text-[var(--ink)]">status: 0x1</code>, emit no matching{" "}
          <code className="figure text-[var(--ink)]">Transfer</code>, and move nothing — and every
          rail that reads only the status byte records it as a payment.
        </p>
      )}
    </div>
  );
}

/** Kept for callers that only need the small mark. */
export function VerdictBadge({ proven, className }: { proven: boolean; className?: string }) {
  return <VerdictMark state={proven ? "proven" : "not_proven"} className={className} />;
}
