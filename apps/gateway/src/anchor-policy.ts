#!/usr/bin/env node
/**
 * Anchor this gateway's policy document on Sepolia.
 *
 * Run once, then put the printed POLICY_ID in the environment. From that point
 * the document on disk and the record on chain are bound: change any rule and
 * the hash no longer matches the anchor, and every spend is refused by
 * `assertAnchored` before the engine is even consulted.
 *
 * The write goes through KeeperHub rather than a local signer, for the same
 * reason the spends do. An authority whose rules can be rewritten with a
 * private key in someone's `.env` is a suggestion with extra steps.
 *
 *   node --experimental-strip-types src/anchor-policy.ts
 *   node --experimental-strip-types src/anchor-policy.ts --pause <policyId>
 *   node --experimental-strip-types src/anchor-policy.ts --resume <policyId>
 */

import { JsonRpcProvider, Contract } from "ethers";
import {
  KeeperHubClient,
  anchorPolicy,
  updateAnchoredPolicy,
  readAnchoredPolicy,
} from "mandate-sdk/node";

import { POLICY_DOC, POLICY_HASH, REGISTRY } from "./authority.ts";

const CHAIN_ID = 11155111;
const RPC =
  process.env.MANDATE_RPC_URL ??
  process.env.SEPOLIA_RPC_URL ??
  "https://ethereum-sepolia-rpc.publicnode.com";
const AGENT = process.env.AUTHORITY_AGENT ?? "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67";

const apiKey = process.env.KEEPERHUB_API_KEY;
if (!apiKey) {
  console.error("KEEPERHUB_API_KEY is required: the anchor is written through KeeperHub.");
  process.exit(1);
}

const kh = new KeeperHubClient({ apiKey });
const provider = new JsonRpcProvider(RPC, CHAIN_ID);

/*
 * `pausePolicy` is `onlyOwner`, and the owner is whoever sent `registerPolicy`
 * -- the KeeperHub relayer, not this machine's key. So the pause goes through
 * KeeperHub too, using the same ABI the anchor module already carries.
 */
const REGISTRY_WRITE_ABI = JSON.stringify([
  {
    type: "function",
    name: "pausePolicy",
    stateMutability: "nonpayable",
    inputs: [{ name: "policyId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "resumePolicy",
    stateMutability: "nonpayable",
    inputs: [{ name: "policyId", type: "uint256" }],
    outputs: [],
  },
]);

async function setStatus(fn: "pausePolicy" | "resumePolicy", policyId: string) {
  const status = await kh.executeAndConfirm(
    {
      contractAddress: REGISTRY,
      chainId: CHAIN_ID,
      functionName: fn,
      abi: REGISTRY_WRITE_ABI,
      functionArgs: JSON.stringify([policyId]),
    },
    // Time-keyed: a pause and a later resume of the same policy are different
    // intents, and a fixed key would make the second one a no-op replay of the first.
    { idempotencyKey: `${fn}-${policyId}-${Date.now()}`, timeoutMs: 180_000 }
  );
  console.log(`${fn}: ${status.status}  tx ${status.transactionHash ?? "(none)"}`);
  const rec = await readAnchoredPolicy(provider, REGISTRY, policyId);
  console.log(`  on chain now: status=${rec.status} usable=${rec.usable}`);
}

const [flag, arg] = process.argv.slice(2);

if (flag === "--pause" || flag === "--resume") {
  if (!arg) {
    console.error(`usage: ${flag} <policyId>`);
    process.exit(1);
  }
  await setStatus(flag === "--pause" ? "pausePolicy" : "resumePolicy", arg);
  process.exit(0);
}

if (flag === "--update") {
  if (!arg) {
    console.error("usage: --update <policyId>");
    process.exit(1);
  }
  /*
   * Re-anchor an edited document.
   *
   * This is the only way to widen a budget, and it is deliberately a
   * transaction rather than a file save: the registry bumps the version and
   * emits an event, so "we raised the limit afterwards" is a timestamped fact
   * rather than something an operator can deny.
   */
  const before = await readAnchoredPolicy(provider, REGISTRY, arg);
  console.log(`registry holds ${before.policyHash} (v${before.version})`);
  console.log(`document hashes to ${POLICY_HASH}`);
  if (before.policyHash.toLowerCase() === POLICY_HASH.toLowerCase()) {
    console.log("already anchored to this document; nothing to do.");
    process.exit(0);
  }

  const res = await updateAnchoredPolicy(
    kh,
    { registry: REGISTRY, chainId: CHAIN_ID },
    {
      policyId: arg,
      policyHash: POLICY_HASH,
      expiry: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    },
    { timeoutMs: 180_000 }
  );
  console.log(`updated: ${res.status}  tx ${res.transactionHash}`);
  const after = await readAnchoredPolicy(provider, REGISTRY, arg);
  console.log(`  now: v${after.version} hash=${after.policyHash} usable=${after.usable}`);
  process.exit(0);
}

if (flag === "--check") {
  if (!arg) {
    console.error("usage: --check <policyId>");
    process.exit(1);
  }
  const rec = await readAnchoredPolicy(provider, REGISTRY, arg);
  console.log(JSON.stringify({ ...rec, documentHash: POLICY_HASH, matches: rec.policyHash.toLowerCase() === POLICY_HASH.toLowerCase() }, null, 2));
  process.exit(0);
}

console.log(`document hash: ${POLICY_HASH}`);
console.log(`rules: ${JSON.stringify(POLICY_DOC.rules)}`);

const result = await anchorPolicy(
  kh,
  { registry: REGISTRY, chainId: CHAIN_ID },
  {
    agent: AGENT,
    policyHash: POLICY_HASH,
    // One month. An anchor without an expiry is a permission nobody ever revisits.
    expiry: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
  },
  { timeoutMs: 180_000 }
);

console.log(`\nanchored: ${result.status}`);
console.log(`tx: ${result.transactionHash}`);

/*
 * `registerPolicy` returns the id, but a return value is not in the receipt --
 * only the event is. Read it back from the log this transaction emitted rather
 * than recomputing `keccak(owner, nonce)`, which would be a second answer that
 * could disagree with the chain's.
 */
const receipt = await provider.getTransactionReceipt(result.transactionHash!);
const iface = new Contract(REGISTRY, [
  "event PolicyRegistered(uint256 indexed policyId, address indexed owner, address indexed agent, bytes32 policyHash, uint64 expiry, uint32 version)",
]).interface;

for (const log of receipt?.logs ?? []) {
  try {
    const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
    if (parsed?.name === "PolicyRegistered") {
      console.log(`\nPOLICY_ID=${parsed.args.policyId.toString()}`);
      console.log(`owner:  ${parsed.args.owner}`);
      console.log(`agent:  ${parsed.args.agent}`);
    }
  } catch {
    // Not our event. The receipt carries every log the transaction produced.
  }
}
