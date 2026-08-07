#!/usr/bin/env node
/**
 * An x402 client, doing the full handshake against the gateway.
 *
 *   1. GET the resource, get 402 and the price
 *   2. sign an EIP-3009 authorisation for exactly that price
 *   3. GET again with X-PAYMENT
 *   4. read what came back
 *
 * Run it twice -- once normally, once with `lying` -- and the difference is the
 * whole project:
 *
 *   node --experimental-strip-types src/client.ts
 *   node --experimental-strip-types src/client.ts lying
 *
 * The second one settles through a facilitator that reports success for a
 * transaction that paid nobody. A stock x402 client gets its article. This one
 * gets a 402 explaining, from the receipt, that no money moved.
 */

import { JsonRpcProvider, Wallet, hexlify, randomBytes } from "ethers";
import {
  encodePaymentHeader,
  X402_VERSION,
  type PaymentRequiredResponse,
  type PaymentPayload,
} from "outcome-sdk/x402";

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:4402";
const mode = process.argv[2] === "lying" ? "lying" : "honest";
const url = `${GATEWAY}/article${mode === "lying" ? "?facilitator=lying" : ""}`;

const key = process.env.X402_PAYER_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
if (!key) {
  console.error("X402_PAYER_KEY or DEPLOYER_PRIVATE_KEY is required: the payer has to sign.");
  process.exit(1);
}

const rule = (s: string) => console.log(`\n${"=".repeat(64)}\n${s}\n${"=".repeat(64)}`);

async function main() {
  const provider = new JsonRpcProvider(
    process.env.OUTCOME_RPC_URL ?? process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
    11155111
  );
  const payer = new Wallet(key!, provider);

  rule(`x402 client -> ${mode} facilitator`);

  // 1. Ask, and be told the price.
  const quote = await fetch(url);
  if (quote.status !== 402) {
    console.error(`expected 402, got ${quote.status}`);
    process.exit(1);
  }
  const body = (await quote.json()) as PaymentRequiredResponse;
  const req = body.accepts[0];

  console.log(`402 ${body.error}`);
  console.log(`  price   ${req.maxAmountRequired} of ${req.asset}`);
  console.log(`  payTo   ${req.payTo}`);
  console.log(`  scheme  ${req.scheme} on ${req.network}`);

  // 2. Sign the authorisation. The payer never sends a transaction.
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: payer.address,
    to: req.payTo,
    value: req.maxAmountRequired,
    validAfter: "0",
    validBefore: String(now + req.maxTimeoutSeconds),
    nonce: hexlify(randomBytes(32)),
  };

  const extra = (req.extra ?? {}) as { name?: string; version?: string };
  const signature = await payer.signTypedData(
    {
      name: extra.name ?? "USD Coin (x402 test)",
      version: extra.version ?? "2",
      chainId: 11155111,
      verifyingContract: req.asset,
    },
    {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    authorization
  );

  const payment: PaymentPayload = {
    x402Version: X402_VERSION,
    scheme: req.scheme,
    network: req.network,
    payload: { signature, authorization },
  };

  console.log(`\nsigned an authorisation for ${authorization.value} — no transaction sent by the payer`);

  // 3. Pay.
  const paid = await fetch(url, { headers: { "X-PAYMENT": encodePaymentHeader(payment) } });
  const result = (await paid.json()) as Record<string, unknown>;

  // 4. Read what came back.
  console.log(`\nHTTP ${paid.status}`);
  if (paid.status === 200) {
    console.log(`  got the resource: "${result.title}"`);
    const p = result.paidWith as Record<string, string>;
    console.log(`  paid in  https://sepolia.etherscan.io/tx/${p.transaction}`);
    console.log(`  observed ${p.observed} to ${req.payTo}`);
    console.log(`  verified against ${p.verifiedAgainst}`);
  } else {
    const o = result.outcome as Record<string, unknown> | undefined;
    console.log(`  resource withheld: ${result.error}`);
    if (o) {
      console.log(`  facilitator claimed success : ${o.facilitatorClaimedSuccess}`);
      console.log(`  transaction                 : ${o.transaction ?? "(none)"}`);
      console.log(`  actually observed           : ${o.observed}`);
      console.log(`  reason                      : ${o.reason}`);
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
