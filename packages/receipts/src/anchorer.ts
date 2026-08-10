/**
 * Putting a batch root on chain, through KeeperHub.
 *
 * The same execution path the policy anchor and every authorised transfer use,
 * for the same reason: this process holds no key. An evidence trail that could
 * be written with a private key in someone's `.env` is an evidence trail its
 * own operator can forge, which is most of what makes it worth having.
 *
 * The root goes into `PolicyRegistry.anchorReceiptBatch`. If the deployed
 * registry has no such function the anchorer says so and the batch degrades
 * honestly — it does not pretend to have anchored.
 */

import type { JsonRpcProvider } from "ethers";

import type { Anchorer } from "./writer.ts";

/** The one call this needs. */
export const RECEIPT_ANCHOR_ABI = JSON.stringify([
  {
    type: "function",
    name: "anchorReceiptBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "batchId", type: "bytes32" },
      { name: "root", type: "bytes32" },
    ],
    outputs: [],
  },
]);

/** Just enough of the KeeperHub client, so this package does not depend on the SDK. */
export interface Executor {
  executeAndConfirm(
    input: {
      contractAddress: string;
      chainId: number;
      functionName: string;
      abi: string;
      functionArgs: string;
    },
    opts?: { idempotencyKey?: string; timeoutMs?: number }
  ): Promise<{ status: string; transactionHash?: string; executionId: string }>;
}

export function keeperHubAnchorer(args: {
  kh: Executor;
  provider: JsonRpcProvider;
  registry: string;
  chainId: number;
  /** Blocks before a transaction counts as final. */
  confirmations?: number;
}): Anchorer {
  const need = args.confirmations ?? 2;

  return {
    async anchor(root, batchId) {
      const status = await args.kh.executeAndConfirm(
        {
          contractAddress: args.registry,
          chainId: args.chainId,
          functionName: "anchorReceiptBatch",
          abi: RECEIPT_ANCHOR_ABI,
          functionArgs: JSON.stringify([batchId, root]),
        },
        // The root keys the write: re-anchoring the same batch is one write,
        // which matters because a timeout here is retried by design.
        { idempotencyKey: `receipts-${batchId}`, timeoutMs: 180_000 }
      );
      return {
        ...(status.transactionHash ? { transactionHash: status.transactionHash } : {}),
        executionId: status.executionId,
      };
    },

    async confirmed(transactionHash) {
      const r = await args.provider.getTransactionReceipt(transactionHash).catch(() => null);
      if (!r || r.status !== 1) return false;
      const head = await args.provider.getBlockNumber();
      // Depth, not just inclusion: a reorg can un-include a mined transaction.
      return head - r.blockNumber >= need;
    },
  };
}
