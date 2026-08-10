/**
 * A receipt, and the ladder it climbs.
 *
 *   QUEUED ──▶ BATCHED ──▶ SUBMITTED ──▶ CONFIRMED
 *      └────────────────────────────────▶ DEGRADED_UNANCHORED
 *
 * The ordering encodes the thing worth stealing from untch's design: **the
 * database is the source of truth and the chain is downstream of it.** A
 * receipt is safe the instant the decision is made. Whether it ever reaches a
 * block is a separate, slower, failable question — and when the answer is no,
 * that is recorded as DEGRADED_UNANCHORED rather than swallowed or retried
 * forever.
 *
 * The inversion matters. If anchoring were on the critical path, an RPC outage
 * would stop the authority deciding, and an authority that stops deciding is
 * one that stops refusing. Making the anchor downstream means a chain problem
 * degrades the evidence, never the enforcement.
 *
 * Ported from untch's `@untch/receipt-writer` §7.4 status ladder.
 */

export type ReceiptStatus =
  | "QUEUED"
  | "BATCHED"
  | "SUBMITTED"
  | "CONFIRMED"
  | "DEGRADED_UNANCHORED";

export type BatchStatus = "PENDING" | "SUBMITTED" | "CONFIRMED" | "DEGRADED_UNANCHORED";

/**
 * What a decision committed to, reduced to what is worth anchoring.
 *
 * Deliberately not the whole decision. What goes on chain is a commitment, and
 * a commitment carrying an endpoint, a category and a payee is a commitment
 * that publishes who an operator pays and for what. The hashes prove the
 * decision without disclosing it; the full record stays in the database, where
 * it is readable by the people entitled to read it.
 */
export interface ReceiptBody {
  readonly intentHash: string;
  readonly policyId: string;
  readonly policyVersion: number;
  /** The exact ruleset bytes the decision was judged under. */
  readonly policyHash: string;
  readonly decision: string;
  readonly failedRule: string | null;
  /** Amount in base units, as a string — a receipt should not carry a float. */
  readonly amountBase: string;
  readonly recipient: string;
  readonly token: string;
  readonly agent: string;
  readonly decidedAt: string;
  /** Present only once an approved decision actually executed. */
  readonly transactionHash?: string;
}

export interface Receipt {
  readonly receiptId: string;
  readonly status: ReceiptStatus;
  readonly body: ReceiptBody;
  /** keccak of the canonical body. The leaf commits to this. */
  readonly bodyHash: string;
  readonly leaf: string;
  readonly batchId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Why it is degraded, when it is. Never a bare status with no reason. */
  readonly degradedReason?: string;
}

export interface Batch {
  readonly batchId: string;
  readonly status: BatchStatus;
  readonly root: string;
  readonly receiptIds: readonly string[];
  /** The order the leaves were rooted in. A proof is meaningless without it. */
  readonly leaves: readonly string[];
  readonly attempts: number;
  readonly transactionHash?: string;
  readonly executionId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly degradedReason?: string;
}

/** What a holder needs to prove their receipt was in an anchored batch. */
export interface AnchorProof {
  readonly receiptId: string;
  readonly leaf: string;
  readonly proof: readonly string[];
  readonly root: string;
  readonly batchId: string;
  readonly status: BatchStatus;
  readonly transactionHash?: string;
  /** True only when the root is on chain and the proof checks against it. */
  readonly anchored: boolean;
}
