/**
 * Tests for the durable spend ledger.
 *
 * Run against a real MongoDB when MONGODB_URI is set, skipped otherwise. Not
 * mocked, for the same reason the audit store is not: the entire claim this
 * file makes is "the budget survives the process", and a fake database proves
 * only that the fake was written to.
 *
 * The properties pinned here are the ones the authority is worthless without.
 * Every one of them was a real way the in-memory ledger was wrong:
 *
 *   - spend accumulates across separate connections (it reset on restart)
 *   - the day rolls on a read, with no job having run (nothing reset it)
 *   - the trailing hour decays on its own (a counter would have needed a cron)
 *   - the cooldown host round-trips exactly (a dotted key would have silently
 *     missed, and the rule would have read "never called")
 *   - two racing decisions serialize (they could both pass a budget check)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { mongoLedger, utcDayKey, type EffectsToApply, type SpendLedger } from "../src/ledger.ts";

const URI = process.env.MONGODB_URI;
const DB = "mandate_test";
const skip = URI ? false : "MONGODB_URI is not set";

/** A fresh partition per test, so a rerun never reads the last run's spend. */
let n = 0;
const partition = () => `policy:test-${process.pid}-${Date.now()}-${n++}`;

const effects = (
  partitionKey: string,
  amount: number,
  atMs: number,
  over: Partial<{ host: string; hash: string; endpoint: string }> = {}
): EffectsToApply => ({
  partitionKey,
  duplicate: {
    recentIntent: {
      intentId: `pi_${(over.hash ?? "0xaa").slice(2, 10)}`,
      taskHash: `0x${"11".repeat(32)}`,
      endpoint: over.endpoint ?? "https://api.example.com/v1/data",
      paramsHash: `0x${"55".repeat(32)}`,
      createdAtMs: atMs,
      maxAmount: "1000000",
      recipientAddress: "0x000000000000000000000000000000000000dEaD",
      category: "market-data",
    },
  },
  rate: { atMs },
  budget: { dayKey: utcDayKey(atMs), amount },
  cooldown: { serviceHost: over.host ?? "api.example.com", atMs },
  replay: { intentHash: over.hash ?? `0x${"ab".repeat(32)}` },
});

async function open(): Promise<SpendLedger> {
  return mongoLedger({ uri: URI!, db: DB, collection: `t${process.pid}` });
}

test("spend accumulates across separate connections", { skip }, async () => {
  const key = partition();
  const now = Date.now();

  // Two clients, opened and closed independently: the second is a new process
  // as far as the store is concerned.
  const a = await open();
  await a.apply(effects(key, 4, now, { hash: `0x${"01".repeat(32)}` }));
  await a.apply(effects(key, 6, now, { hash: `0x${"02".repeat(32)}` }));
  assert.equal((await a.read(key, now)).budgetUsage.effectiveToday, 10);
  await a.close();

  const b = await open();
  const w = await b.read(key, now);
  assert.equal(w.budgetUsage.effectiveToday, 10, "the budget did not survive the reconnect");
  assert.equal(w.budgetUsage.settledToday, 10);
  await b.close();
});

test("the day rolls on read, with nothing having reset it", { skip }, async () => {
  const key = partition();
  const yesterday = Date.now() - 26 * 60 * 60 * 1000;

  const l = await open();
  await l.apply(effects(key, 25, yesterday, { hash: `0x${"03".repeat(32)}` }));

  // Same stored document, read at two different times.
  assert.equal((await l.read(key, yesterday)).budgetUsage.effectiveToday, 25);
  assert.equal(
    (await l.read(key, Date.now())).budgetUsage.effectiveToday,
    0,
    "yesterday's spend is still counted against today's budget"
  );
  await l.close();
});

test("the trailing hour decays without a sweeper", { skip }, async () => {
  const key = partition();
  const now = Date.now();

  const l = await open();
  // One call now, one call ninety minutes ago.
  await l.apply(effects(key, 1, now - 90 * 60 * 1000, { hash: `0x${"04".repeat(32)}` }));
  await l.apply(effects(key, 1, now, { hash: `0x${"05".repeat(32)}` }));

  const w = await l.read(key, now);
  assert.equal(w.callsInLastHour, 1, "a call outside the window is still being counted");
  await l.close();
});

test("the cooldown host round-trips exactly, dots and all", { skip }, async () => {
  const key = partition();
  const now = Date.now();

  const l = await open();
  await l.apply(
    effects(key, 1, now, { host: "api.deep.sub.example.com", hash: `0x${"06".repeat(32)}` })
  );

  const w = await l.read(key, now);
  // The engine indexes this map by the host string itself. An escaped key,
  // or a nested object produced by Mongo reading the dots as a path, both
  // read back as undefined here -- and the cooldown rule would pass.
  assert.equal(w.lastCallByService["api.deep.sub.example.com"], now);
  await l.close();
});

test("two racing decisions serialize on the lease", { skip }, async () => {
  const key = partition();
  const l = await open();

  const order: string[] = [];
  const section = (tag: string) =>
    l.withLease(key, async () => {
      order.push(`${tag}:enter`);
      await new Promise((r) => setTimeout(r, 150));
      order.push(`${tag}:exit`);
    });

  await Promise.all([section("a"), section("b")]);

  // Interleaving would read a:enter, b:enter, … -- the whole budget race.
  assert.ok(
    order.join(",") === "a:enter,a:exit,b:enter,b:exit" ||
      order.join(",") === "b:enter,b:exit,a:enter,a:exit",
    `sections interleaved: ${order.join(",")}`
  );
  await l.close();
});

test("the lease is released even when the section throws", { skip }, async () => {
  const key = partition();
  const l = await open();

  await assert.rejects(
    l.withLease(key, async () => {
      throw new Error("boom");
    }),
    /boom/
  );

  // A lease left held would make this hang until the TTL, then reject.
  let ran = false;
  await l.withLease(key, async () => {
    ran = true;
  });
  assert.equal(ran, true, "the lease was not released after a failed section");
  await l.close();
});

test("the decision record keeps refusals, not only approvals", { skip }, async () => {
  const key = partition();
  const l = await open();

  const base = {
    partitionKey: key,
    policyId: "agent-alpha",
    policyVersion: 2,
    amount: 5000,
    recipient: "0x000000000000000000000000000000000000dEaD",
    endpoint: "https://api.example.com/v1/data",
    category: "market-data",
    rules: [{ rule: "perCall.cap", result: "FAIL" }],
  };

  await l.record({
    ...base,
    at: new Date(Date.now() - 1000).toISOString(),
    intentHash: `0x${"07".repeat(32)}`,
    decision: "BLOCKED_PER_CALL_CAP",
    failedRule: "perCall.cap",
    reason: "over the per-call cap",
  });
  await l.record({
    ...base,
    at: new Date().toISOString(),
    intentHash: `0x${"08".repeat(32)}`,
    decision: "APPROVED",
    failedRule: null,
    reason: "within every limit",
    rules: [{ rule: "perCall.cap", result: "PASS" }],
  });

  const rows = await l.decisions(10, key);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].decision, "APPROVED", "decisions are not newest-first");
  assert.equal(rows[1].decision, "BLOCKED_PER_CALL_CAP");

  const s = await l.stats(key);
  assert.deepEqual(
    { total: s.total, approved: s.approved, refused: s.refused },
    { total: 2, approved: 1, refused: 1 }
  );
  await l.close();
});
