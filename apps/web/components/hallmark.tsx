"use client";

/**
 * The tape.
 *
 * A ticker did not summarise the wire, it printed it. If a broker told you the
 * trade cleared, the tape either carried the line or it did not, and the tape
 * was the thing you settled arguments with.
 *
 * That is this product, exactly. The facilitator's `success: true` is what
 * somebody says came over the wire. The receipt's logs are the tape. A
 * settlement that mined and moved nothing prints as a run with the TRANSFER
 * line missing -- and the missing line is the whole argument, so it is rendered
 * as a reserved, struck-through space rather than quietly omitted.
 *
 * Lines are drawn as text because that is what a print head produced. The state
 * survives greyscale: a printed line is set solid, an absent one is ruled
 * through.
 */

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type HallmarkProps = {
  /** What the facilitator claimed. Always printed: a claim was always made. */
  claim: string;
  /** Whether the receipt carried a matching transfer. Drives the TRANSFER line. */
  proven: boolean;
  /** The observed amount, in base units, exactly as the chain reported it. */
  observed?: string;
  /** When the verdict was reached. */
  at?: string;
  /** The verifier's own words. */
  reason?: string;
  size?: "display" | "row";
  className?: string;
};

/** One printed line of tape: a fixed-width label, then what the wire carried. */
function Line({
  label,
  children,
  tone = "ink",
}: {
  label: string;
  children: React.ReactNode;
  tone?: "ink" | "red" | "absent";
}) {
  return (
    <div className="flex gap-3 sm:gap-5">
      <span className="impression shrink-0 opacity-55">{label}</span>
      <span
        className={cn(
          "impression min-w-0 break-all",
          tone === "red" && "impression--red",
          tone === "absent" && "impression--absent"
        )}
      >
        {children}
      </span>
    </div>
  );
}

export function Hallmark({
  claim,
  proven,
  observed,
  at,
  reason,
  size = "row",
  className,
}: HallmarkProps) {
  /*
   * The head advances once when a verdict resolves -- one line of travel, not a
   * fade. A run already on screen does not re-print on scroll, and reduced
   * motion renders the settled tape.
   */
  const [settled, setSettled] = useState(true);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setSettled(false);
    const t = setTimeout(() => setSettled(true), 160);
    return () => clearTimeout(t);
  }, [proven, claim]);

  return (
    <div
      className={cn(
        "tape",
        !proven && "tape--refused",
        size === "display" && "py-7",
        className
      )}
    >
      <div
        className={cn(
          "transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]",
          settled ? "translate-y-0" : "-translate-y-1"
        )}
      >
        <Line label="CLAIM">{claim}</Line>

        {/*
         * The line the whole product turns on. Present and set solid when the
         * receipt carried it; reserved and ruled through when it did not,
         * because an omitted line reads as an oversight and a struck one reads
         * as a finding.
         */}
        {proven ? (
          <Line label="TRANSFER">{observed !== undefined ? `${observed} RECEIVED` : "RECEIVED"}</Line>
        ) : (
          <Line label="TRANSFER" tone="absent">
            NO SUCH LINE ON THIS TAPE
          </Line>
        )}

        <Line label="MOVED" tone={proven ? "ink" : "red"}>
          {observed ?? "—"}
        </Line>

        {at && <Line label="AT">{at}</Line>}
      </div>

      {reason && (
        <>
          <hr className="perforation my-4" />
          <p className="impression opacity-70">{reason}</p>
        </>
      )}
    </div>
  );
}
