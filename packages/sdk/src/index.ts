/**
 * outcome-sdk -- pay agents for verified results, not for attempts.
 *
 * This entry is isomorphic. It runs in a browser, an edge function, or Node,
 * and it deliberately does not reach `node:fs`, a private key, or a KeeperHub
 * credential. Everything here is read-and-verify.
 *
 * That split is a design position, not packaging convenience. The party being
 * asked to trust a payment is the one who most needs to check it, so checking
 * must not require privileged access. `./node` holds the parts that sign,
 * settle, or write to disk; `./react` holds hooks over this entry.
 *
 * A barrel that quietly pulled a Node builtin into a browser bundle is a real
 * bug I shipped once already, so the build asserts this file's output imports
 * nothing from `node:`.
 */

export {
  OutcomeClient,
  intentId,
  INTENT_STATES,
  type OutcomeConfig,
  type Intent,
  type IntentRecord,
  type IntentState,
} from "./client.ts";

export {
  verifyTransfer,
  TRANSFER_TOPIC,
  type Verdict,
  type Receipt,
  type Expectation,
} from "./verify.ts";

export {
  diagnose,
  worthRescuing,
  type Cause,
  type Diagnosis,
} from "./diagnose.ts";

/*
 * Buying from KeeperHub's marketplace. Browser-safe: `ethers` already ships in
 * this entry for the client, and nothing here reaches for `node:`.
 */
export {
  discover,
  parseChallenge,
  payAndCall,
  signExact,
  signerFrom,
  type Challenge,
  type DiscoverOpts,
  type Listing,
  type PurchaseOpts,
  type PurchaseResult,
} from "./marketplace.ts";

/* Whether an autonomous purchase is allowed to happen. */
export {
  evaluateSpend,
  SpendLedger,
  type SpendContext,
  type SpendDecision,
  type SpendPolicyConfig,
  type SpendReason,
  type SpendSnapshot,
  type SpendVerdict,
} from "./spend-policy.ts";

/* The gate between a policy decision and the execution it authorised. */
export {
  executeIfAuthorised,
  failedRules,
  isApproved,
  type AuthorisedTransfer,
  type AuthoriseResult,
  type PolicyDecisionLike,
} from "./authority.ts";

/* Writing a spend policy on chain, through KeeperHub rather than a local key. */
export {
  anchorPolicy,
  pauseAnchoredPolicy,
  updateAnchoredPolicy,
  POLICY_REGISTRY_ABI,
  type AnchorConfig,
  type AnchorResult,
} from "./policy-anchor.ts";

/* Reading the anchor back, so it governs the decision instead of decorating it. */
export {
  assertAnchored,
  readAnchoredPolicy,
  statusFromAnchor,
  POLICY_STATUS,
  PolicyAnchorMismatch,
  PolicyNotUsable,
  type AnchoredPolicyRecord,
} from "./policy-loader.ts";
