"use client";

/**
 * The hallmark strip.
 *
 * A silversmith strikes "STERLING" on a piece. That is a claim, made by the
 * party who benefits from it. The assay office scrapes the metal, tests it, and
 * only then strikes its own punch beside the maker's. You read a hallmark right
 * to left: who made it, who checked it, what standard it met, when.
 *
 * The maker's mark is always struck, because a claim is always made. The assay
 * shield is struck only when the receipt proved it -- and when it did not, the
 * shield stays an empty incised outline. That absence is the whole product:
 * the facilitator said sterling and nobody countersigned.
 *
 * Marks are drawn, not set in type. A cartouche's silhouette carries its
 * meaning, so the strip survives greyscale and a screen reader alike.
 */

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** Lozenge: the maker's own mark. Always struck. */
function MakerCartouche({ children }: { children: React.ReactNode }) {
  return (
    <span className="mark mark--maker" role="img" aria-label="Maker's mark: claimed">
      <svg viewBox="0 0 40 44" aria-hidden="true" className="mark__shape">
        <path d="M20 1 L39 22 L20 43 L1 22 Z" />
      </svg>
      <span className="mark__label">{children}</span>
    </span>
  );
}

/**
 * Shield: the assay office's own punch.
 *
 * Struck when proven. When not, the same shield is drawn as an incised outline
 * with nothing inside it -- deliberately the loudest element on the page.
 */
function AssayCartouche({ struck }: { struck: boolean }) {
  return (
    <span
      className={cn("mark", struck ? "mark--assayed" : "mark--unassayed")}
      role="img"
      aria-label={struck ? "Assay mark struck: payment proven on chain" : "No assay mark: payment not proven"}
    >
      <svg viewBox="0 0 40 44" aria-hidden="true" className="mark__shape">
        <path d="M2 2 H38 V26 C38 36 30 41 20 43 C10 41 2 36 2 26 Z" />
      </svg>
      <span className="mark__label">{struck ? "ASSAYED" : "NO MARK"}</span>
    </span>
  );
}

export type HallmarkProps = {
  /** What the facilitator claimed. Always rendered: a claim was always made. */
  claim: string;
  /** Whether the receipt proved it. Drives the assay mark. */
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
   * A mark is struck once, on resolve -- a punch and a hammer, one blow. It is
   * not an entrance animation: a strip that was already on screen does not
   * re-strike on scroll, and reduced motion renders the settled state.
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
    const t = setTimeout(() => setSettled(true), 150);
    return () => clearTimeout(t);
  }, [proven, claim]);

  return (
    <div
      className={cn(
        "hallmark",
        size === "display" && "hallmark--display",
        !settled && "hallmark--striking",
        className
      )}
    >
      <div className="hallmark__strip">
        <MakerCartouche>{claim}</MakerCartouche>
        <AssayCartouche struck={proven} />
        {observed !== undefined && (
          <span className="mark mark--standard">
            <span className="mark__rubric">observed</span>
            <span className="mark__figure">{observed}</span>
          </span>
        )}
        {at && (
          <span className="mark mark--date" role="img" aria-label={`Struck ${at}`}>
            <svg viewBox="0 0 40 44" aria-hidden="true" className="mark__shape">
              <rect x="2" y="2" width="36" height="40" rx="2" />
            </svg>
            <span className="mark__label">{at}</span>
          </span>
        )}
      </div>

      {reason && <p className="hallmark__reason">{reason}</p>}
    </div>
  );
}
