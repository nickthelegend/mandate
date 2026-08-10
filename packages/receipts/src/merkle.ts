/**
 * The merkle root of a batch, and the proof that one receipt is in it.
 *
 * Anchoring receipts one at a time costs a transaction each, so they go up in
 * batches under a single root. What matters is that batching must not weaken
 * the claim: anyone holding one receipt can still prove it was in the batch
 * that was anchored, without trusting the party that anchored it and without
 * being shown the other receipts.
 *
 * Two details that are easy to get wrong and are the whole security of it:
 *
 * **An odd node is promoted, not duplicated.** Duplicating the last leaf lets
 * a batch of three produce the same root as a crafted batch of four — the
 * classic CVE-2012-2459 second-preimage. Promotion has no such twin.
 *
 * **Leaves and internal nodes are hashed with different prefixes.** Without
 * that, an internal node can be presented as a leaf, and a proof for a node
 * that was never a receipt verifies. One byte of domain separation closes it.
 */

import { keccak256, concat, toUtf8Bytes } from "ethers";

/** Domain tags, so a leaf hash can never collide with an internal node hash. */
const LEAF = "0x00";
const NODE = "0x01";

export type Hex = `0x${string}`;

/** The hash of one receipt, as it enters the tree. */
export function leafHash(receiptId: string, bodyHash: string): Hex {
  return keccak256(concat([LEAF, receiptId as Hex, bodyHash as Hex])) as Hex;
}

function pairHash(a: Hex, b: Hex): Hex {
  // Sorted, so a verifier does not need to carry left/right for each step.
  const [x, y] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(concat([NODE, x, y])) as Hex;
}

/**
 * The root of a batch.
 *
 * An empty batch has no root: returning a zero hash would be a value that looks
 * anchorable and commits to nothing, and something would eventually anchor it.
 */
export function merkleRoot(leaves: readonly Hex[]): Hex | null {
  if (leaves.length === 0) return null;
  let level = [...leaves];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) {
      // Odd one out is promoted unchanged, never paired with itself.
      next.push(i + 1 < level.length ? pairHash(level[i], level[i + 1]) : level[i]);
    }
    level = next;
  }
  return level[0];
}

/** The sibling hashes needed to walk one leaf up to the root. */
export function merkleProof(leaves: readonly Hex[], index: number): Hex[] {
  if (index < 0 || index >= leaves.length) throw new RangeError(`no leaf at ${index}`);
  const proof: Hex[] = [];
  let level = [...leaves];
  let i = index;
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let j = 0; j < level.length; j += 2) {
      if (j + 1 < level.length) {
        if (j === i || j + 1 === i) proof.push(level[j === i ? j + 1 : j]);
        next.push(pairHash(level[j], level[j + 1]));
      } else {
        // Promoted: no sibling, so no proof step for this level.
        next.push(level[j]);
      }
    }
    i = Math.floor(i / 2);
    level = next;
  }
  return proof;
}

/**
 * Check a proof.
 *
 * Pure and dependency-free on purpose: this is the half a third party runs, and
 * it should not require anything from this repo beyond the function itself.
 */
export function verifyProof(leaf: Hex, proof: readonly Hex[], root: Hex): boolean {
  let node = leaf;
  for (const sibling of proof) node = pairHash(node, sibling);
  return node.toLowerCase() === root.toLowerCase();
}

/** The canonical hash of a receipt body, for the leaf. */
export function bodyHash(body: unknown): Hex {
  return keccak256(toUtf8Bytes(JSON.stringify(body, Object.keys(body as object).sort()))) as Hex;
}
