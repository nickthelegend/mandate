import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toUtf8Bytes, AbiCoder } from "ethers";
import { verifyTransfer, TRANSFER_TOPIC } from "../src/verify.ts";

const TOKEN = "0x49C86277a91002c4943837bf20F6ED41976Db09F";
const PAYEE = "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67";
const pad = (a: string) => "0x" + "00".repeat(12) + a.slice(2).toLowerCase();
const hex = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");

const transferLog = (to: string, amount: bigint, token = TOKEN) => ({
  address: token,
  topics: [TRANSFER_TOPIC, pad(PAYEE), pad(to)],
  data: hex(amount),
});

const receipt = (logs: any[], status = "0x1") => ({
  status,
  blockNumber: "0xae4f31",
  transactionHash: "0x" + "ab".repeat(32),
  logs,
});

const expectation = { token: TOKEN, recipient: PAYEE, minAmount: 5_000_000n };

describe("verifying an outcome", () => {
  it("proves a transfer that actually happened", () => {
    const v = verifyTransfer(receipt([transferLog(PAYEE, 5_000_000n)]), expectation);
    assert.equal(v.proven, true);
    assert.equal(v.observed, 5_000_000n);
    assert.match(v.proof, /^0x[0-9a-f]{64}$/);
  });

  /*
   * The case the whole project exists for. A mined transaction with no logs
   * moved nothing -- there is no way to transfer an ERC-20 without emitting
   * Transfer. Every rail that trusts `status: 0x1` accepts this as payment.
   * Observed in production: a settlement that mined successfully while the
   * recipient's balance stayed byte-identical.
   */
  it("refuses a transaction that mined successfully and moved nothing", () => {
    const v = verifyTransfer(receipt([]), expectation);
    assert.equal(v.proven, false);
    assert.match(v.reason, /zero logs/);
  });

  it("refuses when the transfer went to somebody else", () => {
    const other = "0x000000000000000000000000000000000000dEaD";
    const v = verifyTransfer(receipt([transferLog(other, 5_000_000n)]), expectation);
    assert.equal(v.proven, false);
    assert.match(v.reason, /no Transfer/);
  });

  it("refuses a Transfer emitted by a different token", () => {
    // A worthless token can emit a Transfer of any size. The address matters.
    const fake = "0x00000000000000000000000000000000DeaDBeef";
    const v = verifyTransfer(receipt([transferLog(PAYEE, 999_000_000n, fake)]), expectation);
    assert.equal(v.proven, false);
  });

  it("refuses under-delivery and reports what actually moved", () => {
    const v = verifyTransfer(receipt([transferLog(PAYEE, 4_999_999n)]), expectation);
    assert.equal(v.proven, false);
    assert.equal(v.observed, 4_999_999n);
    assert.match(v.reason, /under-delivered/);
  });

  it("sums split transfers to the same recipient", () => {
    const v = verifyTransfer(
      receipt([transferLog(PAYEE, 2_000_000n), transferLog(PAYEE, 3_000_000n)]),
      expectation
    );
    assert.equal(v.proven, true);
    assert.equal(v.observed, 5_000_000n);
  });

  it("accepts a small overage rather than demanding exact equality", () => {
    // Exact equality is brittle: a fee-on-transfer token or a rounding
    // difference would be a false negative on an outcome that did happen.
    const v = verifyTransfer(receipt([transferLog(PAYEE, 5_000_001n)]), expectation);
    assert.equal(v.proven, true);
  });

  it("refuses a reverted transaction", () => {
    const v = verifyTransfer(receipt([transferLog(PAYEE, 5_000_000n)], "0x0"), expectation);
    assert.equal(v.proven, false);
    assert.match(v.reason, /did not succeed/);
  });

  it("treats an unreadable receipt as not proven, never as proven", () => {
    // The asymmetry is deliberate. A false negative costs a retry; a false
    // positive pays someone for nothing.
    for (const r of [null, undefined]) {
      const v = verifyTransfer(r as any, expectation);
      assert.equal(v.proven, false);
    }
  });

  it("binds the proof to this receipt, not just to the amount", () => {
    const a = verifyTransfer(receipt([transferLog(PAYEE, 5_000_000n)]), expectation);
    const b = verifyTransfer(
      { ...receipt([transferLog(PAYEE, 5_000_000n)]), transactionHash: "0x" + "cd".repeat(32) },
      expectation
    );
    assert.notEqual(a.proof, b.proof, "same amount, different tx must not share a proof");
  });
});
