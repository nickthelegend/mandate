/**
 * The one client this site uses.
 *
 * Built from `outcome-sdk` -- the same package published to npm, not a private
 * copy of the logic. That is deliberate: if the SDK could not drive this site,
 * the SDK would not be worth publishing, and a dashboard reading the chain
 * through a bespoke backend route would prove nothing about either.
 *
 * All of it runs in the visitor's browser against a public RPC. There is no
 * server here to trust.
 */

import { OutcomeClient } from "outcome-sdk";

export const DEPLOYMENT = {
  chainId: 11155111,
  chainName: "Sepolia",
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  escrow: "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B",
  token: "0x49C86277a91002c4943837bf20F6ED41976Db09F",
  tokenSymbol: "tUSDC",
  decimals: 6,
  explorer: "https://sepolia.etherscan.io",
} as const;

export const outcome = new OutcomeClient({
  provider: DEPLOYMENT.rpcUrl,
  escrow: DEPLOYMENT.escrow,
  token: DEPLOYMENT.token,
  chainId: DEPLOYMENT.chainId,
});

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
