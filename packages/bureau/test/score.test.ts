/**
 * Tests for the bureau.
 *
 * The properties pinned here are the ones enforcement rests on. Each is a way
 * the scoring could look reasonable and be wrong in the direction that lets an
 * agent pay someone it should not have.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { lcb, bandOf, clamp01to100 } from "../src/lcb.ts";
import { renormalize } from "../src/renormalize.ts";
import {
  trackRecordDepth,
  settlementConsistency,
  disputeSignal,
  walletOperationalProfile,
} from "../src/features.ts";
import { scoreVendor, toVendorScoreInject } from "../src/score.ts";
import { VENDOR_FEATURES, Z_DEFAULT, COLD_START_PRIOR_STD } from "../src/weights.ts";

const payment = (n: number, decision = "APPROVED", hash?: string) => ({
  decision,
  amount: 1,
  at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
  ...(hash ? { transactionHash: hash } : {}),
});

// ── the enforcement primitive ───────────────────────────────────────────────

test("no uncertainty means no discount", () => {
  assert.equal(lcb(80, 0, Z_DEFAULT), 80);
});

test("uncertainty always lowers the bound, never raises it", () => {
  for (const sigma of [0.5, 5, 13, 40]) {
    assert.ok(lcb(80, sigma, Z_DEFAULT) < 80, `sigma ${sigma} did not discount`);
  }
});

test("a wide enough sigma drives the bound to the floor", () => {
  // The failure that matters: an unknown payee must not clear a floor.
  assert.equal(lcb(80, 500, Z_DEFAULT), 0);
});

test("the bound is clamped into the score range", () => {
  assert.equal(clamp01to100(-30), 0);
  assert.equal(clamp01to100(140), 100);
});

test("a non-finite input throws rather than producing a number", () => {
  // Silently yielding NaN here would compare false against every floor and
  // read as "passed".
  assert.throws(() => lcb(Number.NaN, 1, 1.28), /non-finite/);
  assert.throws(() => lcb(80, -1, 1.28), /sigma must be/);
});

test("the band is derived from the bound, not the score", () => {
  assert.equal(bandOf(lcb(95, 0, Z_DEFAULT)), "TRUSTED");
  // The same 95, badly evidenced, must not read as trusted. 95 - 1.28*40 = 43.8.
  assert.equal(bandOf(lcb(95, 40, Z_DEFAULT)), "ELEVATED_RISK");
  // And the band must degrade monotonically as evidence thins.
  const order = ["HIGH_RISK", "ELEVATED_RISK", "CAUTION", "STABLE", "TRUSTED"];
  const bands = [0, 10, 20, 30, 40].map((s) => order.indexOf(bandOf(lcb(95, s, Z_DEFAULT))));
  assert.deepEqual(bands, [...bands].sort((a, b) => b - a), `bands did not degrade: ${bands}`);
});

// ── the missing-signal mechanism ────────────────────────────────────────────

test("a cold-start prior never contributes its value to the score", () => {
  const out = renormalize([
    { key: "a", value: 100, sigma: 2, baseWeight: 0.5, observed: true },
    { key: "b", value: 0, sigma: 2, baseWeight: 0.5, observed: false },
  ]);
  // If the prior's 0 leaked into the estimate the score would be 50.
  assert.equal(out.score, 100);
  assert.equal(out.weightApplied.b, 0);
});

test("renormalized-away weight widens sigma", () => {
  const all = renormalize([
    { key: "a", value: 80, sigma: 2, baseWeight: 0.5, observed: true },
    { key: "b", value: 80, sigma: 2, baseWeight: 0.5, observed: true },
  ]);
  const half = renormalize([
    { key: "a", value: 80, sigma: 2, baseWeight: 0.5, observed: true },
    { key: "b", value: 80, sigma: 2, baseWeight: 0.5, observed: false },
  ]);
  assert.equal(all.score, half.score, "the point estimate should be unchanged");
  assert.ok(half.uncertainty.sigma > all.uncertainty.sigma, "missing signal did not widen sigma");
  assert.equal(half.uncertainty.renormalizedAwayWeight, 0.5);
});

test("no observed signal at all reads as no data, at maximum uncertainty", () => {
  const out = renormalize([{ key: "a", value: 90, sigma: 1, baseWeight: 1, observed: false }]);
  assert.equal(out.score, 50);
  assert.equal(out.uncertainty.sigma, COLD_START_PRIOR_STD);
  assert.equal(lcb(out.score, out.uncertainty.sigma, Z_DEFAULT), 50 - 1.28 * 22);
});

// ── the features ────────────────────────────────────────────────────────────

test("track record counts only approved payments", () => {
  const f = trackRecordDepth([payment(1), payment(2), payment(3, "BLOCKED_BUDGET")]);
  assert.equal(f.n, 2);
});

test("an unverified settlement is excluded, not counted as a success", () => {
  // The whole product exists to catch a settlement that reports success and
  // moves nothing. A feature that scored unchecked payments as passes would
  // reward exactly that.
  const f = settlementConsistency([
    { transactionHash: "0xa", proven: true },
    { transactionHash: "0xb", proven: null },
  ]);
  assert.equal(f.n, 1, "the unverified settlement entered the denominator");
  assert.equal(f.value, 100);
  assert.match(f.note, /unverified, excluded rather than assumed/);
});

test("a settlement that moved nothing lowers consistency and raises disputes", () => {
  const settled = [
    { transactionHash: "0xa", proven: true },
    { transactionHash: "0xb", proven: false },
  ];
  assert.equal(settlementConsistency(settled).value, 50);
  const d = disputeSignal([payment(1), payment(2)], settled, []);
  assert.ok(d.value < 100, "a settlement that paid nobody did not register as a dispute");
});

test("an unprofiled payout address is neutral with no observations, never zero", () => {
  const f = walletOperationalProfile(null);
  assert.equal(f.value, 50);
  assert.equal(f.n, 0);
});

test("a real wallet profile scales with activity", () => {
  const quiet = walletOperationalProfile({ address: "0xa", txCount: 1, balanceWei: 0n, isContract: false });
  const busy = walletOperationalProfile({ address: "0xb", txCount: 400, balanceWei: 1n, isContract: false });
  assert.ok(busy.value > quiet.value);
});

// ── the whole pipeline ──────────────────────────────────────────────────────

test("a payee with no history scores conservatively, not neutrally", () => {
  const r = scoreVendor({ subject: "0xdead", payments: [], settlements: [], escalations: [], wallet: null });
  assert.ok(r.lcb < r.score, "the bound was not discounted");
  assert.ok(r.lcb < 50, `an unknown payee scored ${r.lcb}, which would clear a low floor`);
  assert.equal(r.band, "HIGH_RISK");
});

test("a clean history beats a history of settlements that paid nobody", () => {
  const good = scoreVendor({
    subject: "0xgood",
    payments: Array.from({ length: 20 }, (_, i) => payment(i, "APPROVED", `0x${i}`)),
    settlements: Array.from({ length: 20 }, (_, i) => ({ transactionHash: `0x${i}`, proven: true })),
    escalations: [],
    wallet: { address: "0xgood", txCount: 300, balanceWei: 1n, isContract: false },
  });
  const bad = scoreVendor({
    subject: "0xbad",
    payments: Array.from({ length: 20 }, (_, i) => payment(i, "APPROVED", `0x${i}`)),
    settlements: Array.from({ length: 20 }, (_, i) => ({ transactionHash: `0x${i}`, proven: i < 5 })),
    escalations: [],
    wallet: { address: "0xbad", txCount: 300, balanceWei: 1n, isContract: false },
  });
  assert.ok(good.lcb > bad.lcb, `good ${good.lcb} did not beat bad ${bad.lcb}`);
});

test("every feature is reported, priors included, and the weights sum to one", () => {
  const r = scoreVendor({ subject: "0xa", payments: [], settlements: [], escalations: [], wallet: null });
  assert.equal(r.features.length, VENDOR_FEATURES.length);
  // A reader must be able to see which numbers moved the score.
  const applied = r.features.reduce((s, f) => s + f.weightApplied, 0);
  assert.ok(Math.abs(applied - 1) < 1e-9, `applied weights summed to ${applied}`);
  for (const f of r.features.filter((x) => !x.implemented)) {
    assert.equal(f.weightApplied, 0);
    assert.match(f.note, /PRIOR, not data/);
  }
});

test("the inject the policy rule reads carries the bound, and is deterministic", () => {
  const args = {
    subject: "0xAbC",
    payments: [payment(1, "APPROVED", "0x1")],
    settlements: [{ transactionHash: "0x1", proven: true }],
    escalations: [],
    wallet: null,
    nowMs: 1_800_000_000_000,
  } as const;
  const a = toVendorScoreInject(scoreVendor(args));
  const b = toVendorScoreInject(scoreVendor(args));
  assert.deepEqual(a, b, "the same inputs produced two different scores");
  assert.equal(a.vendorId, "0xabc");
  assert.equal(a.available, true);
  assert.ok(a.lcb <= a.score);
});
