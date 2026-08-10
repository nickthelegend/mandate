/**
 * The scoring model's constants, in one audited place.
 *
 * Every number here is a deliberate choice. There is no learned parameter and
 * no model anywhere in this package — changing a weight changes whether an
 * agent is allowed to pay someone, so the weights live in one file rather than
 * scattered across the feature code where a drive-by edit could move
 * enforcement without anyone noticing.
 *
 * Ported from untch's `@untch/trust-bureau` §12 weights. The structure is
 * theirs; which features are real is not, because Outcome has different data.
 */

export type FeatureSource = "observed" | "cold-start-prior";

export const OBSERVED: FeatureSource = "observed";
export const COLD_START: FeatureSource = "cold-start-prior";

/** Default z for the lower-confidence bound LCB = score − z·σ. */
export const Z_DEFAULT = 1.28;

/** Snapshot cadence, in seconds. A score is recomputed at most once per epoch. */
export const EPOCH_SECONDS = 6 * 60 * 60;

export interface VendorFeatureSpec {
  readonly key: string;
  readonly baseWeight: number;
  readonly real: boolean;
}

/**
 * The seven vendor features, base weights summing to 1.00.
 *
 * `real: true` means Outcome computes it from data it actually holds. The four
 * real ones are the ones this system is in a position to know: how often it has
 * paid this recipient, whether those payments actually landed on chain, how
 * often something went wrong, and what the payout address looks like publicly.
 *
 * `real: false` are the three that would need marketplace reputation data —
 * ratings, comparable pricing, and claim-versus-delivery consistency. KeeperHub
 * lists workflows with a price but publishes no reviews and no per-listing
 * delivery history, and a recipient is an address rather than a listing, so
 * there is no join that would make these honest. They are carried as priors so
 * their absence WIDENS σ rather than silently vanishing — a vendor we know
 * little about scores conservatively rather than neutrally.
 */
export const VENDOR_FEATURES: readonly VendorFeatureSpec[] = [
  { key: "track_record_depth", baseWeight: 0.2, real: true },
  { key: "settlement_consistency", baseWeight: 0.2, real: true },
  { key: "dispute_signal", baseWeight: 0.15, real: true },
  { key: "wallet_operational_profile", baseWeight: 0.1, real: true },
  { key: "rating_quality", baseWeight: 0.2, real: false },
  { key: "price_sanity", baseWeight: 0.075, real: false },
  { key: "claims_consistency", baseWeight: 0.075, real: false },
];

/**
 * What a cold-start feature reports: neither reward nor punishment, just the
 * absence of a signal. It is REPORTED and never enters the point estimate.
 */
export const CATEGORY_BASELINE_PRIOR = 60;

/**
 * The standard deviation of a cold-start prior, in score points.
 *
 * This is the mechanism that makes missing data tighten enforcement rather than
 * relax it. With 0.35 of the weight unavailable, this alone contributes
 * sqrt(0.35) · 22 ≈ 13 points of σ, so every score in this build carries a
 * conservative LCB even when the raw number looks fine.
 */
export const COLD_START_PRIOR_STD = 22;

/** An observed feature with n backing observations has σ = BASE/sqrt(1 + n/K) + FLOOR. */
export const FEATURE_BASE_STD = 18;
export const FEATURE_SIGMA_FLOOR = 2;

/** Observations needed for σ to roughly halve. Larger K ⇒ more evidence before we trust it. */
export const FEATURE_K: Record<string, number> = {
  track_record_depth: 8,
  settlement_consistency: 6,
  dispute_signal: 10,
  wallet_operational_profile: 4,
};

export function featureSigma(key: string, n: number): number {
  const k = FEATURE_K[key] ?? 8;
  return FEATURE_BASE_STD / Math.sqrt(1 + Math.max(0, n) / k) + FEATURE_SIGMA_FLOOR;
}

/** Receipted payments at which track-record depth saturates. */
export const TRACK_RECORD_SATURATION = 50;
/** Transaction count at which the wallet activity signal saturates. */
export const WALLET_NONCE_SATURATION = 500;
/** Disputes per 100 receipted payments at which the dispute signal hits zero. */
export const DISPUTE_RATE_SATURATION = 25;
