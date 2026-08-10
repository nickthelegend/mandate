/**
 * Single-use approval codes.
 *
 * Only the sha256 hash is ever stored, so a leaked database row cannot be used
 * to forge an approval — an attacker with read access to the escalation
 * collection still cannot produce a code that validates. The comparison is
 * constant-time, because a byte-by-byte early return leaks how much of a
 * guessed code was right, and a code short enough to paste is short enough to
 * be worth guessing at.
 *
 * The code's lifetime is the escalation's: it is answerable exactly as long as
 * the escalation is. An approval that arrives after expiry is rejected rather
 * than honoured late, because the thing it would authorise has already
 * defaulted to denied.
 *
 * Ported from untch's `@untch/escalation` §27 approval codes.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A fresh code. 12 bytes of hex: short enough to paste, long enough not to guess. */
export function generateCode(): string {
  return randomBytes(12).toString("hex");
}

export function hashCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/**
 * Constant-time compare of a presented code against a stored hash.
 *
 * Never throws — a malformed stored hash returns false rather than crashing the
 * resolve path, since an exception here would turn a bad code into a 500 and
 * tell the caller something a plain rejection would not.
 */
export function codeMatchesHash(code: string, expectedHash: string): boolean {
  const presented = Buffer.from(hashCode(code), "hex");
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHash, "hex");
  } catch {
    return false;
  }
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}
