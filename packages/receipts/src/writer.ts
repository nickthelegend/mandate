/**
 * The receipt writer.
 *
 * Enqueue is the only thing on the decision's critical path, and it does one
 * durable write. Batching, anchoring and confirmation are all downstream, run
 * by `tick()`, and every one of them is allowed to fail without touching the
 * decision that produced the receipt.
 *
 * That split is the design. An authority whose anchoring is synchronous stops
 * deciding when the chain is slow, and an authority that stops deciding stops
 * refusing — the failure mode points the wrong way. Here a chain outage
 * degrades the evidence and leaves enforcement untouched.
 *
 * Ported from untch's `@untch/receipt-writer`, minus BullMQ: the tick is called
 * by whatever already runs (a request, a timer, a cron) rather than requiring
 * Redis. untch is explicit that the queue is a latency optimisation and not the
 * record, so dropping it costs promptness and nothing else.
 */

import { bodyHash as canonicalBodyHash, leafHash, merkleProof, merkleRoot, verifyProof, type Hex } from "./merkle.ts";
import type { AnchorProof, Batch, Receipt, ReceiptBody, ReceiptStatus } from "./types.ts";

/** Storage. Implemented against Mongo in `mongo.ts`. */
export interface ReceiptStore {
  put(r: Receipt): Promise<void>;
  get(receiptId: string): Promise<Receipt | null>;
  queued(limit: number): Promise<Receipt[]>;
  markBatched(receiptIds: readonly string[], batchId: string): Promise<void>;
  setStatus(receiptIds: readonly string[], status: ReceiptStatus, reason?: string): Promise<void>;
  putBatch(b: Batch): Promise<void>;
  getBatch(batchId: string): Promise<Batch | null>;
  openBatches(): Promise<Batch[]>;
  recent(limit: number): Promise<Receipt[]>;
}

/** How the root reaches the chain. Injected, so the writer never holds a key. */
export interface Anchorer {
  anchor(root: string, batchId: string): Promise<{ transactionHash?: string; executionId?: string }>;
  /** Whether a submitted transaction is now final. */
  confirmed(transactionHash: string): Promise<boolean>;
}

export interface WriterOptions {
  /** Anchor once this many receipts are waiting. */
  readonly batchSize?: number;
  /** …or once the oldest has waited this long, whichever comes first. */
  readonly maxWaitMs?: number;
  /** Give up anchoring a batch after this many attempts. */
  readonly maxAttempts?: number;
  readonly clock?: () => number;
}

const DEFAULTS = { batchSize: 4, maxWaitMs: 2 * 60_000, maxAttempts: 3 };

export class ReceiptWriter {
  private readonly store: ReceiptStore;
  private readonly anchorer: Anchorer | null;
  private readonly opts: Required<Omit<WriterOptions, "clock">>;
  private readonly clock: () => number;

  constructor(store: ReceiptStore, anchorer: Anchorer | null, options: WriterOptions = {}) {
    this.store = store;
    this.anchorer = anchorer;
    this.opts = {
      batchSize: options.batchSize ?? DEFAULTS.batchSize,
      maxWaitMs: options.maxWaitMs ?? DEFAULTS.maxWaitMs,
      maxAttempts: options.maxAttempts ?? DEFAULTS.maxAttempts,
    };
    this.clock = options.clock ?? Date.now;
  }

  /**
   * Record a decision. One write, then return.
   *
   * Never throws into the caller's path on an anchoring problem, because there
   * is no anchoring here to have a problem. The receipt is durable when this
   * resolves.
   */
  async enqueue(body: ReceiptBody): Promise<{ receiptId: string; status: "QUEUED" }> {
    const now = new Date(this.clock()).toISOString();
    const bh = canonicalBodyHash(body);
    /*
     * The id is derived from the intent hash and the decision time rather than
     * randomly, so the same decision recorded twice collides instead of
     * producing two receipts for one event.
     */
    const receiptId = canonicalBodyHash({ intentHash: body.intentHash, decidedAt: body.decidedAt });

    await this.store.put({
      receiptId,
      status: "QUEUED",
      body,
      bodyHash: bh,
      leaf: leafHash(receiptId, bh),
      batchId: null,
      createdAt: now,
      updatedAt: now,
    });
    return { receiptId, status: "QUEUED" };
  }

