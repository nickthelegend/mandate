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
 *
 * The flow itself lives in flow.ts, shared with the browser demo. A demo that
 * ran different code from the real client would be worth nothing.
 */

import { runPurchase } from "./flow.ts";

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:4402";
const mode = process.argv[2] === "lying" ? "lying" : "honest";

const key = process.env.X402_PAYER_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
if (!key) {
  console.error("X402_PAYER_KEY or DEPLOYER_PRIVATE_KEY is required: the payer has to sign.");
  process.exit(1);
}

const rule = (s: string) => console.log(`\n${"=".repeat(64)}\n${s}\n${"=".repeat(64)}`);
const link = (h: string) => `https://sepolia.etherscan.io/tx/${h}`;

async function main() {
  rule(`x402 client -> ${mode} facilitator`);

  const result = await runPurchase({
    baseUrl: GATEWAY,
    facilitator: mode,
    payerKey: key!,
    rpcUrl:
      process.env.OUTCOME_RPC_URL ??
      process.env.SEPOLIA_RPC_URL ??
      "https://ethereum-sepolia-rpc.publicnode.com",
    chainId: 11155111,
  });

  for (const step of result.steps) {
    console.log(`\n${step.label}`);
    console.log(`  ${step.detail}`);
    if (step.transactionHash) console.log(`  ${link(step.transactionHash)}`);
  }

  console.log(`\n${"-".repeat(64)}`);
  if (result.served) {
    console.log(`HTTP 200 — got the resource: "${result.article?.title}"`);
    console.log(`  observed ${result.observed}, submitted via ${result.submittedVia}`);
  } else {
    console.log(`HTTP ${result.httpStatus} — resource withheld`);
    console.log(`  facilitator claimed success : ${result.facilitatorClaimedSuccess}`);
    console.log(`  actually observed           : ${result.observed}`);
    console.log(`  reason                      : ${result.reason}`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
