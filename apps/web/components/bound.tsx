"use client";

/**
 * The bound, drawn to scale.
 *
 * `score − 1.28 × σ = lcb, vs floor` is the most distinctive thing this
 * authority does and it was only ever a line of arithmetic. A reader has to do
 * the sum in their head to see the point, and the point is spatial: the score
 * clears the floor comfortably, and the *bound* does not, because the evidence
 * is thin. That is one glance as a picture and a paragraph as a sentence.
 *
 * Three marks on one axis, all in the same units so the comparison is honest:
 * where the raw score sits, how far uncertainty drags it down, and where the
 * floor is. The refused case is the one worth reading — a payee at 38 with a σ
 * of 17 lands under a floor of 20 while its score is nearly double it.
 *
 * Nothing here is decorative. Every pixel is a number the decision used, and
 * the widths are computed from those numbers rather than chosen to look right.
 */

import { cn } from "@/lib/utils";

export type Vendor = {
  score: number;
  sigma: number;
  lcb: number;
  floor: number;
  band: string;
  features: { key: string; value: number; weightApplied: number; observed: boolean; note: string }[];
};

/** The z for a 90% one-sided bound. The engine's constant, restated for the label. */
const Z = 1.28;

export function BoundBar({ v }: { v: Vendor }) {
  /*
   * A fixed 0–100 axis rather than one scaled to the values.
   *
   * Scores and the floor are both percentages of the same scale, so a shared
   * axis is the truthful frame — rescaling to fit would make an 8-point gap and
   * an 80-point gap look identical, which is precisely the comparison a reader
   * is here to make.
   */
  const pct = (n: number) => `${Math.max(0, Math.min(100, n))}%`;
  const clears = v.lcb >= v.floor;
  const drop = Math.max(0, v.score - v.lcb);

  return (
    <div className="mt-3">
      <div className="relative h-7">
        {/* The axis. */}
        <div className="absolute inset-x-0 top-3 h-1 rounded-full bg-[var(--panel)]" />

        {/* Everything the bound gives up to uncertainty, from lcb to score. */}
        <div
          className="absolute top-3 h-1 rounded-full bg-[var(--line-2)]"
          style={{ left: pct(v.lcb), width: pct(drop) }}
          title={`uncertainty costs ${drop.toFixed(1)} points: 1.28 × σ ${v.sigma.toFixed(1)}`}
        />

        {/* The raw score — the number enforcement deliberately does NOT use. */}
        <span
          className="absolute top-1.5 h-4 w-px bg-[var(--ink-4)]"
          style={{ left: pct(v.score) }}
          title={`score ${v.score.toFixed(1)} — not what is compared`}
        />

        {/* The bound, which is what the floor is actually compared against. */}
        <span
          className={cn(
            "absolute top-0.5 h-6 w-[3px] rounded-full",
            clears ? "bg-[var(--proven)]" : "bg-[var(--refused)]"
          )}
          style={{ left: pct(v.lcb) }}
          title={`lower bound ${v.lcb.toFixed(1)} — this is the number compared`}
        />

        {/* The floor. */}
        <span
          className="absolute top-0 h-7 border-l border-dashed border-[var(--ink-3)]"
          style={{ left: pct(v.floor) }}
          title={`floor ${v.floor}`}
        />
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-[var(--ink-4)]">
        <span>
          floor <span className="figure text-[var(--ink-3)]">{v.floor}</span>
        </span>
        <span>
          bound{" "}
          <span className={cn("figure font-semibold", clears ? "text-[var(--proven)]" : "text-[var(--refused)]")}>
            {v.lcb.toFixed(1)}
          </span>
        </span>
        <span>
          score <span className="figure text-[var(--ink-3)]">{v.score.toFixed(1)}</span>
        </span>
        <span>
          −{Z} × σ {v.sigma.toFixed(1)} ={" "}
          <span className="figure text-[var(--ink-3)]">−{drop.toFixed(1)}</span>
        </span>
      </div>

      {!clears && v.score >= v.floor && (
        /*
         * The case the whole design exists for, said out loud when it happens:
         * the score clears and the bound does not. Rendered only then, because
         * on every other decision it would be a sentence about nothing.
         */
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--ink-3)]">
          The score clears the floor and the bound does not. Enforcement compares the bound, so thin
          evidence tightens the limit instead of flattering it — which is the entire reason this
          payee is a question for a person rather than an automatic yes.
        </p>
      )}
    </div>
  );
}

/**
 * Where the missing weight went.
 *
 * Three of the seven signals have no honest source, and the interesting part is
 * not that they are absent — it is what absence *does*. Their weight is
 * renormalized across the four that are observed, so each observed signal
 * carries more than its nominal share, and σ widens to pay for the guess. Both
 * halves are visible in the data the decision already returns; neither was
 * shown.
 */
export function Renormalization({ v }: { v: Vendor }) {
  const observed = v.features.filter((f) => f.observed);
  const priors = v.features.filter((f) => !f.observed);
  if (priors.length === 0 || observed.length === 0) return null;

  const carried = observed.reduce((s, f) => s + f.weightApplied, 0);
  const nominal = 1 / v.features.length;
  const each = carried / observed.length;

  return (
    <p className="mt-3 border-t border-[var(--line)] pt-3 text-[11px] leading-relaxed text-[var(--ink-4)]">
      {priors.length} of {v.features.length} signals have no honest source, so their weight is
      renormalized across the {observed.length} that do: each observed signal now carries{" "}
      <span className="figure text-[var(--ink-3)]">{(each * 100).toFixed(1)}%</span> instead of its
      nominal <span className="figure text-[var(--ink-3)]">{(nominal * 100).toFixed(1)}%</span>, and
      the observed set carries{" "}
      <span className="figure text-[var(--ink-3)]">{(carried * 100).toFixed(0)}%</span> of the score
      between them. The missing evidence is not quietly scored as average — it widens σ, which is
      what drags the bound down.
    </p>
  );
}