  /**
   * Move everything one step: batch what is waiting, submit what is batched,
   * confirm what is submitted.
   *
   * Safe to call concurrently and safe to call constantly — each step is a
   * no-op when there is nothing to do.
   */
  async tick(): Promise<{ batched: number; submitted: number; confirmed: number; degraded: number }> {
    const out = { batched: 0, submitted: 0, confirmed: 0, degraded: 0 };

    // 1. Batch, on size or on age. Age matters: a quiet day must still anchor.
    const queued = await this.store.queued(this.opts.batchSize * 4);
    const oldest = queued[queued.length - 1];
    const aged = oldest ? this.clock() - Date.parse(oldest.createdAt) >= this.opts.maxWaitMs : false;

    if (queued.length >= this.opts.batchSize || (queued.length > 0 && aged)) {
      const take = queued.slice(0, this.opts.batchSize);
      const leaves = take.map((r) => r.leaf as Hex);
      const root = merkleRoot(leaves);
      if (root) {
        const now = new Date(this.clock()).toISOString();
        const batchId = canonicalBodyHash({ root, at: now });
        await this.store.putBatch({
          batchId,
          status: "PENDING",
          root,
          receiptIds: take.map((r) => r.receiptId),
          // Stored because a proof cannot be rebuilt without the original order.
          leaves,
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        });
        await this.store.markBatched(take.map((r) => r.receiptId), batchId);
        out.batched = take.length;
      }
    }

    // 2 and 3. Push open batches along.
    for (const batch of await this.store.openBatches()) {
      if (batch.status === "PENDING") {
        if (!this.anchorer) continue; // Nothing to anchor with; stay PENDING.
        if (batch.attempts >= this.opts.maxAttempts) {
          /*
           * Out of attempts. The receipts are still durable and still readable;
           * what they have lost is the chain anchor, and saying so is the whole
           * point of having a name for it.
           */
          const reason = `anchoring failed after ${batch.attempts} attempts`;
          await this.store.putBatch({ ...batch, status: "DEGRADED_UNANCHORED", degradedReason: reason, updatedAt: new Date(this.clock()).toISOString() });
          await this.store.setStatus(batch.receiptIds, "DEGRADED_UNANCHORED", reason);
          out.degraded += batch.receiptIds.length;
          continue;
        }
        try {
          const res = await this.anchorer.anchor(batch.root, batch.batchId);
          await this.store.putBatch({
            ...batch,
            status: "SUBMITTED",
            attempts: batch.attempts + 1,
            ...(res.transactionHash ? { transactionHash: res.transactionHash } : {}),
            ...(res.executionId ? { executionId: res.executionId } : {}),
            updatedAt: new Date(this.clock()).toISOString(),
          });
          await this.store.setStatus(batch.receiptIds, "SUBMITTED");
          out.submitted += batch.receiptIds.length;
        } catch (e) {
          // Count the attempt and leave it PENDING for the next tick.
          await this.store.putBatch({
            ...batch,
            attempts: batch.attempts + 1,
            degradedReason: e instanceof Error ? e.message : String(e),
            updatedAt: new Date(this.clock()).toISOString(),
          });
        }
        continue;
      }

      if (batch.status === "SUBMITTED" && batch.transactionHash && this.anchorer) {
        if (await this.anchorer.confirmed(batch.transactionHash)) {
          await this.store.putBatch({ ...batch, status: "CONFIRMED", updatedAt: new Date(this.clock()).toISOString() });
          await this.store.setStatus(batch.receiptIds, "CONFIRMED");
          out.confirmed += batch.receiptIds.length;
        }
      }
    }

    return out;
  }

  /**
   * The proof a holder can check themselves.
   *
   * `anchored` is true only when the batch is CONFIRMED **and** the proof
   * actually recomputes the root. Reporting the status alone would let a bug in
   * the tree pass as anchored, so the claim is re-derived rather than trusted.
   */
  async proof(receiptId: string): Promise<AnchorProof | null> {
    const r = await this.store.get(receiptId);
    if (!r || !r.batchId) return null;
    const batch = await this.store.getBatch(r.batchId);
    if (!batch) return null;

    const index = batch.leaves.indexOf(r.leaf);
    if (index < 0) return null;
    const proof = merkleProof(batch.leaves as Hex[], index);
    const holds = verifyProof(r.leaf as Hex, proof, batch.root as Hex);

    return {
      receiptId,
      leaf: r.leaf,
      proof,
      root: batch.root,
      batchId: batch.batchId,
      status: batch.status,
      ...(batch.transactionHash ? { transactionHash: batch.transactionHash } : {}),
      anchored: holds && batch.status === "CONFIRMED",
    };
  }

  get(receiptId: string): Promise<Receipt | null> {
    return this.store.get(receiptId);
  }

  recent(limit: number): Promise<Receipt[]> {
    return this.store.recent(limit);
  }
}
