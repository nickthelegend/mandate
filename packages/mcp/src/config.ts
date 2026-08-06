/**
 * Configuration, resolved once at startup.
 *
 * Every read-only tool works with no configuration at all. That is deliberate:
 * the point of this server is that a payment can be checked by whoever is being
 * asked to trust it, and a verification tool that first demands an API key has
 * already lost the argument. `npx outcome-mcp` against the public defaults can
 * verify any Sepolia transaction on the spot.
 *
 * Only settlement -- the one operation that moves money -- needs a credential,
 * and its absence is reported when the tool is called rather than at boot, so a
 * missing key costs one clear error instead of a server that refuses to start.
 */

export type Config = {
  rpcUrl: string;
  escrow: string;
  token: string;
  chainId: number;
  keeperHubApiKey?: string;
  auditPath: string | null;
};

/** The live deployment, so the defaults point at something real. */
export const SEPOLIA = {
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  escrow: "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B",
  token: "0x49C86277a91002c4943837bf20F6ED41976Db09F",
  chainId: 11155111,
} as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    rpcUrl: env.OUTCOME_RPC_URL ?? env.SEPOLIA_RPC_URL ?? SEPOLIA.rpcUrl,
    escrow: env.OUTCOME_ESCROW ?? SEPOLIA.escrow,
    token: env.OUTCOME_TOKEN ?? env.POLARIS_USDC ?? SEPOLIA.token,
    chainId: Number(env.OUTCOME_CHAIN_ID ?? SEPOLIA.chainId),
    keeperHubApiKey: env.KEEPERHUB_API_KEY,
    // "-" turns the trail off; anything else is a path. Off is never the default,
    // because a service that decides who gets paid owes an account of why.
    auditPath: env.OUTCOME_AUDIT_LOG === "-" ? null : (env.OUTCOME_AUDIT_LOG ?? ".outcome/audit.jsonl"),
  };
}

export function describe(c: Config): string {
  return [
    `  rpc      ${c.rpcUrl}`,
    `  escrow   ${c.escrow}`,
    `  token    ${c.token}`,
    `  chain    ${c.chainId}`,
    `  settle   ${c.keeperHubApiKey ? "enabled (KeeperHub key present)" : "read-only (set KEEPERHUB_API_KEY to settle)"}`,
    `  audit    ${c.auditPath ?? "disabled"}`,
  ].join("\n");
}
