/**
 * Tests for the receipt writer.
 *
 * Two groups. The merkle tests pin the properties that make a proof worth
 * anything — both of the classic ways a naive tree is forgeable. The writer
 * tests pin the ordering: durable first, chain second, and a chain failure that
 * degrades the evidence without ever touching the decision.
 *
 * The store here is an in-memory implementation of the same interface Mongo
 * implements, because the subject is the state machine. The Mongo version is
 * exercised for real against the live gateway.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { leafHash, merkleRoot, merkleProof, verifyProof, bodyHash, type Hex } from "../src/merkle.ts";
import { ReceiptWriter, type Anchorer, type ReceiptStore } from "../src/writer.ts";
import type { Batch, Receipt, ReceiptBody, ReceiptStatus } from "../src/types.ts";

// ── the tree ────────────────────────────────────────────────────────────────

const leaves = (n: number): Hex[] =>
  Array.from({ length: n }, (_, i) => leafHash(`0x${String(i).padStart(64, "0")}`, `0x${"ab".repeat(32)}`));

test("every leaf in a batch proves against the root", () => {
  for (const n of [1, 2, 3, 5, 8, 9]) {
    const ls = leaves(n);
    const root = merkleRoot(ls)!;
    for (let i = 0; i < n; i++) {
      assert.ok(verifyProof(ls[i], merkleProof(ls, i), root), `leaf ${i} of ${n} did not prove`);
    }
  }
});

test("a leaf that was not in the batch does not prove", () => {
  const ls = leaves(4);
  const root = merkleRoot(ls)!;
  const outsider = leafHash(`0x${"9".repeat(64)}`, `0x${"cd".repeat(32)}`);
  assert.equal(verifyProof(outsider, merkleProof(ls, 0), root), false);
});

test("an odd batch is promoted, not duplicated", () => {
  /*
   * The CVE-2012-2459 shape: duplicating the last leaf makes a batch of three
   * produce the same root as a crafted batch of four, so a forged batch can
   * claim a real batch's anchor.
   */
  const three = leaves(3);
  const forged = [...three, three[2]];
  assert.notEqual(merkleRoot(three), merkleRoot(forged), "a duplicated tail collided with a real root");
});

test("an internal node cannot be passed off as a leaf", () => {
  // Without domain separation, a proof for an internal node verifies and the
  // holder "proves" a receipt that never existed.
  const ls = leaves(4);
  const root = merkleRoot(ls)!;
  const internal = merkleRoot([ls[0], ls[1]])!;
  assert.equal(verifyProof(internal, merkleProof(ls, 0), root), false);
});

test("an empty batch has no root rather than a zero one", () => {
  // A zero hash looks anchorable and commits to nothing.
  assert.equal(merkleRoot([]), null);
});

// ── the writer ──────────────────────────────────────────────────────────────

function memoryStore(): ReceiptStore & { receipts: Map<string, Receipt>; batches: Map<string, Batch> } {
  const receipts = new Map<string, Receipt>();
  const batches = new Map<string, Batch>();
  return {
    receipts,
    batches,
    async put(r) {
      receipts.set(r.receiptId, r);
    },
    async get(id) {
      return receipts.get(id) ?? null;
    },
    async queued(limit) {
      return [...receipts.values()]
        .filter((r) => r.status === "QUEUED")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit);
    },
    async markBatched(ids, batchId) {
      for (const id of ids) {
        const r = receipts.get(id)!;
        receipts.set(id, { ...r, status: "BATCHED", batchId });
      }
    },
    async setStatus(ids, status: ReceiptStatus, reason) {
      for (const id of ids) {
        const r = receipts.get(id)!;
        receipts.set(id, { ...r, status, ...(reason ? { degradedReason: reason } : {}) });
      }
    },
    async putBatch(b) {
      batches.set(b.batchId, b);
    },
    async getBatch(id) {
      return batches.get(id) ?? null;
    },
    async openBatches() {
      return [...batches.values()].filter((b) => b.status === "PENDING" || b.status === "SUBMITTED");
    },
    async recent(limit) {
      return [...receipts.values()].slice(0, limit);
    },
  };
}

const body = (n: number): ReceiptBody => ({
  intentHash: `0x${String(n).padStart(64, "0")}`,
  policyId: "42",
  policyVersion: 3,
  policyHash: `0x${"81".repeat(32)}`,
  decision: n % 3 === 0 ? "BLOCKED_PER_CALL_CAP" : "APPROVED",
  failedRule: n % 3 === 0 ? "perCall.cap" : null,
  amountBase: "400000",
  recipient: "0x000000000000000000000000000000000000dEaD",
  token: "0x49C86277a91002c4943837bf20F6ED41976Db09F",
  agent: "agent-a",
  decidedAt: new Date(Date.UTC(2026, 7, 11, 0, 0, n)).toISOString(),
});

const okAnchorer = (): Anchorer => ({
  async anchor() {
    return { transactionHash: `0x${"ee".repeat(32)}`, executionId: "exec_1" };
  },
  async confirmed() {
    return true;
  },
});

