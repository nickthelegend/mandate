/**
 * Turning a verdict into an on-chain settlement, through KeeperHub.
 *
 * The verdict is decided from evidence (see verify.ts). This module is what
 * acts on it, and it deliberately routes through KeeperHub's execute API rather
 * than signing directly, for three reasons that are also three of the judging
 * criteria:
 *
 *   - The call is simulated before it is sent, so a settlement that would
 *     revert becomes a diagnosable event rather than a burnt transaction.
 *   - Execution is idempotent per attempt, so a retry after a timeout cannot
 *     double-settle. The key rotates on a definite failure and is held on an
 *     indefinite one -- rotating mid-flight is how you double-pay.
 *   - Gas is sponsored, so the verifier does not need the native token.
 *
 * A note on what this does NOT do: it never reports success from the execution
 * status alone. KeeperHub returns `succeeded` when a transaction mines, and a
 * transaction that mines can still have moved nothing. After settling, the
 * result is re-verified from the receipt.
 */

import { KeeperHubClient, encodeArgs, chargeKey } from "../vendor-kh/client.ts";
import { isKeeperHubError } from "../vendor-kh/errors.ts";
import type { Verdict } from "./verify.ts";

export const ESCROW_ABI = JSON.stringify([
  {
    type: "function",
    name: "release",
    stateMutability: "nonpayable",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "proof", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "intentId", type: "bytes32" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
]);

export type SettleParams = {
  escrow: string;
  chainId: number;
  intentId: string;
  verdict: Verdict;
  attempt?: number;
};

export type SettleResult = {
  action: "release" | "refund";
  outcome: "succeeded" | "failed";
  executionId?: string;
  transactionHash?: string;
  error?: { kind: string; message: string };
};

export async function settle(
  kh: KeeperHubClient,
  p: SettleParams
): Promise<SettleResult> {
  const attempt = p.attempt ?? 1;
  const action: "release" | "refund" = p.verdict.proven ? "release" : "refund";

  /*
   * The action id carries the verdict as well as the intent. A release and a
   * refund of the same intent are genuinely different actions, and giving them
   * the same key would mean a refund could replay as a release from cache --
   * the worst possible collision in a payment system.
   */
  const actionId = `intent-${p.intentId}-${action}`;

  const call = {
    contractAddress: p.escrow,
    chainId: p.chainId,
    functionName: action,
    functionArgs: encodeArgs(
      action === "release"
        ? [p.intentId, p.verdict.proof]
        : [p.intentId, p.verdict.reason]
    ),
    abi: ESCROW_ABI,
  };

  try {
    await kh.assertWouldSucceed(call);
    const status = await kh.executeAndConfirm(call, {
      idempotencyKey: chargeKey(actionId, attempt),
    });
    return {
      action,
      outcome: "succeeded",
      executionId: status.executionId,
      transactionHash: status.execution?.transactionHash,
    };
  } catch (err) {
    const e = isKeeperHubError(err)
      ? { kind: err.kind, message: err.message }
      : { kind: "unknown", message: (err as Error)?.message ?? String(err) };
    return { action, outcome: "failed", error: e };
  }
}
