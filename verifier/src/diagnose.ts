/**
 * Why did this fail, and is retrying it worth anything?
 *
 * "Retry on failure" is where most automation quietly burns money. A revert
 * caused by an unchanged on-chain state will revert identically on the next
 * attempt, and the one after that; retrying it costs gas and rate limit and
 * changes nothing. A transaction that ran out of gas, or lost a race, will
 * often succeed unchanged. Those two look the same from the outside -- both are
 * "it did not work" -- and treating them the same is how a rescue service
 * becomes a way to lose money faster.
 *
 * So a diagnosis has to answer two questions, not one:
 *
 *   1. Will the same call succeed if sent again?          -> retryable
 *   2. Does something have to change first, and what?      -> correction
 *
 * The third answer, the one people forget, is "the outcome is unknown". A
 * timeout or a dropped connection is not a failure -- the transaction may be
 * in flight and about to land. Retrying that is how you double-execute. It is
 * treated separately from both success and failure throughout.
 */

export type Cause =
  | "out_of_gas" //          under-estimated; raise the limit and resend
  | "nonce_conflict" //      raced another sender; resend as-is
  | "insufficient_funds" //  payer cannot cover it; needs funding first
  | "insufficient_allowance" // approval too small; needs a new approval
  | "reverted" //            the contract said no; state must change first
  | "in_flight" //           outcome unknown; do NOT resend
  | "unknown";

export type Diagnosis = {
  cause: Cause;
  /** Safe to send the same call again? */
  retryable: boolean;
  /** What has to change before a retry can succeed. Empty when nothing does. */
  correction: string;
  /** Multiplier to apply to the gas limit on the retry. 1 = unchanged. */
  gasMultiplier: number;
  detail: string;
};

const D = (
  cause: Cause,
  retryable: boolean,
  correction: string,
  gasMultiplier: number,
  detail: string
): Diagnosis => ({ cause, retryable, correction, gasMultiplier, detail });

/**
 * Classify from whatever the chain or the execution layer gave us.
 *
 * Substring matching is unavoidable here and worth being honest about: the
 * reason string is produced by the target contract, the node, and the RPC
 * provider, none of which agree on wording and none of which expose a code.
 * The ordering below matters -- the more specific patterns are tested first,
 * because "insufficient allowance" also contains "insufficient".
 */
export function diagnose(input: {
  status?: string;
  reason?: string;
  gasUsed?: bigint;
  gasLimit?: bigint;
}): Diagnosis {
  const r = (input.reason ?? "").toLowerCase();

  // Unknown outcome first. Getting this wrong double-spends, so it outranks
  // every other classification.
  if (
    r.includes("timeout") ||
    r.includes("timed out") ||
    r.includes("already known") ||
    r.includes("already being processed") ||
    r.includes("in progress")
  ) {
    return D(
      "in_flight",
      false,
      "wait and re-read the receipt under the same key; do not resend",
      1,
      "the earlier attempt may still land"
    );
  }

  if (r.includes("insufficient allowance") || r.includes("transfer amount exceeds allowance")) {
    return D(
      "insufficient_allowance",
      false,
      "raise the ERC-20 approval to cover the amount, then retry",
      1,
      "the spender is not approved for enough"
    );
  }

  if (
    r.includes("insufficient funds") ||
    r.includes("exceeds balance") ||
    r.includes("transfer amount exceeds balance")
  ) {
    return D(
      "insufficient_funds",
      false,
      "fund the payer, then retry",
      1,
      "the payer cannot cover the transfer"
    );
  }

  if (r.includes("out of gas") || r.includes("intrinsic gas too low") || r.includes("gas required exceeds")) {
    return D("out_of_gas", true, "resend with a higher gas limit", 2, "under-estimated gas");
  }

  if (r.includes("nonce too low") || r.includes("replacement transaction underpriced")) {
    return D("nonce_conflict", true, "resend as-is", 1, "raced another sender");
  }

  /*
   * A receipt that consumed essentially its whole limit is out-of-gas even when
   * nothing says so. Nodes frequently report this as a bare revert, and the
   * distinction decides whether a retry is free money or wasted gas.
   */
  if (input.status === "0x0" && input.gasUsed && input.gasLimit) {
    const used = Number(input.gasUsed);
    const limit = Number(input.gasLimit);
    if (limit > 0 && used / limit > 0.97) {
      return D(
        "out_of_gas",
        true,
        "resend with a higher gas limit",
        2,
        `consumed ${used}/${limit} of the limit`
      );
    }
  }

  if (r.includes("revert") || r.includes("execution reverted") || input.status === "0x0") {
    return D(
      "reverted",
      false,
      "on-chain state must change before this can succeed",
      1,
      input.reason ?? "the contract rejected the call"
    );
  }

  // Unknown is not retryable. Guessing in the direction of "send it again" is
  // the expensive guess.
  return D("unknown", false, "inspect manually", 1, input.reason ?? "no reason given");
}

/**
 * Should a rescue service take this job on?
 *
 * It only earns on success, so it should decline anything it cannot fix. A
 * revert needs someone else to change state; an unfunded payer needs funding.
 * Taking those on and failing is unpaid work, and taking on an in-flight
 * transaction risks executing it twice.
 */
export function worthRescuing(d: Diagnosis): boolean {
  return d.retryable;
}
