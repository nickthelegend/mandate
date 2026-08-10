/**
 * The join: a spend decision, and the execution it authorised.
 *
 * The policy engine (`mandate-policy`) decides whether an agent may spend. This
 * is what makes that decision binding rather than advisory, and it rests on one
 * property of KeeperHub: **the agent never holds the key**. KeeperHub owns the
 * signer, and this function is the only path from a decision to an execution.
 * An agent cannot route around a refusal because there is nothing to route
 * around it with -- it has no key to sign an alternative with.
 *
 * That is the difference between a spend limit and a spend *authority*. A limit
 * asks the agent nicely. An authority is a gate the money physically has to
 * pass through.
 *
 * Three things happen in order, and the order is the point:
 *
 *   1. The policy is judged. On a refusal the function returns before any
 *      network call exists, so a blocked intent leaves no execution behind.
 *   2. The approved intent executes through KeeperHub, which owns gas
 *      estimation, retries and the audit trail.
 *   3. The receipt is read back rather than believed. KeeperHub reporting
 *      `completed` means it sent a transaction that mined, not that value
 *      moved -- so the caller gets the transaction hash and can verify it.
 */

import type { KeeperHubClient } from "./keeperhub/client.ts";


/** The decision shape `mandate-policy`'s `evaluateIntent` returns. */
export type PolicyDecisionLike = {
  decision: string;
  rules: readonly { rule: string; result: string }[];
  intentHash?: string;
  policyId?: string;
  policyVersion?: number;
};

export type AuthorisedTransfer = {
  chainId: number;
  /** ERC-20 to move. Omit for the chain's native asset. */
  tokenAddress?: string;
  to: string;
  /** Human-readable units, e.g. "0.1" -- the transfer route's own convention. */
  amount: string;
};

export type AuthoriseResult =
  | {
      authorised: false;
      decision: string;
      /** Every rule that refused, so the caller can say which one and why. */
      failedRules: string[];
      executionId?: undefined;
      transactionHash?: undefined;
    }
  | {
      authorised: true;
      decision: string;
      failedRules: [];
      executionId: string;
      /** Present once KeeperHub reports a transaction. Still a claim, not proof. */
      transactionHash?: string;
    };

/** A decision counts as authorising a spend only if it is exactly APPROVED. */
export function isApproved(d: PolicyDecisionLike): boolean {
  return d.decision === "APPROVED";
}

/** Which rules refused, in chain order. */
export function failedRules(d: PolicyDecisionLike): string[] {
  return d.rules.filter((r) => r.result === "FAIL").map((r) => r.rule);
}

/**
 * Execute a transfer only if the policy approved it.
 *
 * `decision` is passed in rather than computed here so the judgement stays
 * pure and testable in `mandate-policy`, and so the caller cannot accidentally
 * evaluate a different intent from the one it is about to execute -- the
 * decision it holds is the decision that gates the money.
 */
export async function executeIfAuthorised(
  kh: KeeperHubClient,
  decision: PolicyDecisionLike,
  transfer: AuthorisedTransfer,
  opts: { timeoutMs?: number } = {}
): Promise<AuthoriseResult> {
  if (!isApproved(decision)) {
    // Returns before any request exists: a refused intent must not leave an
    // execution record implying it was ever attempted.
    return {
      authorised: false,
      decision: decision.decision,
      failedRules: failedRules(decision),
    };
  }

  /*
   * The intent hash is the idempotency key. The same authorised intent
   * submitted twice settles once, and it is the policy's own hash rather than
   * a fresh uuid, so a retry after a timeout cannot become a second payment.
   */
  const status = await kh.transferAndConfirm(
    {
      chainId: transfer.chainId,
      recipientAddress: transfer.to,
      amount: transfer.amount,
      ...(transfer.tokenAddress ? { tokenAddress: transfer.tokenAddress } : {}),
    },
    { ...(decision.intentHash ? { idempotencyKey: decision.intentHash } : {}), ...opts }
  );

  return {
    authorised: true,
    decision: decision.decision,
    failedRules: [],
    executionId: status.executionId,
    ...(status.transactionHash ? { transactionHash: status.transactionHash } : {}),
  };
}
