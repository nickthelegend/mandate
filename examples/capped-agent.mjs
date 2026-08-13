/**
 * An agent with a budget it cannot exceed, in one file.
 *
 *   node capped-agent.mjs 0.40      inside the cap
 *   node capped-agent.mjs 5.00      over it
 *
 * Five steps, and the order is the design:
 *   1. the policy comes from the chain, not from the request
 *   2. the spend window comes from a durable ledger, not from memory
 *   3. the rules PROPOSE — nothing has changed yet
 *   4. a refusal names the rule, and stops
 *   5. only an approval reaches KeeperHub, which signs it
 *
 * Every import is a package on npm. This process holds no signing key at any
 * point; the one wallet involved belongs to KeeperHub.
 */

import { proposeDecision, ledgerPartitionKey } from "mandate-policy";
import { hashCanonicalJson } from "mandate-policy/canon";
import { assertAnchored, statusFromAnchor, mongoLedger, executeIfAuthorised, KeeperHubClient } from "mandate-sdk/node";
import { JsonRpcProvider } from "ethers";
import { readFileSync } from "node:fs";

const amount = Number(process.argv[2] ?? "0.40");
const category = process.argv[3] ?? "market-data";
const { MONGODB_URI, KEEPERHUB_API_KEY, POLICY_ID } = process.env;
const REGISTRY = "0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304";
const TOKEN = "0x49C86277a91002c4943837bf20F6ED41976Db09F";
const PAYEE = "0x000000000000000000000000000000000000dEaD";
const AGENT = "capped-agent";

const g = "\x1b[32m", r = "\x1b[31m", d = "\x1b[2m", x = "\x1b[0m";

// 1 ─ the rules on disk must still hash to what the chain holds
const doc = JSON.parse(readFileSync(new URL("./policy.json", import.meta.url), "utf8"));
const provider = new JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com", 11155111);
const anchored = await assertAnchored(provider, REGISTRY, POLICY_ID, hashCanonicalJson(doc.rules));
console.log(`policy   v${anchored.version} ${statusFromAnchor(anchored).status}  ${d}${anchored.policyHash.slice(0, 14)}…${x}`);

// 2 ─ the spend window is durable, and partitioned per agent
const ledger = await mongoLedger({ uri: MONGODB_URI, db: process.env.MANDATE_AUDIT_DB ?? "mandate" });
const partition = `${ledgerPartitionKey(POLICY_ID)}:agent:${AGENT}`;
const state = await ledger.read(partition);
console.log(`budget   $${state.budgetUsage.effectiveToday.toFixed(2)} of $${doc.rules.budgets.daily}.00 spent today`);

// 3 ─ the rules propose; nothing has been applied
const b32 = (v) => `0x${v.repeat(32)}`;
const intent = {
  owner: "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67",
  buyerAgentId: BigInt(`0x${hashCanonicalJson({ agent: AGENT }).slice(2, 14)}`),
  workerAgentId: 0n,
  token: TOKEN,                                   // the address, not the symbol
  maxAmount: BigInt(Math.round(amount * 1e6)),    // travels with the amount
  taskHash: hashCanonicalJson({ category, amount }),
  acceptanceHash: b32("22"),
  schemaHash: b32("33"),
  policyHash: anchored.policyHash,
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  nonce: BigInt(Date.now()),
  endpoint: "https://api.example.com/v1/prices",
  paramsHash: hashCanonicalJson({ amount, at: Date.now() }),
  recipientAddress: PAYEE,
  category,
  amount,
};
// The payee's standing, with its uncertainty. The engine compares the BOUND,
// never the score, so thin evidence tightens the limit rather than flattering it.
const scored = { ...state, vendorScore: { vendorId: PAYEE, score: 82, sigma: 9, lcb: 82 - 1.28 * 9, computedAtMs: Date.now(), available: true } };

const { decision, effects } = proposeDecision(
  intent,
  { ...doc, id: POLICY_ID, status: statusFromAnchor(anchored).status, policyHash: anchored.policyHash },
  scored
);

// 4 ─ a refusal names its rule, and stops
const failed = decision.rules.find((rule) => rule.result === "FAIL");
if (decision.decision !== "APPROVED") {
  console.log(`\n${r}${decision.decision}${x} at ${failed.rule}  ${d}(${decision.rules.length} of 15 consulted)${x}`);
  console.log(`${d}${decision.reasons?.[0] ?? ""}${x}`);
  console.log(`\n${d}nothing moved. no execution exists to undo.${x}`);
  process.exit(0);
}

// 5 ─ charge the budget, then let KeeperHub sign
await ledger.apply({ ...effects, partitionKey: partition });
const run = await executeIfAuthorised(new KeeperHubClient({ apiKey: KEEPERHUB_API_KEY }), decision, {
  chainId: 11155111,
  to: PAYEE,
  amount: amount.toFixed(6),
  tokenAddress: TOKEN,
});
console.log(`\n${g}APPROVED${x}  all 15 rules passed`);
console.log(`tx       ${g}${run.transactionHash}${x}  ${d}signed by KeeperHub${x}`);
process.exit(0);
