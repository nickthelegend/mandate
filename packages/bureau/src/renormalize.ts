/**
 * What happens to the score when a signal is missing.
 *
 * The naive options are both wrong. Dropping a missing feature and averaging
 * the rest pretends the missing signal was neutral. Substituting a default
 * value pretends a guess is an observation. Either way a vendor nobody knows
 * anything about scores the same as one with a clean, well-evidenced record.
 *
 * So: the point estimate is computed from observed features only, with their
 * weights renormalized to sum to one — and the weight that was renormalized
 * away is converted into variance. The more of the intended signal is absent,
 * the wider σ, and since enforcement reads the LCB, the harder it is to clear a
 * floor. Missing data tightens enforcement automatically.
 *
 *   Wobs   = Σ baseWeight over observed
 *   wnorm  = baseWeight / Wobs
 *   score  = Σ wnorm · value            (observed only; a prior never contributes its value)
 *   fmiss  = Σ baseWeight over cold-start / Wtotal
 *   Vobs   = Σ wnorm² · σ²
 *   Vmiss  = fmiss · PRIOR_STD²
 *   σ      = sqrt(Vobs + Vmiss)
 *
 * Ported from untch's `renormalize`, which implements their §12 data-source
 * fallback rule.
 */

import { COLD_START_PRIOR_STD } from "./weights.ts";

export interface UncertaintyBreakdown {
  readonly observedVariance: number;
  readonly missingSignalVariance: number;
  readonly renormalizedAwayWeight: number;
  readonly sigma: number;
}

export interface RenormalizeInput {
  readonly key: string;
  readonly value: number;
  readonly sigma: number;
  readonly baseWeight: number;
  readonly observed: boolean;
}

export interface RenormalizeOutput {
  readonly score: number;
  readonly weightApplied: Record<string, number>;
  readonly uncertainty: UncertaintyBreakdown;
}

export function renormalize(features: readonly RenormalizeInput[]): RenormalizeOutput {
  const totalWeight = features.reduce((s, f) => s + f.baseWeight, 0);
  const observed = features.filter((f) => f.observed);
  const observedWeight = observed.reduce((s, f) => s + f.baseWeight, 0);

  if (observedWeight <= 0) {
    /*
     * Nothing observed at all. There is no signal to renormalize onto, so the
     * honest answer is the neutral midpoint at maximum uncertainty, which puts
     * the LCB on the floor. A caller should read this as "no data", not as a
     * verdict about the vendor.
     */
    return {
      score: 50,
      weightApplied: Object.fromEntries(features.map((f) => [f.key, 0])),
      uncertainty: {
        observedVariance: 0,
        missingSignalVariance: COLD_START_PRIOR_STD * COLD_START_PRIOR_STD,
        renormalizedAwayWeight: 1,
        sigma: COLD_START_PRIOR_STD,
      },
    };
  }

  const weightApplied: Record<string, number> = {};
  let score = 0;
  let observedVariance = 0;

  for (const f of features) {
    if (!f.observed) {
      weightApplied[f.key] = 0;
      continue;
    }
    const w = f.baseWeight / observedWeight;
    weightApplied[f.key] = w;
    score += w * f.value;
    observedVariance += w * w * f.sigma * f.sigma;
  }

  const missingWeight = totalWeight - observedWeight;
  const fmiss = totalWeight > 0 ? missingWeight / totalWeight : 0;
  const missingSignalVariance = fmiss * COLD_START_PRIOR_STD * COLD_START_PRIOR_STD;

  return {
    score,
    weightApplied,
    uncertainty: {
      observedVariance,
      missingSignalVariance,
      renormalizedAwayWeight: fmiss,
      sigma: Math.sqrt(observedVariance + missingSignalVariance),
    },
  };
}