test("enqueue is durable immediately and does not anchor", async () => {
  const store = memoryStore();
  let anchored = false;
  const w = new ReceiptWriter(store, {
    async anchor() {
      anchored = true;
      return {};
    },
    async confirmed() {
      return false;
    },
  });
  const { receiptId, status } = await w.enqueue(body(1));
  assert.equal(status, "QUEUED");
  assert.ok(await store.get(receiptId), "the receipt was not durable on return");
  assert.equal(anchored, false, "enqueue reached the chain; it must not");
});

test("the same decision recorded twice is one receipt", async () => {
  const store = memoryStore();
  const w = new ReceiptWriter(store, null);
  const a = await w.enqueue(body(1));
  const b = await w.enqueue(body(1));
  assert.equal(a.receiptId, b.receiptId);
  assert.equal(store.receipts.size, 1);
});

test("a full batch climbs QUEUED to CONFIRMED", async () => {
  const store = memoryStore();
  const w = new ReceiptWriter(store, okAnchorer(), { batchSize: 3 });
  const ids = [];
  for (let i = 1; i <= 3; i++) ids.push((await w.enqueue(body(i))).receiptId);

  /*
   * One tick moves a batch as far as it can go, so batching and submitting
   * happen together — the batch it just created is PENDING when the submit
   * pass runs. Confirmation needs a second tick because it asks the chain.
   */
  assert.deepEqual(await w.tick(), { batched: 3, submitted: 3, confirmed: 0, degraded: 0 });
  assert.equal((await store.get(ids[0]))!.status, "SUBMITTED");

  assert.equal((await w.tick()).confirmed, 3);
  assert.equal((await store.get(ids[0]))!.status, "CONFIRMED");
});

test("a partial batch waits for size, then goes on age", async () => {
  let t = 1_800_000_000_000;
  const store = memoryStore();
  const w = new ReceiptWriter(store, okAnchorer(), { batchSize: 5, maxWaitMs: 60_000, clock: () => t });
  await w.enqueue(body(1));

  assert.equal((await w.tick()).batched, 0, "batched before it was full or old");
  t += 61_000;
  assert.equal((await w.tick()).batched, 1, "a lone receipt never anchored");
});

test("a chain that never works degrades the receipt, and says why", async () => {
  const store = memoryStore();
  const broken: Anchorer = {
    async anchor() {
      throw new Error("RPC unavailable");
    },
    async confirmed() {
      return false;
    },
  };
  const w = new ReceiptWriter(store, broken, { batchSize: 1, maxAttempts: 2 });
  const { receiptId } = await w.enqueue(body(1));

  await w.tick(); // batch
  await w.tick(); // attempt 1 fails
  await w.tick(); // attempt 2 fails
  await w.tick(); // out of attempts

  const r = await store.get(receiptId);
  assert.equal(r!.status, "DEGRADED_UNANCHORED");
  assert.match(r!.degradedReason ?? "", /anchoring failed/);
  // The record itself is untouched: the evidence degraded, the decision did not.
  assert.equal(r!.body.decision, body(1).decision);
  assert.equal(r!.bodyHash, bodyHash(body(1)));
});

test("with no anchorer the receipts stay batched rather than degrading", async () => {
  // No credential is not the same as a failure, and must not be recorded as one.
  const store = memoryStore();
  const w = new ReceiptWriter(store, null, { batchSize: 1 });
  const { receiptId } = await w.enqueue(body(1));
  await w.tick();
  await w.tick();
  assert.equal((await store.get(receiptId))!.status, "BATCHED");
});

test("a proof is only 'anchored' once the batch is confirmed AND it verifies", async () => {
  const store = memoryStore();
  const w = new ReceiptWriter(store, okAnchorer(), { batchSize: 4 });
  const ids = [];
  for (let i = 1; i <= 4; i++) ids.push((await w.enqueue(body(i))).receiptId);
  await w.tick();

  const submitted = await w.proof(ids[2]);
  assert.equal(submitted!.anchored, false, "claimed anchored before the batch confirmed");
  assert.ok(verifyProof(submitted!.leaf as Hex, submitted!.proof as Hex[], submitted!.root as Hex));

  await w.tick();
  await w.tick();
  const confirmed = await w.proof(ids[2]);
  assert.equal(confirmed!.anchored, true);
  assert.equal(confirmed!.status, "CONFIRMED");
});

test("an unbatched receipt has no proof to give", async () => {
  const store = memoryStore();
  const w = new ReceiptWriter(store, okAnchorer(), { batchSize: 10 });
  const { receiptId } = await w.enqueue(body(1));
  assert.equal(await w.proof(receiptId), null);
});

test("the body commits to the decision, not to the endpoint or category", async () => {
  // What goes on chain should prove the decision without publishing who the
  // operator pays and for what.
  const b = body(1);
  const keys = Object.keys(b);
  for (const leaky of ["endpoint", "category", "reason"]) {
    assert.ok(!keys.includes(leaky), `the anchored body carries ${leaky}`);
  }
  assert.ok(keys.includes("intentHash") && keys.includes("policyHash"));
});
