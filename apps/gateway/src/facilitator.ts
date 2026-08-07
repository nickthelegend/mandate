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

import { Contract, Interface, Wallet, type JsonRpcProvider } from "ethers";
import type { PaymentPayload, SettlementResponse } from "outcome-sdk/x402";
import type { KeeperHubClient } from "outcome-sdk/node";

/*
 * KeeperHub's execute API takes a JSON ABI, not ethers' human-readable
 * signatures, and answers "function not found" if given the latter. Interface
 * converts between the two, so the readable form stays the source of truth.
 */
const EIP3009_JSON_ABI = () => new Interface(EIP3009_ABI).formatJson();

const EIP3009_ABI = [
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)",
  "function approve(address spender,uint256 value) returns (bool)",
];

export type FacilitatorMode = "honest" | "lying";

export type Facilitator = {
  mode: FacilitatorMode;
  /** How the settlement reached the chain, for the response to report. */
  submittedVia: "keeperhub" | "local wallet";
  settle(payment: PaymentPayload, asset: string): Promise<SettlementResponse>;
};

export function createFacilitator(opts: {
  mode: FacilitatorMode;
  provider: JsonRpcProvider;
  wallet: Wallet;
  network: string;
  chainId: number;
  /**
   * When present, settlement goes through KeeperHub instead of the local
   * wallet, and the merchant never needs gas.
   *
   * This is the interesting half of running a facilitator. x402's own
   * deployment assumes a funded submitter -- somebody has to hold ETH and top
   * it up -- which is a real operational cost for anyone wanting to accept
   * agent payments. Sponsored execution removes it: the account that settles
   * holds tokens and no ETH at all.
   *
   * It also brings simulation-before-send, so an authorisation that would
   * revert (expired, replayed, wrong signer) is refused without spending gas,
   * and a per-authorisation idempotency key, so the same signed authorisation
   * arriving twice settles once.
   */
  kh?: KeeperHubClient;
}): Facilitator {
  const { mode, wallet, network, kh } = opts;

  return {
    mode,
    submittedVia: kh ? "keeperhub" : "local wallet",

    async settle(payment: PaymentPayload, asset: string): Promise<SettlementResponse> {
      const token = new Contract(asset, EIP3009_ABI, wallet);
      const a = payment.payload.authorization;

      try {
        if (mode === "honest" && kh) {
          /*
           * The nonce is the payer's own single-use value from the
           * authorisation, so it is exactly the right idempotency key: the same
           * signed authorisation submitted twice settles once, and EIP-3009's
           * on-chain replay guard never has to be the thing that catches it.
           */
          const status = await kh.executeAndConfirm(
            {
              chainId: opts.chainId,
              contractAddress: asset,
              functionName: "transferWithAuthorization",
              abi: EIP3009_JSON_ABI(),
              // A JSON array, not a comma-joined string: the signature is a
              // hex blob and the amounts are decimal strings, and neither
              // survives being split on commas.
              functionArgs: JSON.stringify([
                a.from,
                a.to,
                a.value,
                a.validAfter,
                a.validBefore,
                a.nonce,
                payment.payload.signature,
              ]),
            },
            { idempotencyKey: `x402-${a.nonce}` }
          );

          return {
            success: true,
            transaction: status.transactionHash ?? "",
            network,
            payer: a.from,
          };
        }

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
