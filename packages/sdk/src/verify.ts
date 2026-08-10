/**
 * Deciding whether work actually happened.
 *
 * This is the part every agent payment rail leaves out. x402 releases funds when
 * a facilitator returns success. KeeperHub records a payment when its own
 * facilitator says so, and never persists a transaction hash to check against
 * later. ERC-8004's `proofOfPayment` field is optional and unenforced. In each
 * case the evidence for "you were paid" is somebody's word.
 *
 * A status byte is not evidence. `status: 0x1` means the EVM did not revert; it
 * says nothing about whether value moved. A call to an address with no code
 * mines successfully and does nothing at all -- which is not hypothetical, it is
 * a bug I found in production on Sepolia, where a settlement reported success
 * while transferring zero and the merchant's balance was byte-identical either
 * side of the block.
 *
 * So this module refuses to look at status alone. It reads the receipt, finds
 * the ERC-20 Transfer to the expected recipient, and checks the amount. No
 * Transfer, no release.
 */

import { keccak256, toUtf8Bytes, AbiCoder } from "ethers";

/** keccak("Transfer(address,address,uint256)") -- the topic every ERC-20 emits. */
export const TRANSFER_TOPIC = keccak256(
  toUtf8Bytes("Transfer(address,address,uint256)")
);

export type Verdict = {
  proven: boolean;
  /** Why, in words a human can act on. Present on both outcomes. */
  reason: string;
  /** Amount actually observed moving to the recipient, in base units. */
  observed: bigint;
  /** Commitment to the evidence, recorded on chain when releasing. */
  proof: string;
};

export type Receipt = {
  status?: string;
  blockNumber?: string;
  transactionHash?: string;
  logs?: Array<{ address: string; topics: string[]; data: string }>;
};

export type Expectation = {
  token: string;
  recipient: string;
  /** Minimum that must have moved. Exact equality is too brittle: a token with
   *  a transfer fee moves slightly less, and refusing that is a false negative
   *  on an outcome that did happen. Under-delivery is what we care about. */
  minAmount: bigint;
};

const addr = (topic: string): string => `0x${topic.slice(26)}`.toLowerCase();

/**
 * Read a receipt and decide.
 *
 * Deliberately conservative in one direction only: anything unreadable is
 * "not proven". The cost of a false negative is a refund the payer can retry;
 * the cost of a false positive is a payee paid for nothing. Those are not
 * symmetric, so the tie does not go to release.
 */
export function verifyTransfer(
  receipt: Receipt | null | undefined,
  expect: Expectation
): Verdict {
  const none = (reason: string, observed = 0n): Verdict => ({
    proven: false,
    reason,
    observed,
    proof: "0x" + "00".repeat(32),
  });

  if (!receipt) return none("no receipt: the transaction is unknown to the node");
  if (receipt.status !== "0x1") {
    return none(`transaction did not succeed (status ${receipt.status ?? "absent"})`);
  }

  const logs = receipt.logs ?? [];
  if (logs.length === 0) {
    /*
     * The single most important branch in this file. A mined transaction with
     * no logs transferred nothing -- there is no way to move an ERC-20 without
     * emitting Transfer. Every rail that trusts status alone accepts this case
     * as a successful payment.
     */
    return none("mined with zero logs: nothing was transferred");
  }

  const token = expect.token.toLowerCase();
  const recipient = expect.recipient.toLowerCase();
  let observed = 0n;

  for (const log of logs) {
    if (log.address.toLowerCase() !== token) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;
    if (log.topics.length < 3) continue;
    if (addr(log.topics[2]) !== recipient) continue;
    observed += BigInt(log.data);
  }

  if (observed === 0n) {
    return none(
      `no Transfer of ${expect.token} to ${expect.recipient} in ${logs.length} log(s)`
    );
  }
  if (observed < expect.minAmount) {
    return none(
      `under-delivered: moved ${observed}, expected at least ${expect.minAmount}`,
      observed
    );
  }

  // The proof commits to the specific evidence, so a release can be re-checked
  // later against the same receipt rather than taken on trust.
  const proof = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "address", "uint256"],
      [
        receipt.transactionHash ?? "0x" + "00".repeat(32),
        BigInt(receipt.blockNumber ?? "0x0"),
        expect.recipient,
        observed,
      ]
    )
  );

  return {
    proven: true,
    reason: `observed ${observed} to ${expect.recipient}`,
    observed,
    proof,
  };
}


/**
 * An ethers receipt, put back into wire form.
 *
 * `verifyTransfer` is deliberately a pure function over a plain receipt with no
 * provider to stand in for, which is the property most worth keeping about it —
 * so something has to translate. ethers decodes the JSON-RPC response into
 * numbers and a readonly log array; this puts the three fields the verifier
 * reads back the way they arrived.
 *
 * `status: null` becomes `undefined` rather than `0x0`. A receipt whose status
 * the node did not report is unknown, and rendering unknown as failure would
 * turn a missing field into a verdict.
 */
export function toWireReceipt(r: {
  status: number | null;
  blockNumber: number;
  hash: string;
  logs: readonly { address: string; topics: readonly string[]; data: string }[];
}): Receipt {
  return {
    status: r.status === null ? undefined : `0x${r.status.toString(16)}`,
    blockNumber: `0x${r.blockNumber.toString(16)}`,
    transactionHash: r.hash,
    logs: r.logs.map((l) => ({ address: l.address, topics: [...l.topics], data: l.data })),
  };
}
