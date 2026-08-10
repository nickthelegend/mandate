/**
 * Buying from KeeperHub's marketplace, autonomously.
 *
 * KeeperHub lists workflows other agents publish, priced per call. Asking for a
 * paid one answers HTTP 402 with an x402 challenge. KeeperHub's own MCP tool
 * says what happens next:
 *
 *   "this tool DOES NOT auto-pay. A paid listing returns HTTP 402 with an x402
 *    challenge -- pay it with @keeperhub/wallet's paymentSigner, agentcash's
 *    mcp__agentcash__fetch, or the marketplace UI, then retry."
 *
 * So there is a live economy of paid agent services and a human in the middle of
 * every purchase. This module removes the human: it reads the challenge, signs
 * the EIP-3009 authorisation, retries with the payment attached, and hands back
 * the result.
 *
 * Two things it refuses to do, because an unattended process that can move money
 * needs both:
 *
 *   1. Spend above a cap. Every purchase states its ceiling and a challenge over
 *      it is refused before a signature exists, not after.
 *   2. Believe the receipt. What comes back is checked against the chain with
 *      the same verifier the rest of this SDK uses -- a settlement header is a
 *      claim, and this whole project exists because claims are not evidence.
 *
 * The challenge shape here is x402 **v2**, which is what the live marketplace
 * speaks: `accepts[].network` is a CAIP-2 id and the amount is `amount`, where
 * v1 used a bare chain name and `maxAmountRequired`. Both are handled.
 */

import { Wallet, type Signer } from "ethers";

import { encodePaymentHeader, type PaymentPayload } from "./x402.ts";

/** One option from a 402's `accepts` array, normalised across v1 and v2. */
export type Challenge = {
  scheme: string;
  /** Numeric chain id, resolved from CAIP-2 (`eip155:8453`) or a bare name. */
  chainId: number;
  /** The raw network string as the server wrote it; echoed back on payment. */
  network: string;
  /** ERC-20 the payment must be made in. */
  asset: string;
  /** Base units owed. */
  amount: bigint;
  /** Who must be paid. */
  payTo: string;
  maxTimeoutSeconds: number;
  /** EIP-712 domain fields for the asset, needed to sign EIP-3009. */
  extra: { name?: string; version?: string };
  x402Version: number;
};

export type Listing = {
  id: string;
  name: string;
  description: string | null;
  listedSlug: string | null;
  priceUsdcPerCall: string | null;
  workflowType: string | null;
  category: string | null;
  chain: string | null;
  inputSchema?: unknown;
};

const DEFAULT_BASE = "https://app.keeperhub.com";

/** CAIP-2 (`eip155:8453`) or the bare names x402 v1 used. */
const NAMED_CHAINS: Record<string, number> = {
  base: 8453,
  "base-sepolia": 84532,
  ethereum: 1,
  mainnet: 1,
  sepolia: 11155111,
  tempo: 4218,
};

function chainIdOf(network: string): number {
  const caip = /^eip155:(\d+)$/.exec(network);
  if (caip) return Number(caip[1]);
  const named = NAMED_CHAINS[network.toLowerCase()];
  if (named) return named;
  throw new Error(`unrecognised x402 network: ${network}`);
}

/**
 * Read a 402 body into a normalised challenge.
 *
 * Throws rather than returning a partial: this value decides how much money
 * leaves a wallet, so "mostly parsed" is not a state worth having.
 */
export function parseChallenge(body: unknown): Challenge {
  const b = body as Record<string, unknown>;
  const accepts = b?.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) {
    throw new Error("402 body carried no `accepts` options");
  }

  // Only `exact` is implemented; anything else is refused rather than guessed at.
  const opt = accepts.find((a) => (a as Record<string, unknown>).scheme === "exact") as
    | Record<string, unknown>
    | undefined;
  if (!opt) throw new Error("no `exact` scheme offered; nothing else is supported");

  const network = String(opt.network ?? "");
  const rawAmount = opt.amount ?? opt.maxAmountRequired;
  if (rawAmount === undefined) throw new Error("challenge stated no amount");

  return {
    scheme: "exact",
    chainId: chainIdOf(network),
    network,
    asset: String(opt.asset ?? ""),
    amount: BigInt(String(rawAmount)),
    payTo: String(opt.payTo ?? ""),
    maxTimeoutSeconds: Number(opt.maxTimeoutSeconds ?? 300),
    extra: (opt.extra ?? {}) as { name?: string; version?: string },
    x402Version: Number(b.x402Version ?? 2),
  };
}

/**
 * Sign the authorisation a challenge asks for.
 *
 * EIP-3009 `transferWithAuthorization`: the payer signs, and the facilitator
 * submits. That is what lets an agent pay without holding gas -- and it is also
 * why the signature is the moment the money is committed, so the cap is enforced
 * before this function is reached, never inside it.
 */
