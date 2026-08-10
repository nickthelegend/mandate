/**
 * Tests for the x402 layer.
 *
 * Two things are under test and they are different in kind. The codecs have to
 * match the specification exactly, because a field name that is merely
 * reasonable makes this incompatible with every other x402 implementation. And
 * `verifySettlement` has to refuse a facilitator that says yes -- which is the
 * only case that matters, since a facilitator saying no has nothing to gain by
 * lying.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { id as ethersId } from "ethers";

import {
  X402_VERSION,
  encodePaymentHeader,
  decodePaymentHeader,
  encodeSettlementHeader,
  decodeSettlementHeader,
  paymentRequired,
  verifySettlement,
  NETWORK_CHAIN_IDS,
  type PaymentRequirements,
  type PaymentPayload,
  type SettlementResponse,
} from "../src/x402.ts";

const ASSET = "0x0d864A625c280F7f9B9AD024d12F94f5D6DCCF13";
const PAY_TO = "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67";
const PAYER = "0x000000000000000000000000000000000000dEaD";
const HASH = "0x" + "cd".repeat(32);

const TRANSFER = ethersId("Transfer(address,address,uint256)");
const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");

const REQUIREMENTS: PaymentRequirements = {
  scheme: "exact",
  network: "sepolia",
  maxAmountRequired: "1000000",
  asset: ASSET,
  payTo: PAY_TO,
  resource: "https://example.test/article",
  description: "One article",
  mimeType: "application/json",
  maxTimeoutSeconds: 60,
};

const PAYLOAD: PaymentPayload = {
  x402Version: X402_VERSION,
  scheme: "exact",
  network: "sepolia",
  payload: {
    signature: "0x" + "ab".repeat(65),
    authorization: {
      from: PAYER,
      to: PAY_TO,
      value: "1000000",
      validAfter: "0",
      validBefore: "9999999999",
      nonce: "0x" + "11".repeat(32),
    },
  },
};

/** A provider whose only job is to hand back one receipt. */
function clientReturning(receipt: unknown) {
  return { getTransactionReceipt: async () => receipt } as never;
}

const receiptPaying = (to: string, value: bigint, token = ASSET) => ({
  status: 1,
  blockNumber: 100,
  hash: HASH,
  logs: [
    {
      address: token,
      topics: [TRANSFER, pad(PAYER), pad(to)],
      data: "0x" + value.toString(16).padStart(64, "0"),
    },
  ],
});

test("the 402 body carries exactly the fields the specification names", () => {
  const body = paymentRequired(REQUIREMENTS, "payment required");

  assert.deepEqual(Object.keys(body).sort(), ["accepts", "error", "x402Version"]);
  assert.equal(body.x402Version, 1);
  assert.equal(body.accepts.length, 1);

  // Renaming any of these silently breaks interoperability with every other
  // x402 client, and nothing local would fail.
  for (const k of [
    "scheme",
    "network",
    "maxAmountRequired",
    "asset",
    "payTo",
    "resource",
    "description",
    "maxTimeoutSeconds",
  ]) {
    assert.ok(k in body.accepts[0], `PaymentRequirements is missing ${k}`);
  }
  assert.equal(typeof body.accepts[0].maxAmountRequired, "string");
});

