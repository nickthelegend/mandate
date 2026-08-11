/**
 * PolicyRegistry — the contract the whole authority hangs off.
 *
 * Everything the gateway does is downstream of two reads on this contract:
 * `isUsable(policyId)` and `getPolicy(policyId).policyHash`. If the first can
 * lie, the kill switch does not work. If the second can drift from the document
 * being enforced, the anchor proves nothing.
 *
 * So the tests here are about the properties that hold enforcement up, not
 * about coverage of getters: that usability is derived rather than stored, that
 * only the owner can move a policy, that pausing is a real state and not a
 * flag the reader has to interpret, and that an update bumps the version so a
 * decision recorded against v1 can never be re-read as v2.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const HASH_A = "0x" + "a1".repeat(32);
const HASH_B = "0x" + "b2".repeat(32);
const YEAR = 365 * 24 * 60 * 60;

describe("PolicyRegistry", function () {
  let registry, owner, other, agent;

  beforeEach(async function () {
    [owner, other, agent] = await ethers.getSigners();
    registry = await (await ethers.getContractFactory("PolicyRegistry")).deploy();
    await registry.waitForDeployment();
  });

  const register = async (signer = owner, expiryIn = YEAR) => {
    const expiry = (await time.latest()) + expiryIn;
    const id = await registry.nextPolicyId(signer.address);
    await registry.connect(signer).registerPolicy(agent.address, HASH_A, expiry);
    return { id, expiry };
  };

  describe("registration", function () {
    it("stores the anchor exactly as given and starts ACTIVE at v1", async function () {
      const { id, expiry } = await register();
      const p = await registry.getPolicy(id);
      expect(p.policyHash).to.equal(HASH_A);
      expect(p.owner).to.equal(owner.address);
      expect(p.agent).to.equal(agent.address);
      expect(p.status).to.equal(1); // ACTIVE
      expect(p.version).to.equal(1);
      expect(p.expiry).to.equal(expiry);
      expect(await registry.isUsable(id)).to.equal(true);
    });

    it("derives an id the caller could have predicted", async function () {
      // Off-chain code anchors a policy and then has to know which id to read
      // back. If the derivation were not a pure function of owner and nonce,
      // that lookup would need an event scan.
      const nonce = await registry.ownerNonce(owner.address);
      const predicted = await registry.previewPolicyId(owner.address, nonce);
      const { id } = await register();
      expect(id).to.equal(predicted);
    });

    it("gives two owners separate id sequences", async function () {
      // A shared global counter would make one owner's registration change the
      // id another owner's next registration gets.
      const a = await register(owner);
      const b = await register(other);
      expect(a.id).to.not.equal(b.id);
      expect(await registry.ownerNonce(owner.address)).to.equal(1);
      expect(await registry.ownerNonce(other.address)).to.equal(1);
    });

    it("refuses a zero hash, a zero agent, and an expiry already gone", async function () {
      const future = (await time.latest()) + YEAR;
      await expect(registry.registerPolicy(agent.address, ethers.ZeroHash, future))
        .to.be.revertedWithCustomError(registry, "ZeroPolicyHash");
      await expect(registry.registerPolicy(ethers.ZeroAddress, HASH_A, future))
        .to.be.revertedWithCustomError(registry, "ZeroAgent");
      await expect(registry.registerPolicy(agent.address, HASH_A, await time.latest()))
        .to.be.revertedWithCustomError(registry, "ExpiryInPast");
    });
  });

  describe("reading a policy that is not there", function () {
    it("reverts rather than returning a zeroed record", async function () {
      /*
       * The failure mode this prevents: a caller reads an unknown id, gets a
       * struct of zeros, sees status 0, and treats it as "not active" — which
       * happens to be right. Then someone writes `status != PAUSED` somewhere
       * and an unregistered id reads as permitted.
       */
      await expect(registry.getPolicy(999)).to.be.revertedWithCustomError(registry, "PolicyNotFound");
      expect(await registry.exists(999)).to.equal(false);
      expect(await registry.isUsable(999)).to.equal(false);
    });
  });

  describe("the kill switch", function () {
    it("pause stops usability, resume restores it", async function () {
      const { id } = await register();
      await expect(registry.pausePolicy(id)).to.emit(registry, "PolicyPaused").withArgs(id, owner.address);
      expect((await registry.getPolicy(id)).status).to.equal(2); // PAUSED
      expect(await registry.isUsable(id)).to.equal(false);

      await expect(registry.resumePolicy(id)).to.emit(registry, "PolicyResumed").withArgs(id, owner.address);
      expect(await registry.isUsable(id)).to.equal(true);
    });

    it("only the owner can pause or resume", async function () {
      const { id } = await register();
      await expect(registry.connect(other).pausePolicy(id))
        .to.be.revertedWithCustomError(registry, "NotPolicyOwner");
      await registry.pausePolicy(id);
      await expect(registry.connect(other).resumePolicy(id))
        .to.be.revertedWithCustomError(registry, "NotPolicyOwner");
    });

    it("double-pause and resume-when-running both revert", async function () {
      // A no-op pause that succeeds would let an operator believe they had
      // stopped something they had not.
      const { id } = await register();
      await registry.pausePolicy(id);
      await expect(registry.pausePolicy(id)).to.be.revertedWithCustomError(registry, "PolicyNotActive");
      await registry.resumePolicy(id);
      await expect(registry.resumePolicy(id)).to.be.revertedWithCustomError(registry, "PolicyNotPaused");
    });

    it("an unregistered id reverts as not found, not as not-owner", async function () {
      await expect(registry.pausePolicy(12345)).to.be.revertedWithCustomError(registry, "PolicyNotFound");
    });
  });

  describe("expiry", function () {
    it("is derived, so a policy stops being usable with no transaction", async function () {
      /*
       * The property the enforcement layer depends on. If expiry were a stored
       * flag someone had to flip, an expired policy would keep authorizing
       * spends until a keeper noticed.
       */
      const { id } = await register(owner, 3600);
      expect(await registry.isUsable(id)).to.equal(true);
      await time.increase(3601);
      expect(await registry.isUsable(id)).to.equal(false);
      // Still ACTIVE on paper — which is exactly why callers must use isUsable.
      expect((await registry.getPolicy(id)).status).to.equal(1);
    });

    it("is inclusive: a policy is dead on the second it expires", async function () {
      const { id, expiry } = await register(owner, 3600);
      await time.increaseTo(expiry);
      expect(await registry.isUsable(id)).to.equal(true);
      await time.increase(1);
      expect(await registry.isUsable(id)).to.equal(false);
    });
  });

  describe("updating the anchored ruleset", function () {
    it("replaces the hash and bumps the version", async function () {
      const { id } = await register();
      const newExpiry = (await time.latest()) + 2 * YEAR;
      await expect(registry.updatePolicy(id, HASH_B, newExpiry))
        .to.emit(registry, "PolicyUpdated")
        .withArgs(id, owner.address, HASH_B, HASH_A, newExpiry, 2);
      const p = await registry.getPolicy(id);
      expect(p.policyHash).to.equal(HASH_B);
      expect(p.version).to.equal(2);
    });

    it("leaves a paused policy paused", async function () {
      // Revising the rules is not the same act as turning enforcement back on,
      // and conflating them would let an update quietly undo a kill switch.
      const { id } = await register();
      await registry.pausePolicy(id);
      await registry.updatePolicy(id, HASH_B, (await time.latest()) + YEAR);
      expect((await registry.getPolicy(id)).status).to.equal(2);
      expect(await registry.isUsable(id)).to.equal(false);
    });

    it("cannot change the owner or the agent", async function () {
      const { id } = await register();
      await registry.updatePolicy(id, HASH_B, (await time.latest()) + YEAR);
      const p = await registry.getPolicy(id);
      expect(p.owner).to.equal(owner.address);
      expect(p.agent).to.equal(agent.address);
    });

    it("only the owner can update, and never to a zero hash or a past expiry", async function () {
      const { id } = await register();
      const future = (await time.latest()) + YEAR;
      await expect(registry.connect(other).updatePolicy(id, HASH_B, future))
        .to.be.revertedWithCustomError(registry, "NotPolicyOwner");
      await expect(registry.updatePolicy(id, ethers.ZeroHash, future))
        .to.be.revertedWithCustomError(registry, "ZeroPolicyHash");
      await expect(registry.updatePolicy(id, HASH_B, await time.latest()))
        .to.be.revertedWithCustomError(registry, "ExpiryInPast");
    });
  });
});
