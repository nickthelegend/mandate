/**
 * Whether an autonomous marketplace purchase is allowed to happen.
 *
 * NOT a duplicate of `mandate-policy`, though they overlap and it is fair to
 * ask. That engine is the spend *authority*: fifteen rules, anchored on chain,
 * governing what an agent may do with its budget. This is the narrower guard on
 * one specific outbound act -- paying an x402 challenge on KeeperHub's
 * marketplace -- and it exists for a gate the authority has no concept of:
 * PRICE_MISMATCH, comparing what a listing advertised against what its 402
 * actually demands. The authority judges the agent; this judges the seller.
 *
 * Ported from ChronicleAI's desk policy engine (`apps/api/src/desk/`), which
 * gates every onchain action behind a pure `evaluate()` that does no I/O and
 * returns a decision carrying named reason codes plus a snapshot of the inputs
 * it judged. Its own rules were DeFi-desk specific -- AUM floors, health
 * factors, gas regimes -- and none of those apply here. The architecture does:
 *
 *   - Pure. Every input is explicit, so a refusal is reproducible in a test
 *     rather than something you have to get the network into a mood to see.
 *   - Named reason codes, never a bare boolean. "refused" is not an answer an
 *     operator can act on; `PRICE_ABOVE_CAP` is.
 *   - A snapshot of what was judged, so the audit trail records the state the
 *     decision was made against and not just its mandate.
 *   - A kill switch that outranks every other gate.
 *
 * The gates below are this product's, not ChronicleAI's. The one worth calling
 * out is PRICE_MISMATCH: the marketplace advertises `priceUsdcPerCall`, but the
 * amount that actually leaves the wallet is whatever the 402 challenge states.
 * Nothing checks those against each other, so a listing can advertise $0.01 and
 * challenge for $100. An unattended buyer that does not compare them is one
 * malicious seller away from an empty wallet.
 */

/** Every way a purchase can be refused. Stable strings: they end up in audit. */
export type SpendReason =
  | "KILL_SWITCH_ARMED"
  | "NO_SIGNER"
  | "PRICE_ABOVE_CAP"
  | "PRICE_MISMATCH"
  | "BUDGET_EXHAUSTED"
  | "CHAIN_NOT_ALLOWED"
  | "ASSET_NOT_ALLOWED"
  | "PAYEE_NOT_ALLOWED"
  | "DUPLICATE_PURCHASE"
  | "ALLOWED";

export type SpendVerdict = "allow" | "refuse";

export type SpendPolicyConfig = {
  /** Hard ceiling for any single purchase, in base units of the asset. */
  maxPerPurchase: bigint;
  /** Ceiling across every purchase this policy has approved, in base units. */
  maxTotal: bigint;
  /** Chain ids a payment may settle on. Empty means no chain restriction. */
  allowChains?: number[];
  /** Token contracts that may be spent. Empty means no asset restriction. */
  allowAssets?: string[];
  /** Recipients that may be paid. Empty means no payee restriction. */
  allowPayees?: string[];
  /**
   * How far the challenge may exceed the advertised price before it is treated
   * as a bait-and-switch, as a fraction. 0.05 allows 5% over.
   */
  priceTolerance?: number;
};

export type SpendContext = {
  /** What the marketplace listing advertised, in whole USDC. Undefined if unlisted. */
  advertisedUsdc?: number | null;
  /** What the 402 challenge actually demands, in base units. */
  amount: bigint;
  /** Decimals of the asset, for comparing the two. USDC is 6. */
  decimals?: number;
  chainId: number;
  asset: string;
  payTo: string;
  /** Total already committed by this policy, in base units. */
  spentSoFar: bigint;
  killSwitchArmed?: boolean;
  hasSigner: boolean;
  /** Slugs already bought in this run, so a retry loop cannot double-spend. */
  alreadyPurchased?: string[];
  slug?: string;
};

/** What was judged, recorded alongside the mandate. */
export type SpendSnapshot = {
  amount: string;
  advertisedUsdc: number | null;
  chainId: number;
  asset: string;
  payTo: string;
  spentSoFar: string;
  remainingBudget: string;
  killSwitchArmed: boolean;
};

export type SpendDecision = {
  allow: boolean;
  verdict: SpendVerdict;
  /** Every gate that fired. Empty on allow except for `ALLOWED`. */
  reasonCodes: SpendReason[];
  /** One line an operator can read without the codes. */
  detail: string;
  snapshot: SpendSnapshot;
};

const lower = (s: string) => s.toLowerCase();

