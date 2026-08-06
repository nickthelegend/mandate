import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diagnose, worthRescuing } from "../src/diagnose.ts";

describe("diagnosing a failure", () => {
  it("never resends an in-flight transaction", () => {
    /*
     * The most expensive misclassification in the file. A timeout is not a
     * failure -- the transaction may be landing right now. Treating it as one
     * and resending is how you execute twice. This outranks every other
     * pattern, including ones whose words also appear in the string.
     */
    for (const reason of [
      "request timed out",
      "already known",
      "A request with this Idempotency-Key is already being processed",
      "execution in progress",
    ]) {
      const d = diagnose({ reason });
      assert.equal(d.cause, "in_flight", reason);
      assert.equal(d.retryable, false);
      assert.equal(worthRescuing(d), false);
    }
  });

  it("separates allowance from balance, which share a word", () => {
    // "insufficient allowance" contains "insufficient". Ordering matters, and
    // the two need different corrections.
    const allowance = diagnose({ reason: "ERC20: insufficient allowance" });
    assert.equal(allowance.cause, "insufficient_allowance");
    assert.match(allowance.correction, /approval/);

    const funds = diagnose({ reason: "insufficient funds for gas * price + value" });
    assert.equal(funds.cause, "insufficient_funds");
    assert.match(funds.correction, /fund the payer/);
  });

  it("retries gas failures with a raised limit", () => {
    const d = diagnose({ reason: "out of gas" });
    assert.equal(d.cause, "out_of_gas");
    assert.equal(d.retryable, true);
    assert.ok(d.gasMultiplier > 1, "a retry at the same limit fails identically");
    assert.equal(worthRescuing(d), true);
  });

  it("infers out-of-gas from a receipt that consumed its whole limit", () => {
    // Nodes often report this as a bare revert. The distinction decides whether
    // a retry is free money or wasted gas.
    const d = diagnose({ status: "0x0", gasUsed: 99_500n, gasLimit: 100_000n });
    assert.equal(d.cause, "out_of_gas");
    assert.equal(d.retryable, true);
  });

  it("does not mistake a cheap revert for out-of-gas", () => {
    const d = diagnose({ status: "0x0", gasUsed: 24_000n, gasLimit: 100_000n });
    assert.equal(d.cause, "reverted");
    assert.equal(d.retryable, false);
  });

  it("resends a nonce conflict unchanged", () => {
    const d = diagnose({ reason: "nonce too low" });
    assert.equal(d.cause, "nonce_conflict");
    assert.equal(d.retryable, true);
    assert.equal(d.gasMultiplier, 1);
  });

  it("declines a revert, because state has to change first", () => {
    const d = diagnose({ reason: "execution reverted: ExceedsCreditLimit" });
    assert.equal(d.cause, "reverted");
    assert.equal(worthRescuing(d), false);
    assert.match(d.correction, /state must change/);
  });

  it("declines the unknown rather than guessing toward a resend", () => {
    // Guessing "send it again" is the expensive guess.
    const d = diagnose({ reason: "something nobody has seen before" });
    assert.equal(d.cause, "unknown");
    assert.equal(worthRescuing(d), false);
  });

  it("classifies with no reason string at all", () => {
    assert.equal(diagnose({ status: "0x0" }).cause, "reverted");
    assert.equal(diagnose({}).cause, "unknown");
  });

  it("only ever recommends rescuing what a resend can actually fix", () => {
    // The economic guard: a success-fee service that takes unfixable work does
    // it for free.
    const fixable = ["out of gas", "nonce too low"];
    const not = [
      "execution reverted",
      "insufficient funds",
      "ERC20: insufficient allowance",
      "timed out",
      "mystery",
    ];
    for (const r of fixable) assert.equal(worthRescuing(diagnose({ reason: r })), true, r);
    for (const r of not) assert.equal(worthRescuing(diagnose({ reason: r })), false, r);
  });
});
