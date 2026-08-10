/**
 * The escalation store, on MongoDB.
 *
 * Durable for the same reason the ledger is: a pending escalation is money that
 * has not moved yet and a decision nobody has made. Losing it on a restart
 * would silently drop an operator's outstanding work, and the spend behind it
 * would have to be re-requested by an agent that already believed it had asked.
 *
 * The channel log is append-only via `$push`. It is the audit trail for a
 * control, and a trail you can rewrite is not one.
 */

import type { Collection, Db, MongoClient } from "mongodb";

import type { ChannelLogEntry, EscalationRecord, EscalationStatus } from "./types.ts";
import type { EscalationStore } from "./service.ts";

export async function mongoEscalations(opts: {
  uri: string;
  db?: string;
  collection?: string;
}): Promise<EscalationStore & { close(): Promise<void> }> {
  const { MongoClient } = await import("mongodb");
  const client: MongoClient = new MongoClient(opts.uri, { serverSelectionTimeoutMS: 15_000 });
  await client.connect();

  const db: Db = client.db(opts.db ?? "outcome");
  const coll: Collection<EscalationRecord> = db.collection(
    `${opts.collection ?? "authority"}_escalations`
  );

  await Promise.all([
    coll.createIndex({ id: 1 }, { unique: true }).catch(() => {}),
    // The resolve path looks an escalation up by the hash of the presented
    // code, so this index is on the hot path for every operator response.
    coll.createIndex({ approvalCodeHash: 1 }).catch(() => {}),
    coll.createIndex({ status: 1, expiresAt: 1 }).catch(() => {}),
    coll.createIndex({ createdAt: -1 }).catch(() => {}),
  ]);

  const clean = { projection: { _id: 0 } } as const;

  return {
    async insert(rec) {
      await coll.insertOne({ ...rec });
    },

    async byId(id) {
      return (await coll.findOne({ id }, clean)) as EscalationRecord | null;
    },

    async byCodeHash(hash) {
      return (await coll.findOne({ approvalCodeHash: hash }, clean)) as EscalationRecord | null;
    },

    async update(id, patch, append) {
      await coll.updateOne(
        { id },
        {
          $set: { ...patch },
          ...(append ? { $push: { channelLog: append } } : {}),
        } as never
      );
    },

    async list(limit, status) {
      const rows = await coll
        .find(status ? { status } : {}, clean)
        .sort({ createdAt: -1 })
        .limit(Math.min(Math.max(limit, 1), 200))
        .toArray();
      return rows as EscalationRecord[];
    },

    async overdue(nowIso) {
      const rows = await coll
        .find({ status: "PENDING" as EscalationStatus, expiresAt: { $lte: nowIso } }, clean)
        .limit(200)
        .toArray();
      return rows as EscalationRecord[];
    },

    async close() {
      await client.close();
    },
  };
}
