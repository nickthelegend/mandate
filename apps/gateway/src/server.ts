#!/usr/bin/env node
/**
 * An x402 resource server that checks it was actually paid.
 *
 * The protocol flow is unchanged and fully standard:
 *
 *   GET /article                 -> 402 + PaymentRequirements
 *   GET /article  X-PAYMENT: ..  -> facilitator settles -> 200 + resource
 *
 * One step is added between settling and serving. x402 ends at "the facilitator
 * said success"; this reads the transaction the facilitator named and confirms
 * the money reached `payTo` before the resource is released. If it did not, the
 * request gets another 402 carrying the actual reason.
 *
 * Run it against `?facilitator=lying` to watch the difference. That mode
 * settles by submitting an `approve` -- which mines, emits a log, and pays
 * nobody -- and reports success. A stock x402 server serves the article. This
 * one does not, and says why.
 */

import { createServer } from "node:http";
import { JsonRpcProvider, Wallet } from "ethers";

import { OutcomeClient } from "outcome-sdk";
import { KeeperHubClient } from "outcome-sdk/node";
import {
  paymentRequired,
  decodePaymentHeader,
  encodeSettlementHeader,
  verifySettlement,
  type PaymentRequirements,
} from "outcome-sdk/x402";

import { createFacilitator, type FacilitatorMode } from "./facilitator.ts";

const PORT = Number(process.env.PORT ?? 4402);
const NETWORK = "sepolia";
const CHAIN_ID = 11155111;

const RPC = process.env.OUTCOME_RPC_URL ?? process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const ASSET = process.env.X402_ASSET ?? "0x0d864A625c280F7f9B9AD024d12F94f5D6DCCF13";
const ESCROW = process.env.OUTCOME_ESCROW ?? "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B";
const PRICE = process.env.X402_PRICE ?? "1000000"; // 1.00 USDCx

/*
 * The merchant is deliberately not the facilitator. They are different roles in
 * x402 and collapsing them into one address would make the demo a self-transfer
 * -- which verifies, but proves nothing, since the party checking the payment
 * would also be the party receiving it.
 */
const PAY_TO = process.env.X402_PAY_TO ?? "0x000000000000000000000000000000000000dEaD";

const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key) {
  console.error("DEPLOYER_PRIVATE_KEY is required: the facilitator submits real transactions.");
  process.exit(1);
}

const provider = new JsonRpcProvider(RPC, CHAIN_ID);
const wallet = new Wallet(key, provider);

/*
 * With a KeeperHub key the honest facilitator settles through KeeperHub and the
 * merchant never needs gas. Without one it falls back to the local wallet, so
 * the demo still runs for anyone who clones this without an account.
 */
const kh = process.env.KEEPERHUB_API_KEY
  ? new KeeperHubClient({ apiKey: process.env.KEEPERHUB_API_KEY })
  : undefined;
const outcome = new OutcomeClient({ provider, escrow: ESCROW, token: ASSET, chainId: CHAIN_ID });

/** The article, which is the thing being sold. */
const ARTICLE = {
  title: "A status byte is not evidence",
  body:
    "status: 0x1 means the EVM did not revert. It does not mean value moved. " +
    "A transaction can mine, emit no Transfer, pay nobody, and satisfy every " +
    "check x402 performs. You are reading this because the settlement that " +
    "bought it was checked against the chain, not against a facilitator's word.",
};

function requirements(resource: string): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    maxAmountRequired: PRICE,
    asset: ASSET,
    payTo: PAY_TO,
    resource,
    description: ARTICLE.title,
    mimeType: "application/json",
    maxTimeoutSeconds: 120,
    // EIP-712 domain the payer must sign under. x402 carries this in `extra`.
    extra: { name: "USD Coin (x402 test)", version: "2" },
  };
}

const json = (res: import("node:http").ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}) => {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "x-payment-response",
    ...headers,
  });
  res.end(payload);
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/health") return json(res, 200, { ok: true, asset: ASSET, payTo: PAY_TO, facilitator: wallet.address });

  if (url.pathname !== "/article") {
    return json(res, 404, { error: "not found", try: "/article" });
  }

  const resource = `http://localhost:${PORT}/article`;
  const req402 = requirements(resource);
  const header = req.headers["x-payment"];

  // No payment yet: quote the price. This is a plain x402 402.
  if (!header || typeof header !== "string") {
    return json(res, 402, paymentRequired(req402, "payment required"));
  }

  let payment;
  try {
    payment = decodePaymentHeader(header);
  } catch (e: unknown) {
    return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }

  const mode = (url.searchParams.get("facilitator") ?? "honest") as FacilitatorMode;
  const facilitator = createFacilitator({
    mode,
    provider,
    wallet,
    network: NETWORK,
    chainId: CHAIN_ID,
    kh,
  });

  console.log(`[gateway] settling via the ${mode} facilitator, submitted by ${facilitator.submittedVia}…`);
  const settlement = await facilitator.settle(payment, ASSET);
  console.log(`[gateway] facilitator says: success=${settlement.success} tx=${settlement.transaction || "(none)"}`);

  // The step x402 does not have.
  const verdict = await verifySettlement(outcome, { requirements: req402, settlement });
  console.log(`[gateway] chain says: proven=${verdict.proven} — ${verdict.reason}`);

  if (!verdict.proven) {
    /*
     * Another 402 rather than a 500. Nothing errored: the request is still
     * unpaid, and saying so in the protocol's own terms is what lets a client
     * retry properly.
     */
    return json(
      res,
      402,
      {
        ...paymentRequired(req402, "settlement did not pay"),
        outcome: {
          facilitatorClaimedSuccess: verdict.facilitatorClaimedSuccess,
          transaction: settlement.transaction || null,
          observed: verdict.observed.toString(),
          reason: verdict.reason,
        },
      },
      settlement.transaction ? { "x-payment-response": encodeSettlementHeader(settlement) } : {}
    );
  }

  return json(
    res,
    200,
    {
      ...ARTICLE,
      paidWith: {
        transaction: settlement.transaction,
        observed: verdict.observed.toString(),
        proof: verdict.proof,
        verifiedAgainst: "the receipt, not the facilitator",
        submittedVia: facilitator.submittedVia,
      },
    },
    { "x-payment-response": encodeSettlementHeader(settlement) }
  );
});

server.listen(PORT, () => {
  console.log(`x402 gateway on http://localhost:${PORT}`);
  console.log(`  resource  GET /article`);
  console.log(`  price     ${PRICE} of ${ASSET}`);
  console.log(`  payTo     ${PAY_TO} (merchant)`);
  console.log(`  submitter ${kh ? "KeeperHub (gas sponsored, merchant needs no ETH)" : wallet.address + " (local wallet)"}`);
  console.log(`  network   ${NETWORK} (${CHAIN_ID})`);
  console.log(`\n  try ?facilitator=lying to see a settlement that reports success and pays nobody.`);
});