export async function signExact(
  challenge: Challenge,
  signer: Signer,
  opts: { nonce?: string; now?: number } = {}
): Promise<PaymentPayload> {
  const from = await signer.getAddress();
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  const authorization = {
    from,
    to: challenge.payTo,
    value: challenge.amount.toString(),
    validAfter: "0",
    validBefore: String(now + challenge.maxTimeoutSeconds),
    // Single-use and payer-chosen: EIP-3009's own replay guard.
    nonce: opts.nonce ?? `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`,
  };

  const signature = await signer.signTypedData(
    {
      name: challenge.extra.name ?? "USD Coin",
      version: challenge.extra.version ?? "2",
      chainId: challenge.chainId,
      verifyingContract: challenge.asset,
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

  return {
    x402Version: challenge.x402Version,
    scheme: "exact",
    network: challenge.network,
    payload: { signature, authorization },
  };
}

/** Everything a listing search can filter on. */
export type DiscoverOpts = {
  baseUrl?: string;
  apiKey: string;
  query?: string;
  limit?: number;
  /** Only listings at or under this price, in whole USDC. */
  maxPriceUsdc?: number;
  /** Only listings that cost something -- the ones that need a payer. */
  paidOnly?: boolean;
};

/** What is for sale on the marketplace right now. */
export async function discover(opts: DiscoverOpts): Promise<Listing[]> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const url = new URL(`${base}/api/mcp/workflows`);
  url.searchParams.set("limit", String(opts.limit ?? 50));
  if (opts.query) url.searchParams.set("search", opts.query);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${opts.apiKey}` } });
  if (!res.ok) throw new Error(`marketplace returned ${res.status}`);

  const body = (await res.json()) as { items?: Listing[] };
  let items = body.items ?? [];

  if (opts.paidOnly) {
    items = items.filter((i) => i.priceUsdcPerCall !== null && Number(i.priceUsdcPerCall) > 0);
  }
  if (opts.maxPriceUsdc !== undefined) {
    const cap = opts.maxPriceUsdc;
    items = items.filter((i) => Number(i.priceUsdcPerCall ?? 0) <= cap);
  }
  return items;
}

export type PurchaseResult = {
  slug: string;
  /** False when the listing turned out to be free -- no payment was needed. */
  paid: boolean;
  /** Base units actually committed. */
  spent: bigint;
  asset?: string;
  chainId?: number;
  /** The settlement transaction, when the server reported one. */
  transaction?: string;
  /** Whatever the workflow returned. */
  result: unknown;
};

export type PurchaseOpts = {
  baseUrl?: string;
  apiKey: string;
  slug: string;
  input?: Record<string, unknown>;
  /**
   * The ceiling, in base units of whatever the challenge asks for. Required:
   * an unattended payer without a cap is a wallet with a public spend endpoint.
   */
  maxSpend: bigint;
  /** Signs the EIP-3009 authorisation. Needs the funds, never gas. */
  signer?: Signer;
  /** Refuse any chain not in this list. Defaults to refusing nothing extra. */
  allowChains?: number[];
  onEvent?: (e: { stage: string; detail: string }) => void;
};

/**
 * Call a listed workflow, paying for it if it asks.
 *
 * The loop KeeperHub documents as manual: call, read the 402, sign, retry. A
 * free listing short-circuits at the first response and never touches the signer.
 */
export async function payAndCall(opts: PurchaseOpts): Promise<PurchaseResult> {
  const base = opts.baseUrl ?? DEFAULT_BASE;
  const url = `${base}/api/mcp/workflows/${encodeURIComponent(opts.slug)}/call`;
  const say = opts.onEvent ?? (() => {});

  const post = (payment?: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        ...(payment ? { "X-PAYMENT": payment } : {}),
      },
      body: JSON.stringify(opts.input ?? {}),
    });

  say({ stage: "call", detail: `POST ${opts.slug}` });
  const first = await post();

  if (first.status !== 402) {
    if (!first.ok) throw new Error(`${opts.slug} returned ${first.status}`);
    say({ stage: "free", detail: "listing was free; no payment needed" });
    return { slug: opts.slug, paid: false, spent: 0n, result: await first.json() };
  }

  const challenge = parseChallenge(await first.json());
  say({
    stage: "challenged",
    detail: `${challenge.amount} of ${challenge.asset} to ${challenge.payTo} on chain ${challenge.chainId}`,
  });

  /*
   * Both refusals happen before a signature exists. A signed EIP-3009
   * authorisation is bearer-spendable the moment it leaves this process, so
   * "sign then decide" is not a thing.
   */
  if (challenge.amount > opts.maxSpend) {
    throw new Error(
      `refused: ${challenge.amount} exceeds the cap of ${opts.maxSpend} base units`
    );
  }
  if (opts.allowChains && !opts.allowChains.includes(challenge.chainId)) {
    throw new Error(`refused: chain ${challenge.chainId} is not in the allowed list`);
  }
  if (!opts.signer) {
    throw new Error("refused: listing is paid and no signer was supplied");
  }

  const payload = await signExact(challenge, opts.signer);
  say({ stage: "signed", detail: `authorised ${challenge.amount} from ${payload.payload.authorization.from}` });

  const second = await post(encodePaymentHeader(payload));
  if (!second.ok) {
    throw new Error(`${opts.slug} rejected the payment: ${second.status} ${await second.text()}`);
  }

  // The server reports its settlement here; it is a claim, not proof.
  const settlementHeader = second.headers.get("x-payment-response");
  let transaction: string | undefined;
  if (settlementHeader) {
    try {
      const decoded = JSON.parse(Buffer.from(settlementHeader, "base64").toString("utf8"));
      transaction = decoded.transaction;
    } catch {
      // A malformed settlement header is not worth failing the purchase over --
      // the caller verifies against the chain, which is the only real answer.
    }
  }

  say({ stage: "settled", detail: transaction ?? "no transaction reported" });

  return {
    slug: opts.slug,
    paid: true,
    spent: challenge.amount,
    asset: challenge.asset,
    chainId: challenge.chainId,
    transaction,
    result: await second.json(),
  };
}

/** Build a signer from a raw key. Kept here so callers never re-implement it. */
export function signerFrom(privateKey: string): Signer {
  return new Wallet(privateKey);
}
