/**
 * MandateReceipts — the evidence anchor.
 *
 * The contract is deliberately tiny, so the tests are about the two claims it
 * actually makes rather than about its surface area: that a batch root can be
 * written once and never rewritten, and that `isAnchored` answers the question
 * a holder is really asking — "I recomputed this root from my proof, does the
 * chain agree?" — without them having to scan events or trust an indexer.
 *
 * The merkle tree itself is tested in `packages/receipts`, including both of
 * the classic forgeries. What is tested here is only what the chain adds.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

const BATCH = "0x" + "11".repeat(32);
const ROOT = "0x" + "22".repeat(32);
const OTHER_ROOT = "0x" + "33".repeat(32);

describe("MandateReceipts", function () {
  let receipts, operator, stranger;

  beforeEach(async function () {
    [operator, stranger] = await ethers.getSigners();
    receipts = await (await ethers.getContractFactory("MandateReceipts")).deploy();
    await receipts.waitForDeployment();
  });

  it("starts with nothing anchored", async function () {
    expect(await receipts.batchCount()).to.equal(0);
    expect(await receipts.isAnchored(BATCH, ROOT)).to.equal(false);
    expect((await receipts.getAnchor(BATCH)).root).to.equal(ethers.ZeroHash);
  });

  it("anchors a root, records who wrote it and when, and counts it", async function () {
    const tx = await receipts.anchorReceiptBatch(BATCH, ROOT);
    const block = await ethers.provider.getBlock((await tx.wait()).blockNumber);

    await expect(tx)
      .to.emit(receipts, "BatchAnchored")
      .withArgs(BATCH, ROOT, operator.address, block.timestamp);

    const a = await receipts.getAnchor(BATCH);
    expect(a.root).to.equal(ROOT);
    expect(a.anchoredBy).to.equal(operator.address);
    expect(a.anchoredAt).to.equal(block.timestamp);
    expect(await receipts.batchCount()).to.equal(1);
  });

  describe("isAnchored — the check a verifier actually runs", function () {
    beforeEach(async function () {
      await receipts.anchorReceiptBatch(BATCH, ROOT);
    });

    it("agrees with the root that was written", async function () {
      expect(await receipts.isAnchored(BATCH, ROOT)).to.equal(true);
    });

    it("rejects a different root under the same batch id", async function () {
      // The forgery it has to stop: a holder computes some root from a doctored
      // proof and asks whether the chain has seen it.
      expect(await receipts.isAnchored(BATCH, OTHER_ROOT)).to.equal(false);
    });

    it("rejects the right root under the wrong batch id", async function () {
      expect(await receipts.isAnchored(OTHER_ROOT, ROOT)).to.equal(false);
    });

    it("never says yes to a zero root", async function () {
      /*
       * Without the explicit zero check this returns true for any unanchored
       * batch id, because an empty slot holds zero and the caller passed zero.
       * That turns "we have no record of this" into "verified".
       */
      expect(await receipts.isAnchored(OTHER_ROOT, ethers.ZeroHash)).to.equal(false);
      expect(await receipts.isAnchored(BATCH, ethers.ZeroHash)).to.equal(false);
    });
  });

  describe("append-only", function () {
    it("a second write for the same batch reverts instead of replacing", async function () {
      // An evidence trail whose entries can be rewritten is not one.
      await receipts.anchorReceiptBatch(BATCH, ROOT);
      await expect(receipts.anchorReceiptBatch(BATCH, OTHER_ROOT))
        .to.be.revertedWithCustomError(receipts, "AlreadyAnchored")
        .withArgs(BATCH);
      expect((await receipts.getAnchor(BATCH)).root).to.equal(ROOT);
      expect(await receipts.batchCount()).to.equal(1);
    });

    it("re-anchoring the identical root reverts too", async function () {
      // Idempotence would be friendlier, but it would also mean batchCount
      // stops being a count of distinct batches.
      await receipts.anchorReceiptBatch(BATCH, ROOT);
      await expect(receipts.anchorReceiptBatch(BATCH, ROOT))
        .to.be.revertedWithCustomError(receipts, "AlreadyAnchored");
    });

    it("an empty root is refused, because it commits to nothing", async function () {
      await expect(receipts.anchorReceiptBatch(BATCH, ethers.ZeroHash))
        .to.be.revertedWithCustomError(receipts, "EmptyRoot");
      expect(await receipts.batchCount()).to.equal(0);
    });
  });

  describe("permissionless by design", function () {
    it("anyone may anchor, and the writer is recorded", async function () {
      /*
       * There is no owner check on purpose. The anchor proves a root existed at
       * a block; it does not certify who the writer is. A reader who cares
       * checks `anchoredBy` against the operator they expected — which is a
       * stronger position than trusting an access-control list they cannot see.
       */
      await receipts.connect(stranger).anchorReceiptBatch(BATCH, ROOT);
      expect((await receipts.getAnchor(BATCH)).anchoredBy).to.equal(stranger.address);
    });

    it("a stranger cannot overwrite the operator's anchor", async function () {
      // Permissionless writing must not mean permissionless rewriting.
      await receipts.anchorReceiptBatch(BATCH, ROOT);
      await expect(receipts.connect(stranger).anchorReceiptBatch(BATCH, OTHER_ROOT))
        .to.be.revertedWithCustomError(receipts, "AlreadyAnchored");
      expect((await receipts.getAnchor(BATCH)).anchoredBy).to.equal(operator.address);
    });
  });

  it("keeps separate batches separate", async function () {
    const ids = Array.from({ length: 4 }, (_, i) => "0x" + String(i + 1).repeat(64));
    const roots = Array.from({ length: 4 }, (_, i) => "0x" + String(i + 5).repeat(64));
    for (let i = 0; i < 4; i++) await receipts.anchorReceiptBatch(ids[i], roots[i]);

    expect(await receipts.batchCount()).to.equal(4);
    for (let i = 0; i < 4; i++) {
      expect(await receipts.isAnchored(ids[i], roots[i])).to.equal(true);
      // And no batch answers for another's root.
      expect(await receipts.isAnchored(ids[i], roots[(i + 1) % 4])).to.equal(false);
    }
  });
});
