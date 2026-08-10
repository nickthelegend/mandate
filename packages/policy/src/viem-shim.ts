/**
 * The viem surface the ported policy engine actually used, on ethers.
 *
 * Untch's engine is written against viem; this project is committed to ethers,
 * and pulling a second web3 library in for four functions would be the tail
 * wagging the dog. `Hex` and `Address` were only ever used as type aliases.
 *
 * `encodeAbiParameters` over an all-static parameter list is byte-for-byte
 * identical to Solidity `abi.encode`, and so is ethers' AbiCoder -- which is
 * what keeps `hashSpendIntent` matching the contract's `IntentHash.hashIntent`.
 */

import { AbiCoder, getAddress, isAddress as ethersIsAddress, keccak256 as ethersKeccak, parseUnits as ethersParseUnits, sha256 as ethersSha256, toUtf8Bytes } from "ethers";

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export function keccak256(data: Uint8Array | Hex): Hex {
  return ethersKeccak(data) as Hex;
}

export function stringToBytes(s: string): Uint8Array {
  return toUtf8Bytes(s);
}

/*
 * viem takes `{ strict }` to control checksum enforcement; ethers already
 * accepts any-case and validates the checksum only when the input is mixed.
 * The option is accepted and ignored so callers port unchanged -- and because
 * canon deliberately hashes lowercase, checksum case must never affect a hash.
 */
export function isAddress(value: string, _opts?: { strict?: boolean }): boolean {
  return ethersIsAddress(value);
}

export function parseUnits(value: string, decimals: number): bigint {
  return ethersParseUnits(value, decimals);
}

export function encodeAbiParameters(
  params: readonly { readonly name: string; readonly type: string }[],
  values: readonly unknown[]
): Hex {
  return AbiCoder.defaultAbiCoder().encode(
    params.map((p) => p.type),
    values as unknown[]
  ) as Hex;
}

/**
 * sha256 over a utf8 string.
 *
 * Here rather than `node:crypto` because this package is imported by the web
 * console, and one `node:` import anywhere reachable from the entry point
 * breaks a browser build for the whole module graph. ethers ships the same
 * primitive and already had to be a dependency.
 */
export function sha256Utf8(value: string): string {
  return ethersSha256(toUtf8Bytes(value));
}

export { getAddress };
