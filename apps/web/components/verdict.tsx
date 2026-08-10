"use client";

/**
 * How a verdict looks, everywhere.
 *
 * Three rules, all about not overclaiming.
 *
 * There is no third state. Proven and not-proven are the only mandates, and an
 * unreadable receipt is *not proven* rather than unknown -- an "inconclusive"
 * mark invites a human to wave it through, which is the failure being designed
 * against. "Awaiting" is a separate thing entirely: nobody has ruled yet.
 *
 * Not-proven is not an error colour. A refund is the system working. What
 * carries weight is the *absence* of a matching transfer, not a red alarm.
 *
 * And the shape carries the state, never the colour alone: a filled disc, a
 * struck ring and an open ring stay distinguishable in greyscale.
 */

import { cn } from "@/lib/utils";

export type VerdictShape = {
  proven: boolean;
  reason: string;
  observed: string | bigint;
  logCount?: number;
};

/**
 * The verdict pill.
 *
 * Three silhouettes, not three colours: a filled disc for proven, a struck ring
 * for refused, an open ring for not yet ruled. The state survives greyscale.
 */
export function VerdictMark({
  state,
  className,
}: {
  state: "proven" | "not_proven" | "awaiting";
  className?: string;
}) {
  const label = state === "proven" ? "Proven" : state === "not_proven" ? "Not proven" : "Awaiting";

  return (
    <span
      className={cn("verdict", `verdict--${state}`, className)}
      role="img"
      aria-label={
        state === "proven"
          ? "Proven: the transfer was found in the receipt"
          : state === "not_proven"
            ? "Not proven: no matching transfer in the receipt"
            : "Awaiting a verdict"
      }
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8" />
        {state === "not_proven" && <path d="M3 17 L17 3" stroke="currentColor" strokeWidth="2.5" />}
      </svg>
      {label}
    </span>
  );
}

export function VerdictPanel({ verdict }: { verdict: VerdictShape }) {
  const { proven, reason, logCount } = verdict;

  return (
    <div className={cn("settlement", proven ? "settlement--proven" : "settlement--refused")}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <VerdictMark state={proven ? "proven" : "not_proven"} />
        {logCount !== undefined && (
          <span className="figure text-xs text-[var(--ink-3)]">
            {logCount} log{logCount === 1 ? "" : "s"} in this receipt
          </span>
        )}
      </div>

      <p className="mt-3 max-w-[68ch] break-words font-mono text-sm leading-relaxed text-[var(--ink)]">
        {reason}
      </p>

      {!proven && (
        <p className="mt-4 max-w-[68ch] border-t border-[var(--line)] pt-3 text-sm leading-relaxed text-[var(--ink-3)]">
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
