/**
 * One x402 purchase, start to finish, as data.
 *
 * The CLI client and the browser demo run the same code: quote, sign, pay,
 * read what came back. Returning a trace rather than printing one is what lets
 * both exist without the flow being written twice, and a demo that ran
 * different code from the real client would be worth nothing.
 *
 * Every step here is real. The 402 is a real 402, the authorisation is a real
 * EIP-712 signature, and the settlement is a real Sepolia transaction. Nothing
 * is replayed from a recording.
 */

import { JsonRpcProvider, Wallet, hexlify, randomBytes } from "ethers";
import {
  encodePaymentHeader,
  X402_VERSION,
  type PaymentRequiredResponse,
  type PaymentPayload,
  type PaymentRequirements,
} from "outcome-sdk/x402";

export type FlowStep = {
  label: string;
  detail: string;
  /** Present when this step put something on chain. */
  transactionHash?: string;
  status?: number;
};

export type FlowResult = {
  facilitator: "honest" | "lying";
  /** Whether the resource was handed over. The only bit that matters. */
  served: boolean;
  httpStatus: number;
  steps: FlowStep[];
  /** What the facilitator claimed, before anyone checked. */
  facilitatorClaimedSuccess: boolean;
  /** What the chain actually showed. Base units. */
  observed: string;
  reason: string;
  transactionHash?: string;
  submittedVia?: string;
  /** KeeperHub's id for the settlement, when it went that way. */
  executionId?: string;
  /*
   * The terms the 402 actually demanded: which token, to whom, how much.
   *
   * Carried out so the visitor can re-run the check against the settlement's
   * own terms rather than this site's defaults. The x402 asset is not the
   * escrow's token -- `exact` needs EIP-3009 and the escrow token does not
   * implement it -- so a check that assumed one would report "no transfer" on
   * a settlement that plainly paid.
   */
  asset?: string;
  payTo?: string;
  amount?: string;
  article?: { title: string; body: string };
};

/**
 * Buy the resource once.
 *
 * `payerKey` signs the authorisation. It never sends a transaction: that is the
 * whole point of the `exact` scheme, and it is why the payer can be a browser
 * or an agent with no gas.
 */
export async function runPurchase(opts: {
  baseUrl: string;
  facilitator: "honest" | "lying";
  payerKey: string;
  rpcUrl: string;
  chainId: number;
}): Promise<FlowResult> {
  const { baseUrl, facilitator, chainId } = opts;
  const url = `${baseUrl}/article${facilitator === "lying" ? "?facilitator=lying" : ""}`;
  const steps: FlowStep[] = [];

  const payer = new Wallet(opts.payerKey, new JsonRpcProvider(opts.rpcUrl, chainId));

  // 1. Ask, and be told the price.
  const quote = await fetch(url);
  if (quote.status !== 402) {
    throw new Error(`expected 402 from ${url}, got ${quote.status}`);
  }
  const body = (await quote.json()) as PaymentRequiredResponse;
  const req: PaymentRequirements = body.accepts[0];

  steps.push({
    label: "402 Payment Required",
    detail: `${req.maxAmountRequired} of ${req.asset} to ${req.payTo}, scheme ${req.scheme} on ${req.network}`,
    status: 402,
  });

  // 2. Sign the authorisation. No transaction is sent by the payer.
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: payer.address,
    to: req.payTo,
    value: req.maxAmountRequired,
    validAfter: "0",
    validBefore: String(now + req.maxTimeoutSeconds),
    nonce: hexlify(randomBytes(32)),
  };
  const extra = (req.extra ?? {}) as { name?: string; version?: string };
  const signature = await payer.signTypedData(
    {
      name: extra.name ?? "USD Coin (x402 test)",
      version: extra.version ?? "2",
      chainId,
      verifyingContract: req.asset,
    },
    {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    authorization
  );

  steps.push({
    label: "Payer signs an EIP-3009 authorisation",
    detail: `signed by ${payer.address} — the payer sends no transaction and needs no gas`,
  });

  const payment: PaymentPayload = {
    x402Version: X402_VERSION,
    scheme: req.scheme,
    network: req.network,
    payload: { signature, authorization },
  };

  // 3. Pay.
  const paid = await fetch(url, { headers: { "X-PAYMENT": encodePaymentHeader(payment) } });
  const result = (await paid.json()) as Record<string, unknown>;
  const served = paid.status === 200;

  if (served) {
    const p = result.paidWith as Record<string, string>;
    steps.push({
      label: "Facilitator settles",
      detail: `reported success, submitted via ${p.submittedVia ?? "unknown"}`,
      transactionHash: p.transaction,
    });
    steps.push({
      label: "Outcome reads the receipt",
      detail: `observed ${p.observed} reaching ${req.payTo}`,
    });
    steps.push({ label: "200 OK — resource served", detail: "paid for, and checked", status: 200 });

    return {
      facilitator,
      served: true,
      httpStatus: 200,
      steps,
      facilitatorClaimedSuccess: true,
      observed: p.observed,
      reason: "transfer verified on chain",
      transactionHash: p.transaction,
      submittedVia: p.submittedVia,
      executionId: p.executionId,
      asset: req.asset,
      payTo: req.payTo,
      amount: req.maxAmountRequired,
      article: { title: String(result.title), body: String(result.body) },
    };
  }

  const o = (result.outcome ?? {}) as Record<string, unknown>;
  steps.push({
    label: "Facilitator settles",
    detail:
      o.facilitatorClaimedSuccess === true
        ? "reported success: true"
        : `reported failure: ${String(o.reason ?? "")}`,
    transactionHash: (o.transaction as string) ?? undefined,
  });
  steps.push({
    label: "Outcome reads the receipt",
    detail: String(o.reason ?? result.error ?? "not proven"),
  });
  steps.push({
    label: "402 — resource withheld",
    detail: "the facilitator said it paid; the chain disagreed",
    status: 402,
  });

  return {
    facilitator,
    served: false,
    httpStatus: paid.status,
    steps,
    facilitatorClaimedSuccess: o.facilitatorClaimedSuccess === true,
    observed: String(o.observed ?? "0"),
    reason: String(o.reason ?? result.error ?? "not proven"),
    transactionHash: (o.transaction as string) ?? undefined,
    asset: req.asset,
    payTo: req.payTo,
    amount: req.maxAmountRequired,
  };
}
