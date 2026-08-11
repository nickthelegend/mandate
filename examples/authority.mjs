/**
 * A complete spending authority, in one file, from the published packages.
 *
 *   npm i mandate-policy mandate-sdk mongodb ethers
 *   node authority.mjs 0.40 market-data
 *
 * This is the whole product as a developer would assemble it. The gateway in
 * this repo is the same five steps wrapped in HTTP, escalations, receipts and a
 * console — none of which change the shape below.
 *
 * The five steps, and the order is the design:
 *
 *   1. Read the policy from the chain, not from the request.
 *   2. Check the document on disk still hashes to the anchor.
 *   3. Read the spend window from a durable ledger, not from memory.
 *   4. Run the rules. They return PROPOSED effects; nothing is applied yet.
 *   5. Apply the effects, then execute through KeeperHub.
 *
 * Step 4 is the one people get wrong. `proposeDecision` computes what *would*
 * change without changing it, which is why the same call is both a preflight
 * and a real decision — a caller that discards the proposal has altered
 * nothing, and there is no code path through which it could have.
 *
 * Nothing here is a wrapper this repo wrote for the example. Every import is a
 * package on npm, and if this file works then the packages compose; if it did
 * not, the SDK would be a private detail of one gateway wearing a public name.
 */

import { proposeDecision, ledgerPartitionKey } from "mandate-policy";
import { hashCanonicalJson } from "mandate-policy/canon";
import {
  mongoLedger,
  assertAnchored,
  statusFromAnchor,
  executeIfAuthorised,
  KeeperHubClient,
} from "mandate-sdk/node";
import { JsonRpcProvider } from "ethers";
import { readFileSync } from "node:fs";

const [, , amountArg = "0.40", category = "market-data"] = process.argv;

const {
  MONGODB_URI,
  KEEPERHUB_API_KEY,
  POLICY_ID,
  POLICY_REGISTRY = "0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304",
  MANDATE_TOKEN = "0x49C86277a91002c4943837bf20F6ED41976Db09F",
  SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com",
} = process.env;

if (!MONGODB_URI || !KEEPERHUB_API_KEY || !POLICY_ID) {
  console.error("needs MONGODB_URI, KEEPERHUB_API_KEY and POLICY_ID");
  process.exit(1);
}

const CHAIN_ID = 11155111;
const AGENT = "example-agent";
const PAYEE = "0x000000000000000000000000000000000000dEaD";
const OWNER = process.env.AUTHORITY_OWNER ?? "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67";

/* The rules the agent is governed by. The file is the source; the chain is the authority. */
const doc = JSON.parse(readFileSync(new URL("./policy.json", import.meta.url), "utf8"));

// ── 1 & 2. The policy comes from the chain ──────────────────────────────────
const provider = new JsonRpcProvider(SEPOLIA_RPC_URL, CHAIN_ID);
const documentHash = hashCanonicalJson(doc.rules);

/*
 * Reads the anchor and checks it in one call, and throws rather than returning
 * a flag — deliberately, because a caller who can forget to check a boolean
 * will. `PolicyAnchorMismatch` means the document was edited after anchoring;
 * `PolicyNotUsable` means it is paused or expired on chain. Either way no spend
 * is judged at all.
 */
const anchored = await assertAnchored(provider, POLICY_REGISTRY, POLICY_ID, documentHash);
const onChain = statusFromAnchor(anchored);
console.log(`policy  v${anchored.version} ${onChain.status}, hash ${documentHash.slice(0, 14)}…`);

// ── 3. The ledger is durable ────────────────────────────────────────────────
const ledger = await mongoLedger({ uri: MONGODB_URI, db: process.env.MANDATE_AUDIT_DB ?? "mandate" });
/*
 * Per agent, not per policy. One owner's policy governs many agents and each
 * gets its own budget and duplicate window — without this, one agent's spending
 * silently consumes another's headroom.
 */
const partition = `${ledgerPartitionKey(POLICY_ID)}:agent:${AGENT}`;
const before = await ledger.read(partition);
console.log(`budget  $${before.budgetUsage.effectiveToday.toFixed(2)} spent today`);

// ── 4. The rules decide, and propose ────────────────────────────────────────
const amount = Number(amountArg);
const b32 = (x) => `0x${x.repeat(32)}`;

