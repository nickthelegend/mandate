/**
 * Writing a spend policy on chain, through KeeperHub.
 *
 * A policy that lives only in a config file is a policy the operator can edit
 * after the fact, which makes every decision citing it unfalsifiable. Anchoring
 * the canonical hash fixes that: a decision names the policy version it was
 * judged under, and anyone can check that version was live at that moment.
 *
 * The anchor goes through KeeperHub's execute API rather than a local signer,
 * and that is the whole point rather than a convenience. The same property that
 * makes the spend gate binding -- the operator's agent holds no key, KeeperHub
 * owns the signer -- has to hold for the policy writes too. An authority whose
 * rules can be rewritten with a private key sitting in someone's .env is not an
 * authority; it is a suggestion with extra steps.
 *
 * So: the agent cannot spend outside its policy, and it cannot quietly rewrite
 * the policy either. Both paths run through the same execution layer, and both
 * leave the same audit trail.
 */

import type { KeeperHubClient } from "./keeperhub/client.ts";
import type { ExecutionStatusResponse } from "./keeperhub/types.ts";

/** The subset of PolicyRegistry this module drives. */
export const POLICY_REGISTRY_ABI = JSON.stringify([
  {
    type: "function",
    name: "registerPolicy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agent", type: "address" },
      { name: "policyHash", type: "bytes32" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ name: "policyId", type: "uint256" }],
  },
  {
    type: "function",
    name: "updatePolicy",
    stateMutability: "nonpayable",
    inputs: [
      { name: "policyId", type: "uint256" },
      { name: "newPolicyHash", type: "bytes32" },
      { name: "newExpiry", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "pausePolicy",
    stateMutability: "nonpayable",
    inputs: [{ name: "policyId", type: "uint256" }],
    outputs: [],
  },
]);

export type AnchorConfig = {
  /** Deployed PolicyRegistry. */
  registry: string;
  chainId: number;
};

export type AnchorResult = {
  executionId: string;
  transactionHash?: string;
  status: string;
  /** The hash that was written, echoed so the caller can record what it anchored. */
  policyHash: string;
};

function pick(status: ExecutionStatusResponse, policyHash: string): AnchorResult {
  return {
    executionId: status.executionId,
    ...(status.transactionHash ? { transactionHash: status.transactionHash } : {}),
    status: status.status,
    policyHash,
  };
}

/**
 * Register a policy for an agent.
 *
 * `policyHash` is the canonical hash of the policy document -- use
 * `hashCanonicalJson` from `mandate-policy/canon`, which is the same function
 * the engine hashes with, so the anchored bytes and the judged bytes cannot
 * drift.
 *
 * The hash doubles as the idempotency key. Registering the same policy for the
 * same agent twice is one write, which matters because this runs from automated
 * paths where a retry after a timeout is normal.
 */
export async function anchorPolicy(
  kh: KeeperHubClient,
  cfg: AnchorConfig,
  args: { agent: string; policyHash: string; expiry: number },
  opts: { timeoutMs?: number } = {}
): Promise<AnchorResult> {
  const status = await kh.executeAndConfirm(
    {
      contractAddress: cfg.registry,
      chainId: cfg.chainId,
      functionName: "registerPolicy",
      abi: POLICY_REGISTRY_ABI,
      functionArgs: JSON.stringify([args.agent, args.policyHash, String(args.expiry)]),
    },
    { idempotencyKey: `anchor-${args.agent}-${args.policyHash}`, ...opts }
  );
  return pick(status, args.policyHash);
}

/** Revise an anchored policy. The new hash keys the write for the same reason. */
export async function updateAnchoredPolicy(
  kh: KeeperHubClient,
  cfg: AnchorConfig,
  args: { policyId: string; policyHash: string; expiry: number },
  opts: { timeoutMs?: number } = {}
): Promise<AnchorResult> {
  const status = await kh.executeAndConfirm(
    {
      contractAddress: cfg.registry,
      chainId: cfg.chainId,
      functionName: "updatePolicy",
      abi: POLICY_REGISTRY_ABI,
      functionArgs: JSON.stringify([args.policyId, args.policyHash, String(args.expiry)]),
    },
    { idempotencyKey: `update-${args.policyId}-${args.policyHash}`, ...opts }
  );
  return pick(status, args.policyHash);
}

/**
 * Pause a policy on chain.
 *
 * The kill switch with teeth. A paused policy fails `policy.active`, which is
 * the first rule in the chain, so every subsequent spend is refused before any
 * other rule is even consulted -- and it is refused for everyone reading the
 * registry, not just for the process that happened to hold the flag in memory.
 */
export async function pauseAnchoredPolicy(
  kh: KeeperHubClient,
  cfg: AnchorConfig,
  policyId: string,
  opts: { timeoutMs?: number } = {}
): Promise<AnchorResult> {
  const status = await kh.executeAndConfirm(
    {
      contractAddress: cfg.registry,
      chainId: cfg.chainId,
      functionName: "pausePolicy",
      abi: POLICY_REGISTRY_ABI,
      functionArgs: JSON.stringify([policyId]),
    },
    { idempotencyKey: `pause-${policyId}`, ...opts }
  );
  return pick(status, "");
}
