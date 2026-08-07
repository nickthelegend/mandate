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
import { keccak256, toUtf8Bytes, id as ethersId, Interface } from "ethers";

import { OutcomeClient, intentId } from "../src/client.ts";

const TOKEN = "0x49C86277a91002c4943837bf20F6ED41976Db09F";
const ESCROW = "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B";
const ALICE = "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67";
const DEAD = "0x000000000000000000000000000000000000dEaD";

/** Real-shaped 32-byte intent ids: the ABI decoder rejects anything shorter. */
const ID_A = "0x" + "a1".repeat(32);
const ID_B = "0x" + "b2".repeat(32);
const ID_C = "0x" + "c3".repeat(32);

const ESCROW_EVENTS = [
  "event Claimed(bytes32 indexed intentId, address indexed payer, address indexed payee, address beneficiary, uint256 amount, uint64 refundableAt)",
  "event Released(bytes32 indexed intentId, address indexed payee, uint256 amount, bytes32 proof)",
  "event Refunded(bytes32 indexed intentId, address indexed payer, uint256 amount, string reason)",
];

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

test("listIntents joins each ending to its own intent, from one log stream", async () => {
  /*
   * Three intents, three endings, interleaved in one chronological log stream
   * exactly as eth_getLogs returns them -- so a join that pairs by position
   * rather than by id gets it wrong, and an implementation that assumed three
   * separate per-event queries would not compile against this shape at all.
   */
  const iface = new Interface(ESCROW_EVENTS);
  const ids = [ID_A, ID_B, ID_C];

  const claimLog = (intentId: string, n: number) => ({
    ...iface.encodeEventLog("Claimed", [
      intentId,
      ALICE,
      ALICE,
      DEAD,
      BigInt((n + 1) * 1_000_000),
      0n,
    ]),
    transactionHash: `0x${"c".repeat(63)}${n}`,
    blockNumber: 100 + n,
  });

  const logs = [
    claimLog(ids[0], 0),
    claimLog(ids[1], 1),
    claimLog(ids[2], 2),
    // The endings arrive out of order relative to the claims.
    {
      ...iface.encodeEventLog("Refunded", [ids[0], ALICE, 1_000_000n, "no Transfer emitted"]),
      transactionHash: `0x${"f".repeat(64)}`,
      blockNumber: 110,
    },
    {
      ...iface.encodeEventLog("Released", [ids[2], ALICE, 3_000_000n, `0x${"0".repeat(64)}`]),
      transactionHash: `0x${"e".repeat(64)}`,
      blockNumber: 111,
    },
  ];

  const c = client({
    getBlockNumber: async () => 200,
    getLogs: async (filter: { topics: string[][] }) => {
      // One request, with the three topics OR'd. Three parallel queries is a
      // burst that public RPCs throttle into a hang -- which is what left the
      // deployed dashboard reading the chain forever.
      assert.equal(filter.topics.length, 1, "should be a single topic0 position");
      assert.equal(filter.topics[0].length, 3, "should OR all three event topics");
      return logs;
    },
  });

  const rows = await c.listIntents();

  assert.equal(rows.length, 3);
  // Newest first.
  assert.deepEqual(rows.map((r) => r.intentId), [ids[2], ids[1], ids[0]]);

  const byId = Object.fromEntries(rows.map((r) => [r.intentId, r]));
  assert.equal(byId[ids[2]].state, "released");
  assert.equal(byId[ids[2]].outcomeTransactionHash, `0x${"e".repeat(64)}`);

  assert.equal(byId[ids[0]].state, "refunded");
  assert.equal(byId[ids[0]].reason, "no Transfer emitted");

  // The one nobody ruled on stays open and carries no borrowed reason.
  assert.equal(byId[ids[1]].state, "open");
  assert.equal(byId[ids[1]].reason, undefined);
  assert.equal(byId[ids[1]].amount, "2000000");
});
