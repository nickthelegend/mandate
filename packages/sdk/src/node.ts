/**
 * outcome-sdk/node -- the half that signs, settles, and writes to disk.
 *
 * Split from the main entry so that importing `outcome-sdk` in a browser never
 * drags in `node:fs`, a KeeperHub credential, or a wallet. Everything here
 * needs one of those.
 *
 * Settlement runs through KeeperHub's execute API rather than a raw send: it
 * simulates before broadcasting, carries a per-attempt idempotency key, and the
 * gas is sponsored. The action id embeds the verdict, so a refund cannot be
 * replayed as a release.
 */

export { createTools, type Env, type Tools } from "./tools.ts";
export {
  jobsFromEnv,
  fileJobs,
  memoryJobs,
  mongoJobs,
  type Job,
  type JobStore,
} from "./jobs.ts";
export {
  auditFromEnv,
  fileAudit,
  memoryAudit,
  mongoAudit,
  type AuditEntry,
  type AuditStore,
} from "./audit.ts";
export {
  mongoLedger,
  utcDayKey,
  toRuleTrace,
  RULE_DETAIL_FIELDS,
  LeaseUnavailable,
  type SpendLedger,
  type LedgerWindow,
  type DecisionRecord,
  type RuleTrace,
  type EffectsToApply,
  type StoredIntent,
} from "./ledger.ts";
export { settle, ESCROW_ABI, type SettleParams, type SettleResult } from "./settle.ts";
export {
  work,
  jobId,
  loadJobs,
  postJob,
  type AgentReport,
} from "./agent.ts";
export { KeeperHubClient } from "./keeperhub/client.ts";
export {
  executeIfAuthorised,
  isApproved,
  failedRules,
  type AuthoriseResult,
  type AuthorisedTransfer,
  type PolicyDecisionLike,
} from "./authority.ts";
export {
  readAnchoredPolicy,
  assertAnchored,
  statusFromAnchor,
  PolicyAnchorMismatch,
  PolicyNotUsable,
  POLICY_STATUS,
  type AnchoredPolicyRecord,
} from "./policy-loader.ts";
export {
  anchorPolicy,
  updateAnchoredPolicy,
  pauseAnchoredPolicy,
  POLICY_REGISTRY_ABI,
  type AnchorConfig,
  type AnchorResult,
} from "./policy-anchor.ts";
