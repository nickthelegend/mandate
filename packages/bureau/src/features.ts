/**
 * The four things Mandate is actually in a position to know about a payee.
 *
 * Pure functions: records in, {value in [0,100], n, note} out. `n` drives the
 * per-feature σ, so a feature computed from two observations is automatically
 * less trusted than the same value computed from fifty.
 *
 * The shape is untch's. The features are not, because the data is not.
 * untch scores vendors on a marketplace it operates and can see delivery
 * outcomes for. Mandate sees payments: who it paid, whether the money arrived,
 * and what went wrong. So `delivery_consistency` — untch's T0 schema-proof pass
 * rate — becomes `settlement_consistency`, and it is checked the way this whole
 * project argues everything should be checked: against the chain, by reading
 * the receipt for a real Transfer, rather than against anybody's report that
 * the payment succeeded.
 *
 * That is the convergence worth noticing. The reliability signal for a payee is
 * the same question the product exists to answer, asked repeatedly over time.
 */

import {
  CATEGORY_BASELINE_PRIOR,
  COLD_START,
  COLD_START_PRIOR_STD,
  DISPUTE_RATE_SATURATION,
  TRACK_RECORD_SATURATION,
  WALLET_NONCE_SATURATION,
  featureSigma,
} from "./weights.ts";
import { clamp01to100 } from "./lcb.ts";

export interface RawFeature {
  readonly value: number;
  readonly n: number;
  readonly note: string;
}

/** One authorised payment to this payee, as the ledger recorded it. */
export interface PaymentRecord {
  readonly decision: string;
  readonly amount: number;
  readonly at: string;
  readonly transactionHash?: string;
}

/**
 * Whether a payment's transaction actually moved the money, read from the
 * chain. `null` means it has not been checked — never "assume it did".
 */
export interface SettlementRecord {
  readonly transactionHash: string;
  readonly proven: boolean | null;
}

/** An escalation this payee was involved in, and how it ended. */
export interface EscalationRecord {
  readonly status: string;
}

/** Public, point-in-time facts about a payout address. */
export interface WalletSignals {
  readonly address: string;
  readonly txCount: number;
  readonly balanceWei: bigint;
  readonly isContract: boolean;
}

/**
 * track_record_depth (0.20) — log-scaled count of approved, receipted payments.
 *
 * Log-scaled because the difference between one payment and ten says far more
 * than the difference between forty and fifty.
 */
export function trackRecordDepth(payments: readonly PaymentRecord[]): RawFeature {
  const n = payments.filter((p) => p.decision === "APPROVED").length;
  const value = clamp01to100((100 * Math.log1p(n)) / Math.log1p(TRACK_RECORD_SATURATION));
  return {
    value,
    n,
    note:
      n === 0
        ? "no receipted payments to this payee yet — neutral depth, wide uncertainty"
        : `${n} receipted payment(s), log-scaled to saturation ${TRACK_RECORD_SATURATION}`,
  };
}

/**
 * settlement_consistency (0.20) — of the payments this authority approved and
 * executed, how many actually moved value to this payee on chain.
 *
 * Unverified settlements are excluded from the denominator rather than counted
 * as passes. An unchecked payment is not evidence of anything, and treating it
 * as a success would make this feature reward the one failure mode the product
 * exists to catch: a settlement that reports success and pays nobody.
 */
export function settlementConsistency(settlements: readonly SettlementRecord[]): RawFeature {
  const checked = settlements.filter((s) => s.proven !== null);
  if (checked.length === 0) {
    return {
      value: 50,
      n: 0,
      note: "no settlements verified against the chain for this payee — neutral, wide uncertainty",
    };
  }
  const proven = checked.filter((s) => s.proven === true).length;
  const failed = checked.length - proven;
  const value = clamp01to100((100 * proven) / checked.length);
  return {
    value,
    n: checked.length,
    note:
      `${proven} settled / ${failed} moved nothing, of ${checked.length} verified against the chain ` +
      `(${settlements.length - checked.length} unverified, excluded rather than assumed)`,
  };
}

/**
 * dispute_signal (0.15) — escalations that ended in denial or expiry, plus
 * settlements that moved nothing, per 100 receipted payments.
 *
 * Higher disputes give a lower value. The rate is per-payment rather than
 * absolute so a busy payee is not penalised for volume.
 */
export function disputeSignal(
  payments: readonly PaymentRecord[],
  settlements: readonly SettlementRecord[],
  escalations: readonly EscalationRecord[]
): RawFeature {
  const approved = payments.filter((p) => p.decision === "APPROVED").length;
  const denied = escalations.filter((e) => e.status === "DENIED" || e.status === "EXPIRED").length;
  const movedNothing = settlements.filter((s) => s.proven === false).length;
  const disputes = denied + movedNothing;
  const ratePer100 = (100 * disputes) / Math.max(approved, 1);
  const value = clamp01to100(100 * (1 - Math.min(ratePer100 / DISPUTE_RATE_SATURATION, 1)));
  return {
    value,
    n: approved,
    note:
      `${disputes} dispute signal(s) (${denied} escalation denied/expired + ${movedNothing} moved nothing) ` +
      `over ${approved} receipted payment(s) = ${ratePer100.toFixed(1)} per 100`,
  };
}

/**
 * wallet_operational_profile (0.10) — public on-chain signals for the payout
 * address, read straight from an RPC.
 *
 * Three point-in-time facts only: transaction count, whether it holds a native
 * reserve, and whether it is a contract. Address age, transaction regularity
 * and counterparty diversity would need an indexer, so they are not claimed
 * rather than approximated. `null` means the address was not profiled.
 */
export function walletOperationalProfile(signals: WalletSignals | null): RawFeature {
  if (signals === null) {
    return {
      value: 50,
      n: 0,
      note: "payout address not profiled — neutral profile, wide uncertainty",
    };
  }
  const activity = clamp01to100(
    (100 * Math.log1p(signals.txCount)) / Math.log1p(WALLET_NONCE_SATURATION)
  );
  const reserve = signals.balanceWei > 0n ? 1 : 0;
  const value = clamp01to100(0.85 * activity + 15 * reserve);
  return {
    value,
    n: signals.txCount,
    note:
      `payout ${signals.address}: ${signals.txCount} txs, ${reserve ? "has" : "no"} native reserve, ` +
      `${signals.isContract ? "contract" : "EOA"} (age/regularity/diversity need an indexer, not claimed)`,
  };
}

export function sigmaFor(key: string, n: number): number {
  return featureSigma(key, n);
}

export const COLD_START_NOTE =
  "no reputation source for this signal. KeeperHub lists workflows with a price but publishes no " +
  "reviews and no per-listing delivery history, and a payee here is an address rather than a listing, " +
  "so there is no join that would make this honest. Reported as a category-baseline prior: its weight " +
  "is renormalized across the observed features and sigma widens instead. This is a PRIOR, not data.";

/**
 * A cold-start feature. Reports the baseline, tagged so it can never be
 * mistaken for an observation, and contributes nothing to the point estimate.
 */
export function coldStartFeature(key: string, baseWeight: number) {
  return {
    key,
    value: CATEGORY_BASELINE_PRIOR,
    sigma: COLD_START_PRIOR_STD,
    source: COLD_START,
    implemented: false as const,
    baseWeight,
    n: 0,
    note: COLD_START_NOTE,
  };
}