/**
 * Judge one purchase.
 *
 * Collects every failing gate rather than returning on the first: an operator
 * fixing a refusal wants the whole list, not to discover the next one by
 * retrying.
 */
export function evaluateSpend(
  config: SpendPolicyConfig,
  ctx: SpendContext
): SpendDecision {
  const decimals = ctx.decimals ?? 6;
  const remaining = config.maxTotal > ctx.spentSoFar ? config.maxTotal - ctx.spentSoFar : 0n;

  const snapshot: SpendSnapshot = {
    amount: ctx.amount.toString(),
    advertisedUsdc: ctx.advertisedUsdc ?? null,
    chainId: ctx.chainId,
    asset: ctx.asset,
    payTo: ctx.payTo,
    spentSoFar: ctx.spentSoFar.toString(),
    remainingBudget: remaining.toString(),
    killSwitchArmed: Boolean(ctx.killSwitchArmed),
  };

  const codes: SpendReason[] = [];

  // The kill switch outranks everything, including a purchase that is otherwise fine.
  if (ctx.killSwitchArmed) codes.push("KILL_SWITCH_ARMED");
  if (!ctx.hasSigner) codes.push("NO_SIGNER");
  if (ctx.amount > config.maxPerPurchase) codes.push("PRICE_ABOVE_CAP");
  if (ctx.amount > remaining) codes.push("BUDGET_EXHAUSTED");

  if (config.allowChains?.length && !config.allowChains.includes(ctx.chainId)) {
    codes.push("CHAIN_NOT_ALLOWED");
  }
  if (config.allowAssets?.length && !config.allowAssets.map(lower).includes(lower(ctx.asset))) {
    codes.push("ASSET_NOT_ALLOWED");
  }
  if (config.allowPayees?.length && !config.allowPayees.map(lower).includes(lower(ctx.payTo))) {
    codes.push("PAYEE_NOT_ALLOWED");
  }
  if (ctx.slug && ctx.alreadyPurchased?.includes(ctx.slug)) {
    codes.push("DUPLICATE_PURCHASE");
  }

  /*
   * The advertised price and the challenged amount are set by the same party
   * at different moments, and only one of them costs the buyer money.
   */
  if (ctx.advertisedUsdc !== undefined && ctx.advertisedUsdc !== null && ctx.advertisedUsdc > 0) {
    const tolerance = config.priceTolerance ?? 0.05;
    const advertisedBase = BigInt(
      Math.round(ctx.advertisedUsdc * 10 ** decimals * (1 + tolerance))
    );
    if (ctx.amount > advertisedBase) codes.push("PRICE_MISMATCH");
  }

  if (codes.length === 0) {
    return {
      allow: true,
      verdict: "allow",
      reasonCodes: ["ALLOWED"],
      detail: `allowed ${ctx.amount} of ${ctx.asset} to ${ctx.payTo} on chain ${ctx.chainId}`,
      snapshot,
    };
  }

  return {
    allow: false,
    verdict: "refuse",
    reasonCodes: codes,
    detail: `refused: ${codes.join(", ")}`,
    snapshot,
  };
}

/**
 * A budget that remembers what it approved.
 *
 * ChronicleAI keeps this in its capital manager against a database; here it is
 * in-process and explicit, because the caller decides what durable means. What
 * carries over is that the running total is the policy's own -- a cap the
 * caller has to remember to decrement is a cap that eventually is not.
 */
export class SpendLedger {
  #spent = 0n;
  #purchased: string[] = [];
  #armed = false;

  constructor(private readonly config: SpendPolicyConfig) {}

  get spent(): bigint {
    return this.#spent;
  }

  get purchased(): readonly string[] {
    return this.#purchased;
  }

  get killSwitchArmed(): boolean {
    return this.#armed;
  }

  /** Stop approving anything. There is deliberately no automatic disarm. */
  arm(): void {
    this.#armed = true;
  }

  disarm(): void {
    this.#armed = false;
  }

  evaluate(ctx: Omit<SpendContext, "spentSoFar" | "alreadyPurchased" | "killSwitchArmed">): SpendDecision {
    return evaluateSpend(this.config, {
      ...ctx,
      spentSoFar: this.#spent,
      alreadyPurchased: this.#purchased,
      killSwitchArmed: this.#armed,
    });
  }

  /** Record a purchase the policy approved and that actually settled. */
  commit(amount: bigint, slug?: string): void {
    this.#spent += amount;
    if (slug) this.#purchased.push(slug);
  }
}
