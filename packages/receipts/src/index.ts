/**
 * mandate-receipts — durable decision receipts, anchored downstream.
 *
 * Ported from untch's `@untch/receipt-writer`: the status ladder, the
 * database-first ordering, and the batching-under-a-merkle-root that keeps
 * anchoring affordable without making a single receipt unprovable.
 *
 * The property worth naming: a receipt is safe the instant the decision is
 * made. Anchoring is slower, failable, and explicitly allowed to fail — a
 * chain outage produces DEGRADED_UNANCHORED receipts and leaves the authority
 * deciding, rather than an authority that stops refusing because an RPC is down.
 */

export { ReceiptWriter, type ReceiptStore, type Anchorer, type WriterOptions } from "./writer.ts";
export { mongoReceipts } from "./mongo.ts";
export { keeperHubAnchorer, RECEIPT_ANCHOR_ABI, type Executor } from "./anchorer.ts";
export {
  merkleRoot,
  merkleProof,
  verifyProof,
  leafHash,
  bodyHash,
  type Hex,
} from "./merkle.ts";
export type {
  Receipt,
  ReceiptBody,
  ReceiptStatus,
  Batch,
  BatchStatus,
  AnchorProof,
} from "./types.ts";
