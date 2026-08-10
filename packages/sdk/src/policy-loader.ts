/**
 * Reading the anchored policy back, so the anchor actually governs.
 *
 * Without this the on-chain record is decoration: the engine judges whatever
 * policy object the caller hands it, and the registry sits alongside agreeing
 * in principle. This is the join that makes the anchor load-bearing.
 *
 * Two checks, and both have to pass before a spend is judged at all:
 *
 *   1. **The document is the anchored one.** The policy JSON is hashed with the
 *      same canonical hash the registry stores, and the two must match. A local
 *      file edited after anchoring produces a different hash and is refused --
 *      which is the entire reason for anchoring rather than trusting the file.
 *
 *   2. **The registry still says it is usable.** Paused or expired on chain
 *      means the policy is not active, and `policy.active` is the first rule in
 *      the engine's chain, so every spend is refused before any other rule is
 *      consulted.
 *
 * That second check is what turns `pauseAnchoredPolicy` into a real kill
 * switch. The pause is a transaction KeeperHub signs; from the block it lands
 * in, every agent reading this registry stops spending. It does not depend on a
 * flag held in one process's memory, and the agent cannot ignore it, because
 * the agent is not the thing consulting it.
 */

import { Contract, type Provider } from "ethers";

/** The reads this module needs from PolicyRegistry. */
const REGISTRY_ABI = [
  "function getPolicy(uint256) view returns (tuple(address owner,uint64 expiry,uint32 version,address agent,uint8 status,bytes32 policyHash))",
  "function isUsable(uint256) view returns (bool)",
];

/**
 * PolicyRegistry's own enum, named rather than inlined.
 *
 * `NONE` is 0, so a never-registered policy reads as 0 and an ACTIVE one as 1.
 * Treating 0 as active -- the obvious guess -- silently marks every unregistered
 * id live, which is the exact inversion this constant exists to prevent.
 */
export const POLICY_STATUS = { NONE: 0, ACTIVE: 1, PAUSED: 2 } as const;

export type AnchoredPolicyRecord = {
  owner: string;
  agent: string;
  policyHash: string;
  expiry: number;
  version: number;
  /** `POLICY_STATUS`: 0 NONE, 1 ACTIVE, 2 PAUSED. */
  status: number;
  /** The registry's own verdict: active, unpaused and unexpired. */
  usable: boolean;
};

export class PolicyAnchorMismatch extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string
  ) {
    super(
      `policy document does not match the anchor: registry holds ${expected}, document hashes to ${actual}`
    );
    this.name = "PolicyAnchorMismatch";
  }
}

export class PolicyNotUsable extends Error {
  constructor(readonly record: AnchoredPolicyRecord) {
    super(
      record.status === POLICY_STATUS.PAUSED
        ? `policy ${record.version} is paused on chain`
        : record.status === POLICY_STATUS.NONE
          ? `policy ${record.version} is not registered on chain`
          : `policy ${record.version} is registered and unpaused but not usable (expired)`
    );
    this.name = "PolicyNotUsable";
  }
}

/** Read an anchored policy's record straight from the registry. */
export async function readAnchoredPolicy(
  provider: Provider,
  registry: string,
  policyId: string | bigint
): Promise<AnchoredPolicyRecord> {
  const c = new Contract(registry, REGISTRY_ABI, provider);
  const [p, usable] = await Promise.all([c.getPolicy(policyId), c.isUsable(policyId)]);
  return {
    owner: p.owner,
    agent: p.agent,
    policyHash: p.policyHash,
    expiry: Number(p.expiry),
    version: Number(p.version),
    status: Number(p.status),
    usable: Boolean(usable),
  };
}

/**
 * Check a policy document against its anchor before it is used to judge a spend.
 *
 * Throws rather than returning a flag, because every caller of this is about to
 * decide whether money moves. A mismatch or a pause is not a condition to note
 * and continue past.
 */
export async function assertAnchored(
  provider: Provider,
  registry: string,
  policyId: string | bigint,
  documentHash: string
): Promise<AnchoredPolicyRecord> {
  const record = await readAnchoredPolicy(provider, registry, policyId);

  if (record.policyHash.toLowerCase() !== documentHash.toLowerCase()) {
    throw new PolicyAnchorMismatch(record.policyHash, documentHash);
  }
  if (!record.usable) {
    throw new PolicyNotUsable(record);
  }
  return record;
}

/**
 * The on-chain status, expressed the way the engine's first rule reads it.
 *
 * Returned rather than merged in so the caller keeps its own policy document
 * intact and the override is visible at the call site: the chain decides
 * whether the policy is live, the document decides what the rules are.
 */
export function statusFromAnchor(record: AnchoredPolicyRecord): {
  status: "ACTIVE" | "PAUSED";
  expiry: string;
} {
  return {
    status: record.status === POLICY_STATUS.ACTIVE && record.usable ? "ACTIVE" : "PAUSED",
    expiry: new Date(record.expiry * 1000).toISOString(),
  };
}
