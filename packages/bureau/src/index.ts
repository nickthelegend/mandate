/**
 * mandate-bureau — deterministic payee reliability scoring.
 *
 * Ported from untch's `@untch/trust-bureau`: the LCB enforcement primitive, the
 * weight-renormalization fallback that turns missing signal into wider
 * uncertainty, and the feature/σ shrink model. The features themselves are
 * Mandate's, computed from its own payment record and from the chain.
 *
 * This exists to make one policy rule real. `vendor.lcbFloor` was in the
 * engine's chain from the first commit and had nothing to read, so it returned
 * NO_VENDOR_FLOOR on every decision — present in the trace, inert in effect.
 */

export { lcb, clamp01to100, bandOf, type Band } from "./lcb.ts";
export {
  renormalize,
  type RenormalizeInput,
  type RenormalizeOutput,
  type UncertaintyBreakdown,
} from "./renormalize.ts";
export {
  trackRecordDepth,
  settlementConsistency,
  disputeSignal,
  walletOperationalProfile,
  coldStartFeature,
  sigmaFor,
  COLD_START_NOTE,
  type RawFeature,
  type PaymentRecord,
  type SettlementRecord,
  type EscalationRecord,
  type WalletSignals,
} from "./features.ts";
export {
  scoreVendor,
  toVendorScoreInject,
  epochOf,
  SCORE_DISCLAIMER,
  type ScoreInput,
  type ScoreResult,
  type FeatureResult,
} from "./score.ts";
export {
  mongoBureau,
  mongoSnapshots,
  scoreFromSources,
  provenAgainstChain,
  type BureauDataSource,
  type MongoBureauOptions,
  type SnapshotStore,
} from "./datasource.ts";
export {
  VENDOR_FEATURES,
  Z_DEFAULT,
  EPOCH_SECONDS,
  CATEGORY_BASELINE_PRIOR,
  COLD_START_PRIOR_STD,
  featureSigma,
  OBSERVED,
  COLD_START,
  type FeatureSource,
  type VendorFeatureSpec,
} from "./weights.ts";
