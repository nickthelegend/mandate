/**
 * The spend ledger, made durable.
 *
 * `mandate-policy` judges an intent against a `LedgerWindowState` -- how much
 * has been spent today, which intents are inside their duplicate window, when
 * each service was last called, how many calls landed in the trailing hour. The
 * engine is pure and takes that state as an argument, which is right: it makes
 * the judgement testable with nothing running.
 *
 * But something has to *hold* that state, and until this file nothing did. The
 * package shipped an in-memory ledger for its tests and said so plainly in
 * `concurrency.ts`: "the ledger window is per-process and resets on restart."
 *
 * A budget that resets on restart is not a budget. It is the single defect that
 * would make the whole authority theatre -- an agent that overspends its daily
 * limit merely has to wait for a deploy, or be unlucky enough to hit a second
 * replica. Every rule that reads the ledger (`duplicate`, `cooldown`,
 * `budget.daily`, `rate.limit`) is only as real as the store behind it.
 *
 * THREE THINGS THIS GETS RIGHT THAT A COUNTER WOULD NOT
 *
 * 1. **Windows are computed at read, not maintained at write.** The trailing
 *    hour is derived from stored call timestamps and the daily budget from the
 *    stored UTC day key. A stored `callsInLastHour` integer would need a cron
 *    to decay it, and would be wrong for exactly as long as the cron was late.
 *
 * 2. **The day rolls without a job.** If the persisted day key is not today's,
 *    today's spend is zero -- read as a derivation rather than reset by a
 *    writer that might not run.
 *
 * 3. **Serialization crosses processes.** `PerAgentLock` serializes within one
 *    event loop, which is all a single instance needs and not enough for two.
 *    `concurrency.ts` names the upgrade: a lease keyed by partition, the shape
 *    `SET policyId … NX PX` gives you. There is no Redis here, so the lease is
 *    a Mongo document with a unique `_id` and a TTL index -- `insertOne` is the
 *    atomic acquire, duplicate-key is "someone else holds it", and the TTL is
 *    what stops a crashed holder from wedging a policy forever.
 *
 * The decision record is append-only and separate. Both approved and refused
 * decisions are written, because a store that only remembers the approvals
 * cannot answer the question anyone actually audits for: what did this agent
 * try to do, and what stopped it.
 */

import type { Collection, Db, MongoClient } from "mongodb";

/** Retention for the duplicate window. The rule applies the policy's own, shorter TTL on top. */
const RECENT_INTENT_RETENTION_MS = 24 * 60 * 60 * 1000;
/** The rate rule's window. Fixed by the rule, not configurable per policy. */
const RATE_WINDOW_MS = 60 * 60 * 1000;
/** How long a lease is honoured before it is assumed the holder died mid-section. */
const LEASE_TTL_MS = 15_000;

/**
 * Money, rounded to the cent it is actually denominated in.
 *
 * The engine carries display-unit amounts as JS numbers, so accumulating them
 * drifts: 1.65 + 0.20 stored as 1.8499999999999999, which then renders in a
 * budget readout and reads as a bug even though it is within a rounding error
 * of correct. Rounded at the point of accumulation rather than at the point of
 * display, because a stored total that is wrong in the twelfth decimal is still
 * a stored total that is wrong -- and it is the number a later comparison
 * against the daily limit is made from.
 */
