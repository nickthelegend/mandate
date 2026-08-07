/**
 * The facilitator.
 *
 * In x402 this is the party that takes a signed authorisation, submits it, and
 * reports back whether it worked. The resource server believes the report.
 *
 * Two are implemented here, and the second one is the argument.
 *
 * `honest` submits the authorisation and returns the hash of the transfer.
 *
 * `lying` submits an `approve` instead -- a transaction that mines with
 * `status: 0x1`, emits a log, moves no money, and costs the facilitator
 * nothing -- and returns `success: true` with that hash. It is a legal x402
 * settlement response. Every check the protocol performs passes. Without a
 * receipt read the resource is served for free, every time, and the buyer's
 * only evidence that they were charged is the facilitator's word that they
 * were.
 *
 * It exists so the failure can be demonstrated on a real chain rather than
 * described. Nothing about it is subtle or adversarial in a way a real
 * facilitator could not trivially reproduce -- that is the point.
 */

import { Contract, Wallet, type JsonRpcProvider } from "ethers";
import type { PaymentPayload, SettlementResponse } from "outcome-sdk/x402";

const EIP3009_ABI = [
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)",
  "function approve(address spender,uint256 value) returns (bool)",
];

export type FacilitatorMode = "honest" | "lying";

export type Facilitator = {
  mode: FacilitatorMode;
  settle(payment: PaymentPayload, asset: string): Promise<SettlementResponse>;
};

export function createFacilitator(opts: {
  mode: FacilitatorMode;
  provider: JsonRpcProvider;
  wallet: Wallet;
  network: string;
}): Facilitator {
  const { mode, wallet, network } = opts;

  return {
    mode,

    async settle(payment: PaymentPayload, asset: string): Promise<SettlementResponse> {
      const token = new Contract(asset, EIP3009_ABI, wallet);
      const a = payment.payload.authorization;

      try {
        if (mode === "lying") {
          /*
           * Do something cheap that is not a payment, then report success. An
           * approve of zero to ourselves: it mines, it emits Approval, and no
           * balance anywhere changes.
           */
          const tx = await token.approve(wallet.address, 0n);
          await tx.wait();
          return { success: true, transaction: tx.hash, network, payer: a.from };
        }

        const tx = await token.transferWithAuthorization(
          a.from,
          a.to,
          BigInt(a.value),
          BigInt(a.validAfter),
          BigInt(a.validBefore),
          a.nonce,
          payment.payload.signature
        );
        await tx.wait();
        return { success: true, transaction: tx.hash, network, payer: a.from };
      } catch (err: unknown) {
        const e = err as { shortMessage?: string; message?: string };
        return {
          success: false,
          errorReason: e.shortMessage ?? e.message ?? "settlement failed",
          transaction: "",
          network,
          payer: a.from,
        };
      }
    },
  };
}
