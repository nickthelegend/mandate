"use client";

/**
 * The fifteen rules, and the one that refused.
 *
 * The product's whole mechanism is an ordered chain that short-circuits: rules
 * run in sequence, and the first to fail decides. Rendering it as a list of
 * chips makes that legible in a way a verdict string cannot -- you can see how
 * far a spend got before something stopped it, and that everything after the
 * refusal was never consulted.
 *
 * Three states, and the shape carries each so it survives greyscale: passed
 * rules are filled, the refusing rule is ringed in the refusal colour, and
 * everything downstream is dimmed to say "not reached" rather than "passed".
 *
 * THE LIST COMES FROM THE ENGINE, NOT FROM HERE
 *
 * This component used to hold its own copy of the fifteen names, and six of
 * them were wrong -- `category` where the engine says `category.allow`,
 * `duplicate` where it says `duplicate.taskHash_endpoint_paramsHash`, and so
 * on. The failure was silent and total: the lookup missed, so nothing was
 * marked passed, nothing was marked failed, and the caption read "the 15 rules
 * after it were never consulted" on a chain of fifteen. A component that
 * renders a system's ordered pipeline must read that order from the system.
 */

import { useEffect, useRef, useState } from "react";
import { IMPLEMENTED_RULES } from "mandate-policy";

import { cn } from "@/lib/utils";

/** The chain, in the order the engine runs it. Its list, not a transcription. */
export const RULES = IMPLEMENTED_RULES;

/**
 * A rule id, shortened for display.
 *
 * `duplicate.taskHash_endpoint_paramsHash` is the honest id -- it names the
 * exact tuple the rule compared -- and it is also four times the width of every
 * other chip. The full id stays in the `title`, so hovering gives you the
 * thing the trace actually recorded.
 */
function label(rule: string): string {
  if (rule.startsWith("duplicate.")) return "duplicate";
  if (rule === "recipient.allowDeny") return "recipient";
  if (rule === "agent.workerAllowDeny") return "agent.worker";
  if (rule === "cooldown.sameService") return "cooldown";
  if (rule === "hardCap.absolute") return "hardCap";
  return rule;
}

export function RuleChain({
  failedAt,
  decision,
  simulated,
  className,
}: {
  /** The rule that refused, exactly as the engine named it, or null when none did. */
  failedAt: string | null;
  decision: string;
  /**
   * The revert reason, when every rule passed and the transfer itself would
   * still fail.
   *
   * Deliberately separate from `failedAt`. This is not the sixteenth rule — no
   * rule in the engine's chain can know whether a transfer would succeed, and
   * folding it in would claim the policy refused something the policy allowed.
   * Fifteen chips pass; a distinct chip after them is what stopped it.
   */
  simulated?: string | null;
  className?: string;
}) {
  const stopIndex = failedAt
    ? // Exact first. The prefix fallback covers the one rule whose id carries its
      // configuration (`duplicate.<the tuple it compared>`), which a caller may
      // reasonably hand over either whole or as the family name.
      (() => {
        const exact = RULES.indexOf(failedAt as (typeof RULES)[number]);
        if (exact >= 0) return exact;
        const family = RULES.findIndex((r) => r.split(".")[0] === failedAt.split(".")[0]);
        return family >= 0 ? family : RULES.length;
      })()
    : RULES.length;

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

  const notReached = RULES.length - stopIndex - 1;

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
              title={rule}
              /*
               * A stable hook for the chain specifically.
               *
               * Anything selecting "a span with a title" used to mean "a rule
               * chip", and that stopped being true the moment the bound bar
               * added titled marks to the same panel — a selector picked up 18
               * where the chain has 15. The chain is a named thing; it should
               * be addressable as one rather than by a coincidence of markup.
               */
              data-rule={rule}
              /*
               * The transition names opacity and transform, which are the only
               * things this animates. `transition-all` also interpolated the
               * background, so a refusal spent 200ms fading out of the pass
               * colour on its way to red -- a chip that is briefly the wrong
               * verdict. Colour here is a state, not a movement.
               */
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] transition-[opacity,transform] duration-200",
                !visible && "opacity-0 translate-y-1",
                visible && passed && "bg-[var(--brand-wash)] text-[var(--brand-ink)]",
                visible &&
                  failed &&
                  "bg-[var(--refused-wash)] text-[var(--refused)] ring-1 ring-[var(--refused-line)] font-semibold",
                visible && !passed && !failed && "bg-[var(--panel)] text-[var(--ink-4)]"
              )}
            >
              {label(rule)}
            </span>
          );
        })}

        {simulated && (
          <span
            title={simulated}
            data-rule="execution.simulated"
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] transition-[opacity,transform] duration-200",
              "bg-[var(--refused-wash)] text-[var(--refused)] ring-1 ring-[var(--refused-line)] font-semibold",
              shown < RULES.length && "opacity-0 translate-y-1"
            )}
          >
            execution.simulated
          </span>
        )}
      </div>

      <p className="mt-3 text-[12px] text-[var(--ink-3)]">
        {failedAt ? (
          <>
            Refused at <span className="font-semibold text-[var(--refused)]">{failedAt}</span>.
            {notReached > 0 ? (
              <>
                {" "}
                The {notReached} rule{notReached === 1 ? "" : "s"} after it{" "}
                {notReached === 1 ? "was" : "were"} never consulted.
              </>
            ) : (
              <> It is the last rule in the chain, so every other one had already passed.</>
            )}
          </>
        ) : simulated ? (
          <>
            All fifteen passed — the policy allowed this. KeeperHub then simulated the transfer
            against the chain and it would have failed:{" "}
            <span className="font-semibold text-[var(--refused)]">{simulated}</span>. No rule can
            know that; it is the executor&rsquo;s answer about its own wallet.
          </>
        ) : (
          <>All fifteen passed. Only then does the money move.</>
        )}
      </p>
    </div>
  );
}
