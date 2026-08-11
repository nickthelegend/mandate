/**
 * Tests for the Challenge Binding Check.
 *
 * The attack this exists to stop: a listing advertises one thing, the 402
 * challenge asks for another, and an unattended payer signs the challenge
 * because that is what the protocol hands it. Every test below is one field
 * being swapped between reading the listing and paying for it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { bindingFor, bindingMismatches, bindingHolds } from "../src/x402-guard.ts";

const LISTING = {
  slug: "mandate-policy-status",
  amount: "20000",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67",
  chainId: 8453,
  baseUrl: "https://app.keeperhub.com",
};

const honest = {
  amount: "20000",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  payTo: "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67",
  chainId: 8453,
};

test("a challenge matching the listing binds", () => {
  assert.equal(bindingHolds(bindingFor(LISTING, honest)), true);
});

test("addresses bind case-insensitively", () => {
  // The same address in a different EIP-55 casing is the same address; a
  // mismatch here would refuse every honest challenge from a server that
  // lowercases.
  const b = bindingFor(LISTING, { ...honest, payTo: LISTING.payTo.toLowerCase() });
  assert.equal(bindingHolds(b), true);
});

test("a swapped payee is caught, at the same price", () => {
  // The dangerous case: the price looks right, so a cap does not fire.
  const b = bindingFor(LISTING, {
    ...honest,
    payTo: "0x000000000000000000000000000000000000dEaD",
  });
  const m = bindingMismatches(b);
  assert.equal(m.length, 1);
  assert.equal(m[0].field, "recipient");
});

test("a raised price is caught", () => {
  const m = bindingMismatches(bindingFor(LISTING, { ...honest, amount: "50000000" }));
  assert.deepEqual(m.map((x) => x.field), ["amount"]);
});

test("a swapped asset is caught", () => {
  const m = bindingMismatches(
    bindingFor(LISTING, { ...honest, asset: "0x0000000000000000000000000000000000000001" })
  );
  assert.deepEqual(m.map((x) => x.field), ["token"]);
});

test("several swaps are all reported, not just the first", () => {
  // A caller refusing this should be able to say everything that was wrong.
  const m = bindingMismatches(
    bindingFor(LISTING, {
      amount: "99",
      asset: "0x0000000000000000000000000000000000000001",
      payTo: "0x000000000000000000000000000000000000dEaD",
    })
  );
  assert.deepEqual(m.map((x) => x.field).sort(), ["amount", "recipient", "token"]);
});

test("a field absent on both sides is not a mismatch", () => {
  // Neither party committed to it, so there is nothing to disagree about.
  const b = bindingFor({ slug: "s" }, { amount: "1", asset: "0xa", payTo: "0xb" });
  assert.deepEqual(
    bindingMismatches(b).map((m) => m.field).sort(),
    ["amount", "recipient", "token"]
  );
});

test("nonce and expiry are carried only when the challenge supplied them", () => {
  const without = bindingFor(LISTING, honest);
  assert.equal(without.presented.nonce, undefined);
  // Inventing one would make the replay half of the rule pass on a challenge
  // that never carried a nonce.
  const with_ = bindingFor(LISTING, { ...honest, nonce: "0xabc", expiry: 1800000000 });
  assert.equal(with_.presented.nonce, "0xabc");
  assert.equal(with_.presented.expiry, "1800000000");
});

test("the binding is the shape the policy rule reads", () => {
  // `replay.contextBinding` indexes `expected` and `presented` by these names.
  const b = bindingFor(LISTING, honest);
  for (const field of ["recipient", "token", "amount", "resourceUrl", "endpoint", "method"]) {
    assert.ok(field in b.expected, `expected is missing ${field}`);
    assert.ok(field in b.presented, `presented is missing ${field}`);
  }
});
