"use client";

/**
 * The hero backdrop: this product's own mechanism, drawn.
 *
 * What was here before was a stock video of butterflies over a wildflower
 * meadow — 33 MB of it, from a third-party CDN, behind a headline about
 * stopping an agent from draining a wallet. It was the first thing anyone saw
 * and it said nothing true about the thing underneath. Worse than saying
 * nothing: a reader who notices the mismatch starts discounting everything
 * else on the page, and they are right to.
 *
 * So the backdrop is the fifteen-rule chain, running. Spends arrive, most pass
 * and one is refused, and the refusal stops the row dead — the same
 * short-circuit the engine performs. It is drawn from `IMPLEMENTED_RULES`, so
 * it cannot drift from the real order, and it is a few kilobytes of SVG rather
 * than a video download.
 *
 * Deliberately quiet: low contrast, slow cadence, no colour except the one
 * refusal. It is a backdrop, and a headline has to stay readable over it.
 */

import { useEffect, useRef, useState } from "react";
import { IMPLEMENTED_RULES } from "outcome-policy";

/** Rows of spends drifting up the frame. Each is one decision. */
const ROWS = 7;
const N = IMPLEMENTED_RULES.length;

type Row = {
  /** Which rule refused, or null when every rule passed. */
  stop: number | null;
  /** How many chips have filled so far. */
  at: number;
  seed: number;
};

function freshRow(seed: number): Row {
  /*
   * Roughly one in three refuses, and a refusal lands anywhere in the chain.
   * Not weighted toward the end: the point of an ordered chain is that a cheap
   * early rule can stop something before an expensive later one is consulted.
   */
  const refuses = seed % 3 === 0;
  return { stop: refuses ? seed % N : null, at: 0, seed };
}

export function HeroChain() {
  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: ROWS }, (_, i) => ({ ...freshRow(i * 7 + 3), at: (i * 5) % N }))
  );
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced.current) return;

    let tick = 0;
    const t = setInterval(() => {
      tick += 1;
      setRows((prev) =>
        prev.map((r) => {
          const limit = r.stop === null ? N : r.stop + 1;
          if (r.at < limit) return { ...r, at: r.at + 1 };
          // Hold the finished state a moment, then start a different spend.
          return tick % 11 === 0 ? freshRow(r.seed * 31 + 17) : r;
        })
      );
    }, 220);
    return () => clearInterval(t);
  }, []);

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 1200 700"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        {/* The frame's own ground, so the backdrop sits under the theme rather than on it. */}
        <linearGradient id="hero-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e4e4e4" />
          <stop offset="100%" stopColor="#d4d4d4" />
        </linearGradient>
        {/* Fades the rows out at the edges so nothing collides with the headline. */}
        <radialGradient id="hero-vignette" cx="50%" cy="45%" r="72%">
          <stop offset="0%" stopColor="#d9d9d9" stopOpacity="0.94" />
          <stop offset="55%" stopColor="#d9d9d9" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#d9d9d9" stopOpacity="0.3" />
        </radialGradient>
      </defs>

      <rect width="1200" height="700" fill="url(#hero-ground)" />

      {rows.map((r, ri) => {
        const y = 52 + ri * 96;
        return (
          <g key={ri}>
            {IMPLEMENTED_RULES.map((rule, i) => {
              const x = 40 + i * 76;
              const filled = i < r.at;
              const isStop = r.stop !== null && i === r.stop && r.at > r.stop;
              // Downstream of a refusal: never consulted, so never drawn as passed.
              const dead = r.stop !== null && i > r.stop;

              return (
                <g key={rule}>
                  <rect
                    x={x}
                    y={y}
                    width={58}
                    height={16}
                    rx={8}
                    fill={isStop ? "#c0362a" : filled ? "#ef4d23" : "#c9c9c9"}
                    opacity={isStop ? 0.5 : filled ? 0.26 : dead ? 0.1 : 0.16}
                  />
                  {isStop && (
                    <line
                      x1={x + 18}
                      y1={y + 3}
                      x2={x + 40}
                      y2={y + 13}
                      stroke="#c0362a"
                      strokeWidth="2"
                      opacity="0.55"
                    />
                  )}
                </g>
              );
            })}
          </g>
        );
      })}

      <rect width="1200" height="700" fill="url(#hero-vignette)" />
    </svg>
  );
}