test("payment headers round-trip through base64", () => {
  const header = encodePaymentHeader(PAYLOAD);
  assert.doesNotMatch(header, /[{}"]/, "header should be base64, not raw JSON");
  assert.deepEqual(decodePaymentHeader(header), PAYLOAD);

  const settlement: SettlementResponse = {
    success: true,
    transaction: HASH,
    network: "sepolia",
    payer: PAYER,
  };
  assert.deepEqual(decodeSettlementHeader(encodeSettlementHeader(settlement)), settlement);
});

test("a malformed payment header is rejected, not half-parsed", () => {
  // This value comes off the network and decides whether a resource is served.
  assert.throws(() => decodePaymentHeader("not base64 at all!!"), /base64/);
  assert.throws(() => decodePaymentHeader(btoa("{}")), /scheme or network/);
  assert.throws(
    () => decodePaymentHeader(btoa(JSON.stringify({ scheme: "exact", network: "sepolia" }))),
    /signature or authorization/
  );

  const missingNonce = JSON.parse(JSON.stringify(PAYLOAD));
  delete missingNonce.payload.authorization.nonce;
  assert.throws(() => decodePaymentHeader(btoa(JSON.stringify(missingNonce))), /nonce/);
});

test("a settlement that really paid is proven", async () => {
  const v = await verifySettlement(clientReturning(receiptPaying(PAY_TO, 1_000_000n)), {
    requirements: REQUIREMENTS,
    settlement: { success: true, transaction: HASH, network: "sepolia", payer: PAYER },
  });

  assert.equal(v.proven, true);
  assert.equal(v.observed, 1_000_000n);
});

test("a facilitator claiming success for a transaction that moved nothing is refused", async () => {
  /*
   * The case the protocol cannot see. status 0x1, a log present, and no
   * Transfer to payTo -- an approve, say. Every check x402 actually performs
   * passes, and the resource would be served for free.
   */
  const v = await verifySettlement(
    clientReturning({
      status: 1,
      blockNumber: 100,
      hash: HASH,
      logs: [{ address: ASSET, topics: [ethersId("Approval(address,address,uint256)")], data: "0x" }],
    }),
    {
      requirements: REQUIREMENTS,
      settlement: { success: true, transaction: HASH, network: "sepolia", payer: PAYER },
    }
  );

  assert.equal(v.proven, false);
  assert.equal(v.facilitatorClaimedSuccess, true);
  assert.match(v.reason, /no Transfer/);
});

test("payment to the wrong recipient does not count", async () => {
  const v = await verifySettlement(clientReturning(receiptPaying(PAYER, 1_000_000n)), {
    requirements: REQUIREMENTS,
    settlement: { success: true, transaction: HASH, network: "sepolia", payer: PAYER },
  });
  assert.equal(v.proven, false);
});

test("underpayment does not count", async () => {
  const v = await verifySettlement(clientReturning(receiptPaying(PAY_TO, 999_999n)), {
    requirements: REQUIREMENTS,
    settlement: { success: true, transaction: HASH, network: "sepolia", payer: PAYER },
  });
  assert.equal(v.proven, false);
});

test("a transfer of some other token does not count", async () => {
  // A facilitator settling in a token it minted itself would otherwise pass.
  const v = await verifySettlement(
    clientReturning(receiptPaying(PAY_TO, 1_000_000n, "0x1111111111111111111111111111111111111111")),
    {
      requirements: REQUIREMENTS,
      settlement: { success: true, transaction: HASH, network: "sepolia", payer: PAYER },
    }
  );
  assert.equal(v.proven, false);
});

test("success with no transaction named is refused without a chain read", async () => {
  let read = false;
  const client = {
    getTransactionReceipt: async () => {
      read = true;
      return null;
    },
  } as never;

  const v = await verifySettlement(client, {
    requirements: REQUIREMENTS,
    settlement: { success: true, transaction: "", network: "sepolia", payer: PAYER },
  });

  assert.equal(v.proven, false);
  assert.match(v.reason, /named no transaction/);
  assert.equal(read, false, "should not have queried the chain");
});

test("a facilitator reporting failure is believed", async () => {
  // Claiming failure is against its interest, and there is nothing to check.
  const v = await verifySettlement(clientReturning(null), {
    requirements: REQUIREMENTS,
    settlement: {
      success: false,
      errorReason: "insufficient_funds",
      transaction: "",
      network: "sepolia",
      payer: PAYER,
    },
  });

  assert.equal(v.proven, false);
  assert.equal(v.facilitatorClaimedSuccess, false);
  assert.match(v.reason, /insufficient_funds/);
});

test("the networks named map to the right chains", () => {
  assert.equal(NETWORK_CHAIN_IDS["base"], 8453);
  assert.equal(NETWORK_CHAIN_IDS["base-sepolia"], 84532);
  assert.equal(NETWORK_CHAIN_IDS["sepolia"], 11155111);
});
