/**
 * Where a score's inputs come from.
 *
 * Two sources, both real, and the split matters. The payment history is
 * Mandate's own decision record in MongoDB — what this authority approved and
 * what it executed. The settlement outcomes and the wallet profile come from
 * the chain, because whether the money arrived is not something the authority's
 * own record is entitled to assert.
 *
 * That is the same boundary the product draws everywhere else: the executor
 * says what it sent, the chain says what moved, and the second one is the one
 * that counts.
 */

import { Contract, JsonRpcProvider, type Provider } from "ethers";
import type { Collection, Db, MongoClient } from "mongodb";

import type {
  EscalationRecord,
  PaymentRecord,
  SettlementRecord,
  WalletSignals,
} from "./features.ts";
import { epochOf, scoreVendor, type ScoreResult } from "./score.ts";

/** ERC-20 `Transfer(address,address,uint256)`. */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface BureauDataSource {
  payments(payee: string): Promise<PaymentRecord[]>;
  settlements(payee: string, payments: readonly PaymentRecord[]): Promise<SettlementRecord[]>;
  escalations(payee: string): Promise<EscalationRecord[]>;
  wallet(payee: string): Promise<WalletSignals | null>;
}

/**
 * Read a receipt and answer one question: did this transaction move the token
 * to this address?
 *
 * The same check `mandate-sdk`'s verifier performs, applied to history instead
 * of a single payment. A transaction that mined without a matching Transfer
 * answers `false` — it is not missing data, it is a settlement that paid
 * nobody, and the feature must count it as one.
 */
export async function provenAgainstChain(
  provider: Provider,
  transactionHash: string,
  token: string,
  payee: string
): Promise<boolean | null> {
  const receipt = await provider.getTransactionReceipt(transactionHash).catch(() => null);
  // Not yet mined, or the node does not have it. Unknown, and not a failure.
  if (!receipt) return null;
  if (receipt.status !== 1) return false;

  const tokenLc = token.toLowerCase();
  const payeeTopic = `0x${payee.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== tokenLc) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (log.topics[2]?.toLowerCase() !== payeeTopic) continue;
    if (BigInt(log.data) > 0n) return true;
  }
  return false;
}

export interface MongoBureauOptions {
  uri: string;
  db?: string;
  /** Collection prefix, matching the ledger's. */
  collection?: string;
  provider: JsonRpcProvider;
  /** The ERC-20 an approved spend moves. */
  token: string;
}

/**
 * The live data source: Mongo for what was decided, the chain for what happened.
 */
export async function mongoBureau(opts: MongoBureauOptions): Promise<
  BureauDataSource & { close(): Promise<void>; client: MongoClient }
> {
  const { MongoClient } = await import("mongodb");
  const client: MongoClient = new MongoClient(opts.uri, { serverSelectionTimeoutMS: 15_000 });
  await client.connect();

  const db: Db = client.db(opts.db ?? "mandate");
  const base = opts.collection ?? "authority";
  const decisions: Collection = db.collection(`${base}_decisions`);
  const escalationsColl: Collection = db.collection(`${base}_escalations`);

  return {
    client,

    async payments(payee) {
      const rows = await decisions
        .find(
          { recipient: { $regex: `^${payee}$`, $options: "i" } },
          { projection: { _id: 0, decision: 1, amount: 1, at: 1, transactionHash: 1 } }
        )
        .sort({ at: -1 })
        // Bounded: a score is a summary, and the log-scaled features saturate
        // long before this. Reading the whole history would grow unboundedly
        // for a number that stops moving.
        .limit(500)
        .toArray();
      return rows as unknown as PaymentRecord[];
    },

    async settlements(payee, payments) {
      const hashes = [...new Set(payments.map((p) => p.transactionHash).filter(Boolean))] as string[];
      // Each is one receipt read. Capped so a long history cannot turn one
      // score into hundreds of RPC calls.
      const check = hashes.slice(0, 40);
      const results = await Promise.all(
        check.map(async (h) => ({
          transactionHash: h,
          proven: await provenAgainstChain(opts.provider, h, opts.token, payee),
        }))
      );
      return results;
    },

    async escalations(payee) {
      const rows = await escalationsColl
        .find(
          { recipient: { $regex: `^${payee}$`, $options: "i" } },
          { projection: { _id: 0, status: 1 } }
        )
        .limit(200)
        .toArray();
      return rows as unknown as EscalationRecord[];
    },

    async wallet(payee) {
      try {
        const [txCount, balanceWei, code] = await Promise.all([
          opts.provider.getTransactionCount(payee),
          opts.provider.getBalance(payee),
          opts.provider.getCode(payee),
        ]);
        return {
          address: payee,
          txCount: Number(txCount),
          balanceWei: BigInt(balanceWei),
          isContract: code !== "0x",
        };
      } catch {
        // The RPC could not answer. "Not profiled" is the honest result; a
        // fabricated zero would read as a brand-new address and score it.
        return null;
      }
    },

    async close() {
      await client.close();
    },
  };
}

/**
 * Score a payee from live data, reusing a cached snapshot within the epoch.
 *
 * The cache is not only a cost control. A score that moves between two spends
 * seconds apart makes a refusal impossible to explain, so the snapshot is
 * pinned per 6-hour epoch and the decision that cites it can be reproduced.
 */
export async function scoreFromSources(
  ds: BureauDataSource,
  payee: string,
  opts: { nowMs?: number; z?: number } = {}
): Promise<ScoreResult> {
  const now = opts.nowMs ?? Date.now();
  const payments = await ds.payments(payee);
  const [settlements, escalations, wallet] = await Promise.all([
    ds.settlements(payee, payments),
    ds.escalations(payee),
    ds.wallet(payee),
  ]);
  return scoreVendor({
    subject: payee,
    payments,
    settlements,
    escalations,
    wallet,
    nowMs: now,
    ...(opts.z !== undefined ? { z: opts.z } : {}),
  });
}

export interface SnapshotStore {
  get(payee: string, epoch: number): Promise<ScoreResult | null>;
  put(r: ScoreResult): Promise<void>;
}

/** Epoch snapshots, so a decision's cited score can be looked up afterwards. */
export async function mongoSnapshots(opts: {
  uri: string;
  db?: string;
  collection?: string;
}): Promise<SnapshotStore & { close(): Promise<void> }> {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(opts.uri, { serverSelectionTimeoutMS: 15_000 });
  await client.connect();
  const coll = client
    .db(opts.db ?? "mandate")
    .collection(`${opts.collection ?? "authority"}_scores`);
  await coll.createIndex({ subject: 1, epoch: 1 }, { unique: true }).catch(() => {});

  return {
    async get(payee, epoch) {
      const row = await coll.findOne(
        { subject: payee.toLowerCase(), epoch },
        { projection: { _id: 0 } }
      );
      return (row as unknown as ScoreResult) ?? null;
    },
    async put(r) {
      await coll
        .updateOne({ subject: r.subject, epoch: r.epoch }, { $set: { ...r } }, { upsert: true })
        .catch(() => {});
    },
    async close() {
      await client.close();
    },
  };
}

export { epochOf };
