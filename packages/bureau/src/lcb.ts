/**
 * The enforcement primitive: LCB = score − z·σ, clamped to [0, 100].
 *
 * Enforcement reads the lower-confidence bound and never the raw score. That
 * one choice is what stops a high score built on two data points from clearing
 * a floor that a well-evidenced score of the same value would clear. The
 * uncertainty is not a footnote on the number; it is part of the number.
 *
 * Ported verbatim in behaviour from untch's `@untch/trust-bureau`. It is pure
 * arithmetic and there was nothing to adapt.
 *
 * Boundaries this guarantees:
 *   σ = 0        ⇒ LCB = score exactly. No uncertainty, no discount.
 *   σ very large ⇒ LCB falls to the floor, so enforcement tightens on its own.
 *   cold start   ⇒ the wide σ pulls the LCB well below a fine-looking score.
 */

/** Clamp into the [0, 100] score range. */
export function clamp01to100(v: number): number {
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}

export function lcb(score: number, sigma: number, z: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(sigma) || !Number.isFinite(z)) {
    throw new Error(`lcb: non-finite input (score=${score}, sigma=${sigma}, z=${z})`);
  }
  if (sigma < 0) throw new Error(`lcb: sigma must be >= 0, got ${sigma}`);
  return clamp01to100(score - z * sigma);
}

export type Band = "TRUSTED" | "STABLE" | "CAUTION" | "ELEVATED_RISK" | "HIGH_RISK";

/**
 * The band a reader sees, derived from the LCB rather than the raw score, so
 * the label already carries the uncertainty discount. Thresholds are fixed and
 * documented here; there is no learned boundary.
 */
export function bandOf(lcbValue: number): Band {
  if (lcbValue >= 80) return "TRUSTED";
  if (lcbValue >= 65) return "STABLE";
  if (lcbValue >= 50) return "CAUTION";
  if (lcbValue >= 35) return "ELEVATED_RISK";
  return "HIGH_RISK";
}
