"use client";

/**
 * The fifteen rules, and the one that refused.
 *
 * The product's whole mechanism is an ordered chain that short-circuits: rules
 * run in sequence, and the first to fail decides. Rendering it as a list of
 * chips makes that legible in a way a verdict string cannot — you can see how
 * far a spend got before something stopped it, and that everything after the
 * refusal was never consulted.
 *
 * Three states, and the shape carries each so it survives greyscale: passed
 * rules are filled, the refusing rule is ringed in the refusal colour, and
 * everything downstream is dimmed to say "not reached" rather than "passed".
 */

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** The chain, in the order the engine runs it. */
export const RULES = [
  "policy.active",
  "duplicate",
  "cooldown",
  "replay.contextBinding",
  "recipient",
  "agent.worker",
  "category",
  "vendor.lcbFloor",
  "intent.maxAmountBound",
  "hardCap",
  "perCall.cap",
  "budget.daily",
  "rate.limit",
  "proof.tierRequired",
  "escalate.aboveThreshold",
] as const;

export function RuleChain({
  failedAt,
  decision,
  className,
}: {
  /** The rule that refused, or null when every rule passed. */
  failedAt: string | null;
  decision: string;
  className?: string;
}) {
  const stopIndex = failedAt ? RULES.indexOf(failedAt as (typeof RULES)[number]) : RULES.length;

  /*
   * The chain fills rule by rule rather than appearing at once, because the
   * sequence is the point -- a spend gets partway and then stops. Runs once on
   * mount and once per decision change; reduced motion renders it settled.
   */
  const [shown, setShown] = useState<number>(RULES.length);
  const first = useRef(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(RULES.length);
      return;
    }
    first.current = false;
    setShown(0);
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= RULES.length) clearInterval(t);
    }, 55);
    return () => clearInterval(t);
  }, [failedAt, decision]);

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1.5">
        {RULES.map((rule, i) => {
          const failed = i === stopIndex;
          const passed = i < stopIndex;
          const visible = i < shown;
          return (
            <span
              key={rule}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] transition-all duration-200",
                !visible && "opacity-0 translate-y-1",
                visible && passed && "bg-[var(--brand-wash)] text-[var(--brand-ink)]",
                visible && failed && "bg-[var(--refused-wash)] text-[var(--refused)] ring-1 ring-[var(--refused-line)] font-semibold",
                visible && !passed && !failed && "bg-[var(--panel)] text-[var(--ink-4)]"
              )}
            >
              {rule}
            </span>
          );
        })}
      </div>

      <p className="mt-3 text-[12px] text-[var(--ink-3)]">
        {failedAt ? (
          <>
            Refused at <span className="font-semibold text-[var(--refused)]">{failedAt}</span>. The{" "}
            {RULES.length - stopIndex - 1} rules after it were never consulted.
          </>
        ) : (
          <>All fifteen passed. Only then does the money move.</>
        )}
      </p>
    </div>
  );
}
