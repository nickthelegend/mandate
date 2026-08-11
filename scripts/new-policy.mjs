/**
 * Write a spending policy and put it on chain, from nothing.
 *
 *   node scripts/new-policy.mjs policies/research-agent.json
 *
 * This is the step the console cannot show, because by the time you load the
 * console a policy already exists. An operator writes the rules, they are
 * canonicalised and hashed, and the hash is registered in `PolicyRegistry`
 * through KeeperHub — which is what makes the limit binding rather than
 * advisory, because the registry then records KeeperHub's wallet as owner and
 * the agent has no key that could change it.
 *
 * Every step prints what it is about to do and what came back, because the
 * point of this file is to be watched.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, Contract } from "ethers";
import { hashCanonicalJson } from "mandate-policy/canon";
import { anchorPolicy, KeeperHubClient } from "mandate-sdk/node";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const env = Object.fromEntries(
  readFileSync(`${ROOT}.env`, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const REGISTRY = env.POLICY_REGISTRY ?? "0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304";
const AGENT = process.env.POLICY_AGENT ?? "0x000000000000000000000000000000000000dEaD";
const file = process.argv[2] ?? "policies/research-agent.json";

const c = { dim: "\x1b[2m", b: "\x1b[1m", o: "\x1b[38;5;208m", g: "\x1b[32m", r: "\x1b[0m" };
const step = (n, s) => console.log(`\n${c.o}${n}${c.r} ${c.b}${s}${c.r}`);

const doc = JSON.parse(readFileSync(`${ROOT}${file}`, "utf8"));

step("1", "The rules an operator wrote");
console.log(`${c.dim}${file}${c.r}`);
for (const [k, v] of Object.entries(doc.rules)) {
  console.log(`   ${k.padEnd(14)} ${c.dim}${JSON.stringify(v)}${c.r}`);
}

step("2", "Canonicalise and hash");
/*
 * RFC 8785, not `JSON.stringify`. Two documents that differ only in key order
 * or number formatting are the same policy and must hash the same, or an
 * operator could re-anchor an identical ruleset and get a different commitment.
 */
const policyHash = hashCanonicalJson(doc.rules);
console.log(`   ${c.dim}RFC 8785 canonical JSON → keccak256${c.r}`);
console.log(`   ${policyHash}`);

const provider = new JsonRpcProvider(env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com", 11155111);
const { id: topicId } = await import("ethers");
const REGISTERED = topicId("PolicyRegistered(uint256,address,address,bytes32,uint64,uint32)");

/**
 * Has this exact document already been anchored?
 *
 * Anchoring is idempotent at the level of the document — the same rules are the
 * same policy — and a script that re-registers blindly mints a second id for a
 * ruleset that already has one. `PolicyRegistered` indexes the hash, so this is
 * one filtered log read rather than a scan.
 */
async function existing(hash) {
  const head = await provider.getBlockNumber();
  const logs = await provider.getLogs({
    address: REGISTRY,
    topics: [REGISTERED, null, null, null],
    fromBlock: head - 45000,
    toBlock: head,
  });
  const hit = logs.find((l) => (l.data ?? "").toLowerCase().includes(hash.slice(2).toLowerCase()));
  return hit ? BigInt(hit.topics[1]).toString() : null;
}

step("3", "Register it in PolicyRegistry, through KeeperHub");
const already = await existing(policyHash).catch(() => null);
if (already) {
  console.log(`   ${c.dim}this document is already anchored — same rules, same policy${c.r}`);
  console.log(`   policyId   ${c.b}${already}${c.r}`);
}
console.log(`   ${c.dim}the agent never holds a key — KeeperHub signs this${c.r}`);
const kh = new KeeperHubClient({ apiKey: env.KEEPERHUB_API_KEY });
/*
 * From the document, not from the clock.
 *
 * The SDK keys idempotency on the policy hash, so a re-run with a Date.now()
 * expiry is the same key carrying a different payload — KeeperHub correctly
 * answers 409. Reading the expiry out of the rules makes the request a pure
 * function of the document: anchoring the same policy twice is genuinely the
 * same request, and returns the original rather than a second registration.
 */
const expiry = Math.floor(Date.parse(doc.rules.expiry) / 1000);
if (!Number.isFinite(expiry)) throw new Error("rules.expiry must be an ISO date");
let policyId = already;
if (!already) {
  const result = await anchorPolicy(
    kh,
    { registry: REGISTRY, chainId: 11155111 },
    { agent: AGENT, policyHash, expiry }
  );
  console.log(`   execution  ${result.executionId}`);
  console.log(`   tx         ${c.g}${result.transactionHash}${c.r}`);
  const receipt = await provider.getTransactionReceipt(result.transactionHash);
  const evt = receipt.logs.find((l) => l.topics[0] === REGISTERED);
  if (!evt) throw new Error("no PolicyRegistered event in the receipt");
  policyId = BigInt(evt.topics[1]).toString();
  console.log(`   policyId   ${c.b}${policyId}${c.r} ${c.dim}← from the PolicyRegistered event${c.r}`);
}

step("4", "Read it back off the chain");
const reg = new Contract(
  REGISTRY,
  [
    "function getPolicy(uint256) view returns (tuple(address owner,uint64 expiry,uint32 version,address agent,uint8 status,bytes32 policyHash))",
    "function isUsable(uint256) view returns (bool)",
  ],
  provider
);
const [p, usable] = await Promise.all([reg.getPolicy(policyId), reg.isUsable(policyId)]);
console.log(`   owner      ${p.owner} ${c.dim}← KeeperHub's wallet, not ours${c.r}`);
console.log(`   policyHash ${p.policyHash}`);
console.log(`   matches    ${p.policyHash.toLowerCase() === policyHash.toLowerCase() ? `${c.g}yes${c.r}` : "NO"}`);
console.log(`   status     ${Number(p.status) === 1 ? `${c.g}ACTIVE${c.r}` : p.status}, usable ${usable}`);

console.log(`\n${c.dim}The rules are now on chain. Editing the file changes its hash, and every`);
console.log(`spend judged against it is refused until somebody re-anchors — which is a`);
console.log(`transaction the agent cannot send.${c.r}\n`);
console.log(`${c.b}POLICY_ID=${policyId}${c.r}`);
