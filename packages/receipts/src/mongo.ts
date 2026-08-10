/**
 * The receipt store, on MongoDB.
 *
 * The database is the source of truth here, not a cache in front of the chain —
 * so this is the durable write the whole design rests on. A receipt that
 * reaches this collection is safe whether or not it is ever anchored.
 */

import type { Collection, Db, MongoClient } from "mongodb";

import type { Batch, Receipt, ReceiptStatus } from "./types.ts";
import type { ReceiptStore } from "./writer.ts";

export async function mongoReceipts(opts: {
  uri: string;
  db?: string;
  collection?: string;
}): Promise<ReceiptStore & { close(): Promise<void> }> {
  const { MongoClient } = await import("mongodb");
  const client: MongoClient = new MongoClient(opts.uri, { serverSelectionTimeoutMS: 15_000 });
  await client.connect();

  const db: Db = client.db(opts.db ?? "mandate");
  const base = opts.collection ?? "authority";
  const receipts: Collection<Receipt> = db.collection(`${base}_receipts`);
  const batches: Collection<Batch> = db.collection(`${base}_batches`);

  await Promise.all([
    receipts.createIndex({ receiptId: 1 }, { unique: true }).catch(() => {}),
    receipts.createIndex({ status: 1, createdAt: 1 }).catch(() => {}),
    receipts.createIndex({ createdAt: -1 }).catch(() => {}),
    batches.createIndex({ batchId: 1 }, { unique: true }).catch(() => {}),
    batches.createIndex({ status: 1 }).catch(() => {}),
  ]);

  const clean = { projection: { _id: 0 } } as const;

  return {
    async put(r) {
      // Upsert on the derived id: the same decision recorded twice is one receipt.
      await receipts.updateOne({ receiptId: r.receiptId }, { $set: { ...r } }, { upsert: true });
    },

    async get(receiptId) {
      return (await receipts.findOne({ receiptId }, clean)) as Receipt | null;
    },

    async queued(limit) {
      // Oldest first, so the age-based flush measures the right receipt.
      const rows = await receipts
        .find({ status: "QUEUED" as ReceiptStatus }, clean)
        .sort({ createdAt: 1 })
        .limit(Math.min(Math.max(limit, 1), 500))
        .toArray();
      return rows as Receipt[];
    },

    async markBatched(receiptIds, batchId) {
      await receipts.updateMany(
        { receiptId: { $in: [...receiptIds] } },
        { $set: { status: "BATCHED" as ReceiptStatus, batchId, updatedAt: new Date().toISOString() } }
      );
    },

    async setStatus(receiptIds, status, reason) {
      await receipts.updateMany(
        { receiptId: { $in: [...receiptIds] } },
        {
          $set: {
            status,
            updatedAt: new Date().toISOString(),
            ...(reason ? { degradedReason: reason } : {}),
          },
        }
      );
    },

    async putBatch(b) {
      await batches.updateOne({ batchId: b.batchId }, { $set: { ...b } }, { upsert: true });
    },

    async getBatch(batchId) {
      return (await batches.findOne({ batchId }, clean)) as Batch | null;
    },

    async openBatches() {
      const rows = await batches
        .find({ status: { $in: ["PENDING", "SUBMITTED"] } }, clean)
        .sort({ createdAt: 1 })
        .limit(50)
        .toArray();
      return rows as Batch[];
    },

    async recent(limit) {
      const rows = await receipts
        .find({}, clean)
        .sort({ createdAt: -1 })
        .limit(Math.min(Math.max(limit, 1), 200))
        .toArray();
      return rows as Receipt[];
    },

    async close() {
      await client.close();
    },
  };
}