/*
 * The intent the engine judges.
 *
 * Two things here catch people out, and both cost me a run while writing this.
 * `token` is the ERC-20 **address**, not the symbol — the policy's
 * `budgets.token` is a display label and the intent's is the contract, and
 * passing "USDT" gets you `REJECTED_MALFORMED: token is not a 20-byte hex
 * address` rather than a rule failure. And `maxAmount` travels with the amount
 * rather than being a fixed ceiling: the bound rule runs *ahead* of the
 * per-call cap, so a constant here refuses large spends on the wrong rule and
 * the trace names a rule the operator never configured.
 */
const intent = {
  owner: OWNER,
  // Derived from the agent id, so two agents are distinguishable to the engine
  // and not merely to the ledger.
  buyerAgentId: BigInt(`0x${hashCanonicalJson({ agent: AGENT }).slice(2, 14)}`),
  workerAgentId: 0n,
  token: MANDATE_TOKEN,
  maxAmount: BigInt(Math.round(amount * 1_000_000)),
  taskHash: hashCanonicalJson({ category, amount }),
  acceptanceHash: b32("22"),
  schemaHash: b32("33"),
  policyHash: documentHash,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  nonce: BigInt(Date.now()),
  endpoint: "https://api.example.com/v1/prices",
  paramsHash: hashCanonicalJson({ amount }),
  recipientAddress: PAYEE,
  category,
  amount,
};

/*
 * The payee's standing, injected as an input.
 *
 * Run this without it and the eighth rule fires: `vendor.lcbFloor` with
 * "vendor score unavailable — escalated per policy", because the document sets
 * `onScoreUnavailable: ESCALATE`. That is the engine behaving correctly, and it
 * is worth seeing once — a missing reputation source escalates to a person, it
 * does not quietly approve.
 *
 * In this repo the number comes from `mandate-bureau`, which scores a payee on
 * seven signals and hands over `score - 1.28 * sigma`. The engine compares the
 * BOUND, never the score, so thin evidence tightens the limit rather than
 * flattering it. Any source with that shape will do — the engine does not care
 * where the number came from, only that it arrives with its uncertainty.
 */
const state = {
  ...before,
  vendorScore: {
    vendorId: PAYEE,
    score: 82,
    sigma: 9,
    lcb: 82 - 1.28 * 9,
    computedAtMs: Date.now(),
    available: true,
  },
};

const { decision, effects } = proposeDecision(
  intent,
  { ...doc, id: POLICY_ID, status: onChain.status, policyHash: anchored.policyHash },
  state
);

const failed = decision.rules.find((r) => r.result === "FAIL");
console.log(
  `verdict ${decision.decision}` +
    (failed ? ` at ${failed.rule} (${decision.rules.length} of 15 consulted)` : ` (all 15 passed)`)
);
if (decision.reasons?.[0]) console.log(`        ${decision.reasons[0]}`);

// ── 5. Apply, then execute ──────────────────────────────────────────────────
if (decision.decision !== "APPROVED") {
  /*
   * Refusals are recorded too. A log that keeps only the approvals cannot
   * answer the question an audit actually asks — what did this agent try to do,
   * and what stopped it.
   */
  await ledger.record({
    at: new Date().toISOString(),
    partitionKey: partition,
    policyId: POLICY_ID,
    intentHash: decision.intentHash,
    decision: decision.decision,
    failedRule: failed?.rule ?? null,
    reason: decision.reasons?.[0] ?? decision.decision,
    amount,
    recipient: PAYEE,
    endpoint: intent.endpoint,
    category,
    rules: decision.rules,
  });
  console.log("\nnothing moved, and the refusal is on the record.");
  process.exit(0);
}

/*
 * Charged BEFORE the transfer. Both orders lose something if the process dies
 * mid-request: charge-first can consume budget for a spend that never happened,
 * execute-first can move money no budget counted. The first over-refuses, the
 * second over-spends — and an authority whose failure mode is "allowed
 * something it should have refused" is not doing its job at all.
 */
await ledger.apply({ ...effects, partitionKey: partition });

const kh = new KeeperHubClient({ apiKey: KEEPERHUB_API_KEY });
const run = await executeIfAuthorised(kh, decision, {
  chainId: CHAIN_ID,
  to: PAYEE,
  amount: amount.toFixed(6),
  tokenAddress: MANDATE_TOKEN,
});

const after = await ledger.read(partition);
console.log(`\nexecuted via KeeperHub`);
console.log(`  execution ${run.executionId}`);
console.log(`  tx        ${run.transactionHash}`);
console.log(`  budget    $${before.budgetUsage.effectiveToday.toFixed(2)} → $${after.budgetUsage.effectiveToday.toFixed(2)}`);
console.log(`\nThe agent held no key. KeeperHub signed it.`);
process.exit(0);