function money(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** UTC day bucket. Must agree with `mandate-policy`'s `utcDayKey` -- same slice, same reason. */
export function utcDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** One prior intent, as the duplicate rule compares them. */
export type StoredIntent = {
  intentId: string;
  taskHash: string;
  endpoint: string;
  paramsHash: string;
  createdAtMs: number;
  maxAmount: string;
  recipientAddress: string;
  category: string;
};

/** The persisted shape. One document per partition (`policy:<id>`). */
type LedgerDoc = {
  _id: string;
  /** The UTC day the spend below belongs to. A different day means today's spend is zero. */
  dayKey: string;
  settledToday: number;
  reservedActiveToday: number;
  recentIntents: StoredIntent[];
  /**
   * Cooldown clocks as pairs, not a map.
   *
   * The engine keys this by the endpoint's canonical host, which contains dots,
   * and a dotted key in a Mongo document is a path expression waiting to be
   * misread. Escaping the dots would work and would need the exact inverse
   * applied on every read -- two places to keep in step, and the failure when
   * they drift is silent: the lookup misses, the rule sees "no prior call", and
   * the cooldown it exists to enforce never fires. Pairs have no escaping to
   * get wrong.
   */
  lastCallByService: { host: string; atMs: number }[];
  /** Epoch ms per approved call. The trailing-hour count is derived from this. */
  calls: number[];
  /** Intent hashes already decided, so a replay is recognised across restarts. */
  replayHashes: string[];
  updatedAt: Date;
};

/** What the engine needs, in the shape `evaluateIntent` reads. */
export type LedgerWindow = {
  budgetUsage: { settledToday: number; reservedActiveToday: number; effectiveToday: number };
  recentIntents: StoredIntent[];
  lastCallByService: Record<string, number>;
  callsInLastHour: number;
  seenIntentHashes: string[];
};

/** The effects an approved decision applies, as `mandate-policy` proposes them. */
export type EffectsToApply = {
  partitionKey: string;
  duplicate: { recentIntent: StoredIntent };
  rate: { atMs: number };
  budget: { dayKey: string; amount: number };
  cooldown: { serviceHost: string; atMs: number };
  replay: { intentHash: string };
};

/**
 * One rule's verdict, plus whatever detail that rule recorded.
 *
 * The detail fields are the engine's own (§8.2): a rule that compares a number
 * fills `observed` and `limit`, the allow/deny rules fill `matchedList`, and so
 * on. Carrying them means a reader can see *how far over* a refused spend was,
 * not merely that it was refused -- which is the difference between a verdict
 * and an explanation.
 */
export type RuleTrace = {
  rule: string;
  result: string;
  observed?: string | number;
  limit?: string | number;
  token?: string;
  matchedList?: string;
  cooldownRemainingSec?: number;
  ttlRemainingSec?: number;
  priorIntentId?: string;
  note?: string;
};

/** The detail fields worth carrying onto the wire, in the order a reader wants them. */
export const RULE_DETAIL_FIELDS = [
  "observed",
  "limit",
  "token",
  "matchedList",
  "cooldownRemainingSec",
  "ttlRemainingSec",
  "priorIntentId",
  "note",
] as const;

/** Narrow an engine trace entry to `RuleTrace`, keeping only the fields it actually set. */
export function toRuleTrace(entry: Record<string, unknown>): RuleTrace {
  const out: RuleTrace = { rule: String(entry.rule), result: String(entry.result) };
  for (const k of RULE_DETAIL_FIELDS) {
    if (entry[k] !== undefined) (out as Record<string, unknown>)[k] = entry[k];
  }
  return out;
}

/** One decision, as recorded. Append-only: no update path, no delete path. */
export type DecisionRecord = {
  at: string;
  partitionKey: string;
  policyId: string;
  policyVersion: number;
  intentHash: string;
  decision: string;
  failedRule: string | null;
  reason: string;
  amount: number;
  recipient: string;
  endpoint: string;
  category: string;
  /**
   * The full rule trace, so the record answers "why" and not only "what".
   * Each entry carries whatever §8.2 detail its rule recorded -- `observed`
   * against `limit` on the ones that compare a number, and so on.
   */
  rules: RuleTrace[];
  /** Present only when the decision authorised an execution that actually ran. */
  executionId?: string;
  transactionHash?: string;
};

export type SpendLedger = {
  read(partitionKey: string, nowMs?: number): Promise<LedgerWindow>;
  apply(effects: EffectsToApply): Promise<void>;
  record(entry: DecisionRecord): Promise<void>;
  /** Newest first -- a reader of a decision log wants the last thing that happened. */
  decisions(limit: number, partitionKey?: string): Promise<DecisionRecord[]>;
  /** Every decision on record for this partition, for the counters a console shows. */
  stats(partitionKey: string, nowMs?: number): Promise<{
    total: number;
    approved: number;
    refused: number;
    spentToday: number;
    dayKey: string;
  }>;
  /** Run `task` holding the cross-process lease for this partition. */
  withLease<T>(partitionKey: string, task: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

export class LeaseUnavailable extends Error {
  // Declared rather than a constructor parameter property: this module is run
  // directly under `--experimental-strip-types`, which cannot compile those.
  readonly partitionKey: string;

  constructor(partitionKey: string) {
    super(`another request is already deciding for ${partitionKey}; retry`);
    this.name = "LeaseUnavailable";
    this.partitionKey = partitionKey;
  }
}

/**
 * Derive the engine's window from the stored document.
 *
 * Every window is computed here rather than maintained by a writer. That is the
 * property that makes the store correct without a scheduled job: an instance
 * that has been down for a week reads the same answer as one that never
 * stopped, because nothing was relying on it to have been running.
 */
function windowFrom(doc: LedgerDoc | null, nowMs: number): LedgerWindow {
  if (!doc) {
    return {
      budgetUsage: { settledToday: 0, reservedActiveToday: 0, effectiveToday: 0 },
      recentIntents: [],
      lastCallByService: {},
      callsInLastHour: 0,
      seenIntentHashes: [],
    };
  }

  // A stale day key means the budget window has rolled. Nothing had to reset it.
  const today = utcDayKey(nowMs);
  const settledToday = doc.dayKey === today ? doc.settledToday : 0;
  const reservedActiveToday = doc.dayKey === today ? doc.reservedActiveToday : 0;

  return {
    budgetUsage: {
      settledToday: money(settledToday),
      reservedActiveToday: money(reservedActiveToday),
      effectiveToday: money(settledToday + reservedActiveToday),
    },
    recentIntents: (doc.recentIntents ?? []).filter(
      (i) => nowMs - i.createdAtMs < RECENT_INTENT_RETENTION_MS
    ),
    // Back to the map the engine indexes by host, rebuilt from the stored pairs.
    lastCallByService: Object.fromEntries(
      (doc.lastCallByService ?? []).map((e) => [e.host, e.atMs])
    ),
    callsInLastHour: (doc.calls ?? []).filter((t) => nowMs - t < RATE_WINDOW_MS).length,
    seenIntentHashes: doc.replayHashes ?? [],
  };
}

/**
 * A durable ledger on MongoDB.
 *
 * `mongodb` is imported dynamically for the same reason the audit store does
 * it: importing this module must not require the driver to be installed for
 * callers that never reach for Mongo.
 */
export async function mongoLedger(opts: {
  uri: string;
  db?: string;
  collection?: string;
}): Promise<SpendLedger> {
  const { MongoClient } = await import("mongodb");
  const client: MongoClient = new MongoClient(opts.uri, { serverSelectionTimeoutMS: 15_000 });
  await client.connect();

  const db: Db = client.db(opts.db ?? "mandate");
  const base = opts.collection ?? "authority";
  const ledger: Collection<LedgerDoc> = db.collection(`${base}_ledger`);
  const log: Collection<DecisionRecord> = db.collection(`${base}_decisions`);
  const leases: Collection<{ _id: string; expiresAt: Date }> = db.collection(`${base}_leases`);

  /*
   * The TTL index is what makes a crashed holder recoverable. Mongo's TTL
   * monitor runs about once a minute, which is far slower than the 15s lease,
   * so `withLease` also treats an expired document as free rather than waiting
   * for the sweeper -- the index is the backstop, not the mechanism.
   */
  await Promise.all([
    leases.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {}),
    log.createIndex({ at: -1 }).catch(() => {}),
    log.createIndex({ partitionKey: 1, at: -1 }).catch(() => {}),
  ]);

  return {
    async read(partitionKey, nowMs = Date.now()) {
      return windowFrom(await ledger.findOne({ _id: partitionKey }), nowMs);
    },

    async apply(effects) {
      const now = effects.rate.atMs;
      const today = effects.budget.dayKey;
      const existing = await ledger.findOne({ _id: effects.partitionKey });

      /*
       * Read-modify-write rather than `$inc`, because the day-roll makes the
       * increment conditional: on a new day the stored total is not a base to
       * add to, it is a number about yesterday. This runs inside the lease, so
       * the read and the write are not racing another decider.
       */
      const rolled = !existing || existing.dayKey !== today;
      const settled = money((rolled ? 0 : existing.settledToday) + effects.budget.amount);

      const recent = [...(existing?.recentIntents ?? []), effects.duplicate.recentIntent].filter(
        (i) => now - i.createdAtMs < RECENT_INTENT_RETENTION_MS
      );
      const calls = [...(existing?.calls ?? []), now].filter((t) => now - t < RATE_WINDOW_MS);
      // Bounded: a replay list that grows forever would eventually exceed the document limit.
      const replays = [...(existing?.replayHashes ?? []), effects.replay.intentHash].slice(-500);

      const clocks = (existing?.lastCallByService ?? []).filter(
        (e) => e.host !== effects.cooldown.serviceHost
      );
      clocks.push({ host: effects.cooldown.serviceHost, atMs: effects.cooldown.atMs });

      await ledger.updateOne(
        { _id: effects.partitionKey },
        {
          $set: {
            dayKey: today,
            settledToday: settled,
            reservedActiveToday: rolled ? 0 : (existing?.reservedActiveToday ?? 0),
            recentIntents: recent,
            calls,
            replayHashes: replays,
            lastCallByService: clocks,
            updatedAt: new Date(now),
          },
        },
        { upsert: true }
      );
    },

    async record(entry) {
      await log.insertOne({ ...entry });
    },

    async decisions(limit, partitionKey) {
      const q = partitionKey ? { partitionKey } : {};
      const rows = await log
        .find(q, { projection: { _id: 0 } })
        .sort({ at: -1 })
        .limit(Math.min(Math.max(limit, 1), 200))
        .toArray();
      return rows as DecisionRecord[];
    },

    async stats(partitionKey, nowMs = Date.now()) {
      const today = utcDayKey(nowMs);
      const [total, approved, doc] = await Promise.all([
        log.countDocuments({ partitionKey }),
        log.countDocuments({ partitionKey, decision: "APPROVED" }),
        ledger.findOne({ _id: partitionKey }),
      ]);
      const w = windowFrom(doc, nowMs);
      return {
        total,
        approved,
        refused: total - approved,
        spentToday: w.budgetUsage.effectiveToday,
        dayKey: today,
      };
    },

    async withLease(partitionKey, task) {
      /*
       * The acquire is one atomic upsert: take the document if it does not
       * exist OR if the holder's lease has already expired. Mongo applies the
       * filter and the write as a single operation, so two racing instances
       * cannot both match -- the loser gets a duplicate-key error, which is
       * "someone else holds it" rather than a failure.
       *
       * That loser waits and retries instead of erroring. A lock exists to
       * serialize, and a second request arriving mid-decision is the normal
       * case it was built for -- a judge clicking twice, or two agents on one
       * policy -- not an exception the caller should have to handle. Only a
       * genuinely stuck partition, one still held after the full lease TTL has
       * been waited out, surfaces as an error.
       */
      const deadline = Date.now() + LEASE_TTL_MS;
      for (;;) {
        const now = Date.now();
        try {
          await leases.updateOne(
            { _id: partitionKey, expiresAt: { $lt: new Date(now) } },
            { $set: { expiresAt: new Date(now + LEASE_TTL_MS) } },
            { upsert: true }
          );
          break;
        } catch (e) {
          const code = (e as { code?: number; writeErrors?: { code: number }[] });
          const duplicate = code.code === 11000 || code.writeErrors?.[0]?.code === 11000;
          if (!duplicate) throw e;
          if (Date.now() >= deadline) throw new LeaseUnavailable(partitionKey);
          await new Promise((r) => setTimeout(r, 120));
        }
      }

      try {
        return await task();
      } finally {
        // Released explicitly so the next request does not wait out the TTL.
        await leases.deleteOne({ _id: partitionKey }).catch(() => {});
      }
    },

    async close() {
      await client.close();
    },
  };
}
