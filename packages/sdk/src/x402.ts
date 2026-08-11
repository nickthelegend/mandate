/**
 * x402, with the missing step.
 *
 * The protocol's shape is: a resource server answers 402 with what it wants
 * paid, the client signs an EIP-3009 authorisation into an `X-PAYMENT` header,
 * and a facilitator submits it and reports back. The report is a
 * `SettlementResponse` carrying `success: true` and a `transaction` hash.
 *
 * **Nothing in x402 checks that transaction.** The resource server reads
 * `success`, believes it, and serves the resource. That field is produced by
 * the facilitator -- the one party with an incentive to say yes -- and a
 * transaction hash sitting next to it is not evidence, it is a citation nobody
 * follows. A settlement that mined with `status: 0x1`, emitted no `Transfer`,
 * and moved nothing satisfies every check the protocol actually performs.
 *
 * This module speaks the wire format exactly as specified, and adds one call:
 * take the `transaction` the facilitator named, read the receipt, and confirm
 * that `maxAmountRequired` of `asset` genuinely reached `payTo`. If it did not,
 * the resource is not served.
 *
 * Isomorphic on purpose -- a buyer checking whether they were charged for
 * nothing should not need a server to ask.
 */

import { verifyTransfer, toWireReceipt, type Verdict } from "./verify.ts";
import type { Provider } from "ethers";

/** The version this module speaks. */
export const X402_VERSION = 1;

/**
 * What a resource costs, as sent in the 402 body.
 *
 * Field names are the specification's, not tidier ones. `maxAmountRequired` is
 * a string because it is an atomic-unit integer that does not survive JSON
 * numbers.
 */
export type PaymentRequirements = {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  asset: string;
  payTo: string;
  resource: string;
  description: string;
  mimeType?: string;
  outputSchema?: object;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
};

/** The 402 response body. */
export type PaymentRequiredResponse = {
  x402Version: number;
  error: string;
  accepts: PaymentRequirements[];
};

/** The `exact` scheme's payload: an EIP-3009 authorisation and its signature. */
export type ExactEvmPayload = {
  signature: string;
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
};

/** What the client base64s into `X-PAYMENT`. */
export type PaymentPayload = {
  x402Version: number;
  scheme: string;
  network: string;
  payload: ExactEvmPayload;
};

/** What a facilitator returns, and what this module refuses to take on trust. */
export type SettlementResponse = {
  success: boolean;
  errorReason?: string;
  transaction: string;
  network: string;
  payer: string;
};

/**
 * Chain ids for the networks x402 names.
 *
 * x402's own deployment is Base mainnet with real USDC. Sepolia is here because
 * that is where this project's contracts live, and the verification argument is
 * indifferent to which chain carries the value.
 *
 * Every id is KeeperHub's, checked against the chain list its MCP serves. That
 * matters more than it looks: a wrong id here does not fail loudly, it binds a
 * payment to a chain the seller did not quote — which is the exact class of
 * mismatch the Challenge Binding Check exists to catch, arriving through the
 * one table the check trusts.
 */
export const NETWORK_CHAIN_IDS: Record<string, number> = {
  base: 8453,
  "base-sepolia": 84532,
  sepolia: 11155111,
  "ethereum-sepolia": 11155111,
  ethereum: 1,
  mainnet: 1,
  tempo: 4217,
  "tempo-testnet": 42431,
};

/* Base64 that works in a browser and in Node without a polyfill or a branch on
 * `typeof window`, which is the usual way this breaks in edge runtimes. */
const toBase64 = (s: string): string =>
  typeof btoa === "function"
    ? btoa(s)
    : (globalThis as { Buffer?: { from(x: string, e: string): { toString(e: string): string } } })
        .Buffer!.from(s, "utf8")
        .toString("base64");

const fromBase64 = (s: string): string =>
  typeof atob === "function"
    ? atob(s)
    : (globalThis as { Buffer?: { from(x: string, e: string): { toString(e: string): string } } })
        .Buffer!.from(s, "base64")
        .toString("utf8");

export function encodePaymentHeader(payload: PaymentPayload): string {
  return toBase64(JSON.stringify(payload));
}

/**
 * Decode an `X-PAYMENT` header.
 *
 * Throws on anything malformed rather than returning a partial object. This
 * value arrives from the network and decides whether a resource is served, so
 * "mostly parsed" is not a state worth having.
 */
