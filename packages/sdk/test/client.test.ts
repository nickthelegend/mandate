/**
 * Tests for the public client.
 *
 * Two pieces here are hand-written translations, and translations are where
 * silent wrongness lives: the receipt adapter (ethers' decoded receipt back
 * into the wire shape `verifyTransfer` reads) and the event join in
 * `listIntents` (three event streams into one row per intent). Both look
 * obviously correct and both have an off-by-one flavour of failure that no type
 * catches -- a status of 0 rendering as undefined, or a refund reason attaching
 * to the wrong intent.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toUtf8Bytes, id as ethersId } from "ethers";

import { OutcomeClient, intentId } from "../src/client.ts";

const TOKEN = "0x49C86277a91002c4943837bf20F6ED41976Db09F";
const ESCROW = "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B";
const ALICE = "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67";
const DEAD = "0x000000000000000000000000000000000000dEaD";

/** A real-shaped 32-byte hash: the proof commitment encodes it as bytes32. */
const HASH = "0x" + "ab".repeat(32);

const TRANSFER = ethersId("Transfer(address,address,uint256)");
const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/** Minimum surface of a Provider that OutcomeClient.verify actually uses. */
function providerReturning(receipt: unknown) {
  return {
    getTransactionReceipt: async () => receipt,
  } as never;
}

function client(provider: unknown) {
  return new OutcomeClient({ provider: provider as never, escrow: ESCROW, token: TOKEN });
}

test("intentId is a pure function of the work, and case-insensitive in the payee", () => {
  // The on-chain duplicate guard is worthless if two agents derive different
  // ids for the same job, and a checksummed vs lowercase address is the most
  // likely way for that to happen.
  const a = intentId("deliver 1 USDC to treasury", ALICE);
  const b = intentId("deliver 1 USDC to treasury", ALICE.toLowerCase());
  assert.equal(a, b);
  assert.equal(a, keccak256(toUtf8Bytes(`deliver 1 USDC to treasury|${ALICE.toLowerCase()}`)));

  assert.notEqual(a, intentId("deliver 2 USDC to treasury", ALICE));
  assert.notEqual(a, intentId("deliver 1 USDC to treasury", DEAD));
});

test("verify reads a real Transfer through the receipt adapter", async () => {
  const c = client(
    providerReturning({
      status: 1,
      blockNumber: 11_433_967,
      hash: HASH,
      logs: [
        {
          address: TOKEN,
          topics: [TRANSFER, pad(ALICE), pad(DEAD)],
          data: "0x" + (1_000_000n).toString(16).padStart(64, "0"),
        },
      ],
    })
  );

  const v = await c.verify({ transactionHash: HASH, recipient: DEAD, minAmount: 1_000_000n });
  assert.equal(v.proven, true);
  assert.equal(v.observed, 1_000_000n);
  assert.equal(v.logCount, 1);
});

test("a reverted receipt survives the adapter as a failure, not as undefined", async () => {
  /*
   * The adapter builds `status` with toString(16). A status of 0 is falsy, and
   * the obvious `r.status ? ... : undefined` spelling turns a reverted
   * transaction into "no status", which the verifier would report as unreadable
   * rather than failed. Both are "not proven", so the bug is invisible in the
   * outcome and only shows up in the reason a human reads.
   */
  const c = client(providerReturning({ status: 0, blockNumber: 1, hash: "0xdead", logs: [] }));
  const v = await c.verify({ transactionHash: "0xdead", recipient: DEAD, minAmount: 1n });

  assert.equal(v.proven, false);
  assert.match(v.reason, /did not succeed/);
  assert.doesNotMatch(v.reason, /no receipt/);
});

test("an unknown transaction is not proven, and says so", async () => {
  const c = client(providerReturning(null));
  const v = await c.verify({ transactionHash: "0x00", recipient: DEAD, minAmount: 1n });
  assert.equal(v.proven, false);
  assert.match(v.reason, /no receipt/);
});

test("under-delivery does not pass", async () => {
  const c = client(
    providerReturning({
      status: 1,
      blockNumber: 2,
      hash: "0xshort",
      logs: [
        {
          address: TOKEN,
          topics: [TRANSFER, pad(ALICE), pad(DEAD)],
          data: "0x" + (999_999n).toString(16).padStart(64, "0"),
        },
      ],
    })
  );
  const v = await c.verify({ transactionHash: "0xshort", recipient: DEAD, minAmount: 1_000_000n });
  assert.equal(v.proven, false);
});

test("listIntents joins each ending to its own intent", async () => {
  // Three intents, three endings, deliberately out of order and interleaved so
  // a join that pairs by array position rather than by id gets it wrong.
  const ids = ["0xaa", "0xbb", "0xcc"];
  const claimed = ids.map((intentId, n) => ({
    args: {
      intentId,
      payer: ALICE,
      payee: ALICE,
      beneficiary: DEAD,
      amount: BigInt((n + 1) * 1_000_000),
      refundableAt: 0n,
    },
    transactionHash: `0xclaim${n}`,
    blockNumber: 100 + n,
  }));

  const fake = {
    getBlockNumber: async () => 200,
  };
  const c = client(fake);

  // Stand in for the escrow contract: the join is what is under test, not ethers.
  (c as never as { contract: () => unknown }).contract = () => ({
    filters: { Claimed: () => "C", Released: () => "R", Refunded: () => "F" },
    queryFilter: async (f: string) =>
      f === "C"
        ? claimed
        : f === "R"
          ? [{ args: { intentId: "0xcc" }, transactionHash: "0xrel" }]
          : [{ args: { intentId: "0xaa", reason: "no Transfer emitted" }, transactionHash: "0xref" }],
  });

  const rows = await c.listIntents();

  assert.equal(rows.length, 3);
  // Newest first.
  assert.deepEqual(rows.map((r) => r.intentId), ["0xcc", "0xbb", "0xaa"]);

  const byId = Object.fromEntries(rows.map((r) => [r.intentId, r]));
  assert.equal(byId["0xcc"].state, "released");
  assert.equal(byId["0xcc"].outcomeTransactionHash, "0xrel");

  assert.equal(byId["0xaa"].state, "refunded");
  assert.equal(byId["0xaa"].reason, "no Transfer emitted");
  assert.equal(byId["0xaa"].outcomeTransactionHash, "0xref");

  // The one nobody ruled on stays open and carries no borrowed reason.
  assert.equal(byId["0xbb"].state, "open");
  assert.equal(byId["0xbb"].reason, undefined);
  assert.equal(byId["0xbb"].amount, "2000000");
});
