const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * The contract exists because agent payment rails settle on a promise. These
 * tests are written against the failures that promise permits, not against the
 * happy path -- the happy path is the least interesting thing a payment system
 * does.
 */
describe("OutcomeEscrow", () => {
  const AMOUNT = 100_000_000n; // 100 units at 6 decimals
  const WINDOW = 3600;

  let token, escrow, admin, payer, payee, verifier, outsider;

  const intent = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

  beforeEach(async () => {
    [admin, payer, payee, verifier, outsider] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("TestUSDC");
    token = await Token.deploy();
    const Escrow = await ethers.getContractFactory("OutcomeEscrow");
    escrow = await Escrow.deploy(await token.getAddress(), admin.address);

    await token.mint(payer.address, AMOUNT * 10n);
    await token.connect(payer).approve(await escrow.getAddress(), AMOUNT * 10n);
    await escrow.setVerifier(verifier.address, true);
  });

  describe("claiming an intent", () => {
    it("moves the money into escrow, not to the payee", async () => {
      const id = intent("job-1");
      await escrow.connect(payer).claim(id, payee.address, AMOUNT, WINDOW);

      // The point of the whole contract: after paying, the payee has nothing.
      expect(await token.balanceOf(payee.address)).to.equal(0n);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(AMOUNT);
      expect(await escrow.escrowed()).to.equal(AMOUNT);
    });

    it("refuses a second claim on the same intent", async () => {
      /*
       * The reason this contract exists at the intent level rather than the
       * request level. Two agents independently deciding to do the same job
       * derive the same id and collide here, instead of both paying for it.
       */
      const id = intent("job-1");
      await escrow.connect(payer).claim(id, payee.address, AMOUNT, WINDOW);

      await expect(
        escrow.connect(payer).claim(id, payee.address, AMOUNT, WINDOW)
      ).to.be.revertedWithCustomError(escrow, "AlreadyClaimed");
    });

    it("refuses a re-claim even after the intent has settled", async () => {
      // An idempotency guard that expires is not a guard. A completed job must
      // not become claimable again just because the money already moved.
      const id = intent("job-1");
      await escrow.connect(payer).claim(id, payee.address, AMOUNT, WINDOW);
      await escrow.connect(verifier).release(id, ethers.ZeroHash);

      await expect(
        escrow.connect(payer).claim(id, payee.address, AMOUNT, WINDOW)
      ).to.be.revertedWithCustomError(escrow, "AlreadyClaimed");
    });

    it("rejects a zero amount and a zero payee", async () => {
      await expect(
        escrow.connect(payer).claim(intent("a"), payee.address, 0n, WINDOW)
      ).to.be.revertedWithCustomError(escrow, "ZeroAmount");
      await expect(
        escrow.connect(payer).claim(intent("b"), ethers.ZeroAddress, AMOUNT, WINDOW)
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });
  });

  describe("settling an outcome", () => {
    let id;
    beforeEach(async () => {
      id = intent("job-1");
      await escrow.connect(payer).claim(id, payee.address, AMOUNT, WINDOW);
    });

    it("pays the payee exactly the escrowed amount on release", async () => {
      const before = await token.balanceOf(payee.address);
      const proof = ethers.keccak256(ethers.toUtf8Bytes("receipt+delta"));

      await expect(escrow.connect(verifier).release(id, proof))
        .to.emit(escrow, "Released")
        .withArgs(id, payee.address, AMOUNT, proof);

      expect((await token.balanceOf(payee.address)) - before).to.equal(AMOUNT);
      expect(await escrow.escrowed()).to.equal(0n);
    });

    it("returns the money to the payer on refund", async () => {
      const before = await token.balanceOf(payer.address);
      await escrow.connect(verifier).refund(id, "no transfer emitted");
      expect((await token.balanceOf(payer.address)) - before).to.equal(AMOUNT);
      expect(await escrow.escrowed()).to.equal(0n);
    });

    it("cannot release twice, and cannot refund after release", async () => {
      // Double-settlement is the failure that turns an escrow into a faucet.
      await escrow.connect(verifier).release(id, ethers.ZeroHash);
      await expect(
        escrow.connect(verifier).release(id, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(escrow, "NotOpen");
      await expect(
        escrow.connect(verifier).refund(id, "changed my mind")
      ).to.be.revertedWithCustomError(escrow, "NotOpen");
    });

    it("refuses a verdict from anyone who is not a verifier", async () => {
      for (const who of [payer, payee, outsider]) {
        await expect(
          escrow.connect(who).release(id, ethers.ZeroHash)
        ).to.be.revertedWithCustomError(escrow, "NotVerifier");
      }
    });

    it("stops honouring a revoked verifier", async () => {
      await escrow.setVerifier(verifier.address, false);
      await expect(
        escrow.connect(verifier).release(id, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(escrow, "NotVerifier");
    });
  });

  describe("reclaiming when no verdict ever comes", () => {
    it("lets the payer recover after the window, and not before", async () => {
      /*
       * Without this the payer's funds depend on a verifier staying alive,
       * which is the trust assumption escrow exists to remove.
       */
      const id = intent("stranded");
      await escrow.connect(payer).claim(id, payee.address, AMOUNT, WINDOW);

      await expect(escrow.connect(payer).reclaim(id)).to.be.revertedWithCustomError(
        escrow,
        "TooEarlyToRefund"
      );

      await time.increase(WINDOW + 1);
      const before = await token.balanceOf(payer.address);
      await escrow.connect(payer).reclaim(id);
      expect((await token.balanceOf(payer.address)) - before).to.equal(AMOUNT);
    });

    it("lets only the payer reclaim", async () => {
      const id = intent("stranded-2");
      await escrow.connect(payer).claim(id, payee.address, AMOUNT, WINDOW);
      await time.increase(WINDOW + 1);
      await expect(escrow.connect(outsider).reclaim(id)).to.be.revertedWithCustomError(
        escrow,
        "NotPayer"
      );
    });
  });

  describe("solvency", () => {
    it("never pays out more than was put in, across interleaved intents", async () => {
      // Accounting drift is how an escrow quietly becomes insolvent. Three
      // intents, three different endings, one balance that must land at zero.
      const ids = ["a", "b", "c"].map(intent);
      for (const id of ids) {
        await escrow.connect(payer).claim(id, payee.address, AMOUNT, WINDOW);
      }
      expect(await escrow.escrowed()).to.equal(AMOUNT * 3n);

      await escrow.connect(verifier).release(ids[0], ethers.ZeroHash);
      await escrow.connect(verifier).refund(ids[1], "unproven");
      await time.increase(WINDOW + 1);
      await escrow.connect(payer).reclaim(ids[2]);

      expect(await escrow.escrowed()).to.equal(0n);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    });
  });
});