export function decodePaymentHeader(header: string): PaymentPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64(header.trim()));
  } catch {
    throw new Error("X-PAYMENT is not base64-encoded JSON");
  }

  const p = parsed as Partial<PaymentPayload>;
  if (typeof p?.scheme !== "string" || typeof p?.network !== "string") {
    throw new Error("X-PAYMENT is missing scheme or network");
  }
  const auth = p.payload?.authorization;
  if (!auth || typeof p.payload?.signature !== "string") {
    throw new Error("X-PAYMENT payload is missing signature or authorization");
  }
  for (const k of ["from", "to", "value", "validAfter", "validBefore", "nonce"] as const) {
    if (typeof auth[k] !== "string") throw new Error(`X-PAYMENT authorization is missing ${k}`);
  }
  return p as PaymentPayload;
}

export function encodeSettlementHeader(res: SettlementResponse): string {
  return toBase64(JSON.stringify(res));
}

export function decodeSettlementHeader(header: string): SettlementResponse {
  return JSON.parse(fromBase64(header.trim())) as SettlementResponse;
}

/** Build a 402 body. `resource` should be the absolute URL being paid for. */
export function paymentRequired(
  requirements: PaymentRequirements | PaymentRequirements[],
  error = "payment required"
): PaymentRequiredResponse {
  return {
    x402Version: X402_VERSION,
    error,
    accepts: Array.isArray(requirements) ? requirements : [requirements],
  };
}

export type SettlementVerdict = Verdict & {
  logCount: number;
  /** False when the facilitator itself reported failure, before any chain read. */
  facilitatorClaimedSuccess: boolean;
};

/**
 * Check that a settlement actually paid.
 *
 * This is the call x402 does not make. Given what the server asked for and what
 * the facilitator says it did, read the named transaction and confirm that at
 * least `maxAmountRequired` of `asset` reached `payTo`.
 *
 * A facilitator reporting failure is taken at its word -- claiming failure is
 * against its interest, and there is nothing to check. A facilitator reporting
 * success is not, which is the entire asymmetry.
 *
 * Serve the resource only when the returned verdict is `proven`.
 */
/**
 * Just enough to read a receipt.
 *
 * This used to take the whole escrow client, which is a much larger promise
 * than the function keeps — it reads one receipt and answers one question. A
 * narrow parameter is also what lets the escrow go without taking the x402
 * adapter with it.
 */
export type ReceiptReader = Pick<Provider, "getTransactionReceipt">;

export async function verifySettlement(
  provider: ReceiptReader,
  args: { requirements: PaymentRequirements; settlement: SettlementResponse }
): Promise<SettlementVerdict> {
  const { requirements: req, settlement } = args;

  if (!settlement.success) {
    return {
      proven: false,
      reason: `facilitator reported failure: ${settlement.errorReason ?? "no reason given"}`,
      observed: 0n,
      proof: `0x${"0".repeat(64)}`,
      logCount: 0,
      facilitatorClaimedSuccess: false,
    };
  }

  if (!settlement.transaction || /^0x0*$/.test(settlement.transaction)) {
    // Success with no transaction to point at. The protocol permits it; it is
    // not a payment.
    return {
      proven: false,
      reason: "facilitator reported success but named no transaction",
      observed: 0n,
      proof: `0x${"0".repeat(64)}`,
      logCount: 0,
      facilitatorClaimedSuccess: true,
    };
  }

  const receipt = await provider.getTransactionReceipt(settlement.transaction);
  if (!receipt) {
    return {
      proven: false,
      reason: `no receipt for ${settlement.transaction}: the transaction is unknown to this node`,
      observed: 0n,
      proof: settlement.transaction,
      logCount: 0,
      facilitatorClaimedSuccess: true,
    };
  }

  const verdict: Verdict = verifyTransfer(toWireReceipt(receipt as never), {
    recipient: req.payTo,
    minAmount: BigInt(req.maxAmountRequired),
    token: req.asset,
  });

  return {
    ...verdict,
    // Reported so a reader can see the receipt was not empty. A settlement that
    // mined with logs and still moved nothing is the case worth naming.
    logCount: receipt.logs?.length ?? 0,
    facilitatorClaimedSuccess: true,
  };
}
