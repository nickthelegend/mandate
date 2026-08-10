/**
 * The scoring pipeline: history in, an enforceable lower bound out.
 *
 * Deterministic weighted arithmetic. No model, no learned parameter, nothing
 * that could return a different answer for the same inputs — the same property
 * the policy engine holds, and for the same reason: this decides whether an
 * agent may pay someone, and a probabilistic component in that path is a way to
 * be wrong about a question that has a definite answer.
 *
 * The result always carries three things the caller must not have to infer:
 * which features were observed and which are priors, the uncertainty breakdown
 * that produced σ, and the fact that enforcement reads `lcb` rather than
 * `score`. A consumer that reads the raw score and compares it to a floor has
 * silently discarded the entire uncertainty model.
 */

import { bandOf, lcb, type Band } from "./lcb.ts";
import { renormalize, type RenormalizeInput, type UncertaintyBreakdown } from "./renormalize.ts";
import {
  coldStartFeature,
  disputeSignal,
  settlementConsistency,
  sigmaFor,
  trackRecordDepth,
  walletOperationalProfile,
  type EscalationRecord,
  type PaymentRecord,
  type SettlementRecord,
  type WalletSignals,
} from "./features.ts";
import { EPOCH_SECONDS, OBSERVED, VENDOR_FEATURES, Z_DEFAULT, type FeatureSource } from "./weights.ts";

export interface FeatureResult {
  readonly key: string;
  readonly value: number;
  readonly sigma: number;
  readonly source: FeatureSource;
  readonly implemented: boolean;
  readonly baseWeight: number;
  readonly weightApplied: number;
  readonly n: number;
  readonly note: string;
}

export interface ScoreResult {
  readonly subject: string;
  readonly score: number;
  readonly sigma: number;
  /** The enforcement number. Every floor comparison uses this, never `score`. */
  readonly lcb: number;
  readonly band: Band;
  readonly z: number;
  readonly epoch: number;
  readonly computedAtMs: number;
  readonly features: readonly FeatureResult[];
  readonly uncertainty: UncertaintyBreakdown;
  readonly disclaimer: string;
}

export const SCORE_DISCLAIMER =
  "Computed by deterministic weighted arithmetic over this system's own payment history and public " +
  "chain data. No model is involved. Enforcement reads `lcb` (score minus z*sigma), never `score`: " +
  "a high score built on little evidence carries a wide sigma and a low bound, by design.";

/** The 6-hour epoch a timestamp falls in, so a snapshot is addressable. */
export function epochOf(atMs: number): number {
  return Math.floor(Math.floor(atMs / 1000) / EPOCH_SECONDS);
}

export interface ScoreInput {
  readonly subject: string;
  readonly payments: readonly PaymentRecord[];
  readonly settlements: readonly SettlementRecord[];
  readonly escalations: readonly EscalationRecord[];
  /** `null` when the payout address was not profiled — never fabricated. */
  readonly wallet: WalletSignals | null;
  readonly z?: number;
  readonly nowMs?: number;
}

/**
 * Score a payee.
 *
 * Pure: every input is passed in, nothing is fetched here. That keeps the model
 * testable with nothing running and keeps I/O — Mongo reads, RPC calls — at the
 * edge where it can be seen.
 */
export function scoreVendor(input: ScoreInput): ScoreResult {
  const z = input.z ?? Z_DEFAULT;
  const now = input.nowMs ?? Date.now();

  const raw = {
    track_record_depth: trackRecordDepth(input.payments),
    settlement_consistency: settlementConsistency(input.settlements),
    dispute_signal: disputeSignal(input.payments, input.settlements, input.escalations),
    wallet_operational_profile: walletOperationalProfile(input.wallet),
  } as const;

  const built = VENDOR_FEATURES.map((spec) => {
    if (!spec.real) return coldStartFeature(spec.key, spec.baseWeight);
    const f = raw[spec.key as keyof typeof raw];
    return {
      key: spec.key,
      value: f.value,
      sigma: sigmaFor(spec.key, f.n),
      source: OBSERVED,
      implemented: true as const,
      baseWeight: spec.baseWeight,
      n: f.n,
      note: f.note,
    };
  });

  const inputs: RenormalizeInput[] = built.map((f) => ({
    key: f.key,
    value: f.value,
    sigma: f.sigma,
    baseWeight: f.baseWeight,
    observed: f.source === OBSERVED,
  }));

  const { score, weightApplied, uncertainty } = renormalize(inputs);
  const bound = lcb(score, uncertainty.sigma, z);

  return {
    subject: input.subject.toLowerCase(),
    score,
    sigma: uncertainty.sigma,
    lcb: bound,
    band: bandOf(bound),
    z,
    epoch: epochOf(now),
    computedAtMs: now,
    features: built.map((f) => ({ ...f, weightApplied: weightApplied[f.key] ?? 0 })),
    uncertainty,
    disclaimer: SCORE_DISCLAIMER,
  };
}

/**
 * The shape the policy engine's `vendor.lcbFloor` rule reads.
 *
 * Deliberately narrow. The rule needs the bound, the raw score, σ, when it was
 * computed, and whether it is available at all — and nothing else. Handing it
 * the whole result would let a future rule reach past the bound into the raw
 * score, which is exactly the mistake the bound exists to prevent.
 */
export function toVendorScoreInject(r: ScoreResult): {
  vendorId: string;
  lcb: number;
  score: number;
  sigma: number;
  computedAtMs: number;
  available: true;
} {
  return {
    vendorId: r.subject,
    lcb: r.lcb,
    score: r.score,
    sigma: r.sigma,
    computedAtMs: r.computedAtMs,
    available: true,
  };
}
