/**
 * The one client this site uses.
 *
 * Built from `mandate-sdk` -- the same package published to npm, not a private
 * copy of the logic. That is deliberate: if the SDK could not drive this site,
 * the SDK would not be worth publishing, and a dashboard reading the chain
 * through a bespoke backend route would prove nothing about either.
 *
 * Two sources, and the distinction is the point rather than a caveat. Chain
 * reads happen in the visitor's browser against a public RPC — the receipt
 * proof check on /ledger is the one that matters, and it asks the contract
 * directly with no server in the path. Everything the authority decides comes
 * from the gateway, because a durable ledger is the whole reason the budget is
 * a budget.
 *
 * This comment used to say "there is no server here to trust", which was true
 * of the product this replaced and false the moment the authority became a
 * service. What is true is better: the gateway does not have to be trusted,
 * because the policy it enforces is anchored on chain and a reader can check
 * both the anchor and the receipts themselves.
 */


export const DEPLOYMENT = {
  chainId: 11155111,
  chainName: "Sepolia",
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  /**
   * More than one, in the order they actually work **from a browser**.
   *
   * The proof check on /ledger is the page's "don't take our word for it"
   * affordance, and pointing it at a single free endpoint broke it the moment
   * that endpoint dropped a connection. Adding fallbacks fixed that and
   * introduced a worse problem: the first list was written from the endpoints
   * that work in Node, and two of them fail from a page — `sepolia.drpc.org`
   * answers 400 and `rpc.sepolia.org` sends no CORS header — so every
   * fallthrough walked through two guaranteed console errors before reaching a
   * working host.
   *
   * Measured from `nickthelegend.github.io` itself, in Chrome, with the exact
   * `eth_call` the page sends — not `eth_blockNumber`, because a host can
   * answer one and refuse the other.
   *
   * The list is short because a host that reliably fails is not a fallback, it
   * is guaranteed console noise on every check: `1rpc.io` was first here and
   * CORS-blocks browser origins, so every proof check began with an error the
   * page then recovered from. Both of these answer 200 today, and when they
   * stop, the gateway fallback catches it and the page says so.
   *
   * All public and keyless on purpose: the check has to run in a visitor's own
   * browser with nothing configured, or it is not independent verification.
   */
  rpcUrls: [
    "https://sepolia.gateway.tenderly.co",
    "https://ethereum-sepolia-rpc.publicnode.com",
  ],
  /** PolicyRegistry: where a spend policy is anchored, and where a pause takes effect. */
  registry: "0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304",
  token: "0x49C86277a91002c4943837bf20F6ED41976Db09F",
  tokenSymbol: "tUSDC",
  decimals: 6,
  explorer: "https://sepolia.etherscan.io",
} as const;


/** The authority. Every live number on this site comes from here. */
export const GATEWAY =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "https://gateway-production-944e.up.railway.app";

export const tx = (hash: string) => `${DEPLOYMENT.explorer}/tx/${hash}`;
export const address = (a: string) => `${DEPLOYMENT.explorer}/address/${a}`;
/** Straight to the verified source, which is the part worth reading. */
export const source = (a: string) => `${DEPLOYMENT.explorer}/address/${a}#code`;

/** Base units to a human string, without pulling in a formatting library. */
export function amount(base: string | bigint): string {
  const v = BigInt(base);
  const unit = 10n ** BigInt(DEPLOYMENT.decimals);
  const whole = v / unit;
  const frac = (v % unit).toString().padStart(DEPLOYMENT.decimals, "0").slice(0, 2);
  return `${whole}.${frac}`;
}

/** `0x1234…cdef` -- long enough to recognise, short enough to sit in a table. */
export function short(hex: string, lead = 6, tail = 4): string {
  if (hex.length <= lead + tail + 2) return hex;
  return `${hex.slice(0, lead + 2)}…${hex.slice(-tail)}`;
}
