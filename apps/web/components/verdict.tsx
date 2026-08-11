"use client";

/**
 * How a decision looks, everywhere.
 *
 * There are exactly three answers, and the third is the interesting one. A
 * spend is approved, refused, or **held for a person** — and held is not a
 * softer refusal: nothing has been charged and nothing has moved, but the
 * question is still open. A design with two states has to file held under one
 * of the other two, and either choice is a lie about what happened.
 *
 * This replaced a proven / not-proven / awaiting mark carried over from the
 * product this used to be, where the question was whether a payment had really
 * settled. Under that vocabulary a per-call cap refusal rendered as "Not
 * proven", which describes evidence rather than a decision and reads as though
 * the authority tried and failed to check something.
 *
 * Refused is not an error colour. A refusal is the system working — it is the
 * entire point — so what carries weight is the mark's shape, not an alarm.
 *
 * And the shape carries the state, never the colour alone: a filled disc, a
 * struck ring and an open ring stay distinguishable in greyscale.
 */

import { cn } from "@/lib/utils";

export type DecisionState = "approved" | "refused" | "held";

/** What the authority's decision constants mean, as one of three states. */
export function stateOf(decision: string): DecisionState {
  if (decision === "APPROVED") return "approved";
  if (decision.startsWith("ESCALATED")) return "held";
  return "refused";
}

const LABEL: Record<DecisionState, string> = {
  approved: "Approved",
  refused: "Refused",
  held: "Held",
};

const MEANING: Record<DecisionState, string> = {
  approved: "Approved: every rule passed and the money moved",
  refused: "Refused: a rule blocked it and nothing moved",
  held: "Held for a person: nothing charged, nothing moved, still open",
};

export function VerdictMark({ state, className }: { state: DecisionState; className?: string }) {
  return (
    <span className={cn("verdict", `verdict--${state}`, className)} role="img" aria-label={MEANING[state]}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="8" />
        {state === "refused" && <path d="M3 17 L17 3" stroke="currentColor" strokeWidth="2.5" />}
      </svg>
      {LABEL[state]}
    </span>
  );
}
