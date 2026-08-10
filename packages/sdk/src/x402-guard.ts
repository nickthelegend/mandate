/**
 * The Challenge Binding Check.
 *
 * An x402 purchase has a gap between reading a listing and paying for it. You
 * discover a workflow advertised at $0.02, you call it, and the server answers
 * 402 with the terms it actually wants. Nothing in the protocol requires those
 * two to agree. A marketplace — or anything sitting between you and it — can
 * advertise two cents and challenge for fifty dollars to a different address,
 * and an unattended payer that signs whatever the challenge says will sign it.
 *
 * The binding check is the comparison nobody was making: every field of the
 * challenge against what was expected, before a signature exists. A signed
 * EIP-3009 authorisation is bearer-spendable the moment it leaves the process,
 * so there is no "sign it and check afterwards".
 *
 * Ported from untch's `@untch/x402-guard`. The field list and the split between
 * a replay failure and a binding failure are theirs — `mandate-policy`'s
 * `replay.contextBinding` rule was ported from the same source and its own
 * comment says "field order matches @untch/x402-guard CBC". The rule has been
 * in the chain since that port with nothing to read, returning NO_CHALLENGE on
 * every decision. This is the half that was missing.
 *
 * Nothing here decides. It produces the binding; the policy engine judges it.
 * A guard that both gathered the evidence and reached the verdict would be a
 * second authority, and the entire point is that there is one.
 */

/** One side of the comparison. Absent fields are absent, never empty strings. */
export type BindingFields = {
  recipient?: string;
  token?: string;
  amount?: string;
  resourceUrl?: string;
  endpoint?: string;
  method?: string;
  nonce?: string;
  expiry?: string;
  taskHash?: string;
  intentHash?: string;
  policyId?: string;
  metadataHash?: string;
};

/** What the engine's `replay.contextBinding` rule reads off the ledger window. */
export type ChallengeBinding = {
  expected: Readonly<Record<string, string | undefined>>;
  presented: Readonly<Record<string, string | undefined>>;
};

/** What a listing said it would cost, before the call was made. */
export type ExpectedTerms = {
  /** The listing's slug or resource identifier. */
  slug: string;
  /** Advertised price in base units of the advertised asset. */
  amount?: string | bigint;
  asset?: string;
  payTo?: string;
  chainId?: number;
  baseUrl?: string;
  method?: string;
};

/** What the 402 actually asked for. */
export type PresentedChallenge = {
  amount: string | bigint;
  asset: string;
  payTo: string;
  chainId?: number;
  resource?: string;
  nonce?: string;
  expiry?: string | number;
};

const str = (v: unknown): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
};

/**
 * Build the binding for one purchase.
 *
 * A field absent on BOTH sides is not a mismatch — it is a term neither party
 * committed to, and the rule treats it that way. A field present on one side
 * only IS a mismatch, because that is precisely the shape of a challenge that
 * added a term after the listing was read.
 */
export function bindingFor(
  expected: ExpectedTerms,
  presented: PresentedChallenge
): ChallengeBinding {
  const resource = str(presented.resource) ?? (expected.baseUrl ? `${expected.baseUrl}/${expected.slug}` : undefined);

  return {
    expected: {
      recipient: str(expected.payTo)?.toLowerCase(),
      token: str(expected.asset)?.toLowerCase(),
      amount: str(expected.amount),
      resourceUrl: resource,
      endpoint: str(expected.slug),
      method: str(expected.method) ?? "POST",
    },
    presented: {
      recipient: str(presented.payTo)?.toLowerCase(),
      token: str(presented.asset)?.toLowerCase(),
      amount: str(presented.amount),
      resourceUrl: resource,
      endpoint: str(expected.slug),
      method: str(expected.method) ?? "POST",
      // Carried only when the challenge supplied them. Inventing a nonce here
      // would make the replay half of the rule pass on a challenge that never
      // had one.
      ...(str(presented.nonce) ? { nonce: str(presented.nonce) } : {}),
      ...(str(presented.expiry) ? { expiry: str(presented.expiry) } : {}),
    },
  };
}

export type BindingMismatch = {
  field: string;
  expected: string | undefined;
  presented: string | undefined;
};

/**
 * The fields that must agree, in the order `mandate-policy` checks them.
 *
 * Kept here as well as in the engine deliberately: this list is what the guard
 * COMMITS to comparing, and a caller that never reaches the engine — a payer
 * running standalone — still gets the same answer. The engine remains the
 * authority; this is a fast local check that agrees with it.
 */
const BOUND_FIELDS = ["recipient", "token", "amount", "resourceUrl", "endpoint", "method"] as const;

/**
 * Compare a binding locally.
 *
 * Returned rather than thrown, and never "allowed": the verdict belongs to the
 * policy engine. This tells a caller what disagrees so a refusal can name the
 * field instead of saying the challenge looked wrong.
 */
export function bindingMismatches(b: ChallengeBinding): BindingMismatch[] {
  const out: BindingMismatch[] = [];
  for (const field of BOUND_FIELDS) {
    const e = b.expected[field];
    const p = b.presented[field];
    if (e === undefined && p === undefined) continue;
    if (e !== p) out.push({ field, expected: e, presented: p });
  }
  return out;
}

/** True when every bound field agrees. Convenience over `bindingMismatches`. */
export function bindingHolds(b: ChallengeBinding): boolean {
  return bindingMismatches(b).length === 0;
}
