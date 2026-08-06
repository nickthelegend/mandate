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

export { createTools, type Env, type Tools, type AuditEntry } from "./tools.ts";
export { settle, ESCROW_ABI, type SettleParams, type SettleResult } from "./settle.ts";
export {
  work,
  jobId,
  loadJobs,
  postJob,
  type Job,
  type AgentReport,
} from "./agent.ts";
export { KeeperHubClient } from "./keeperhub/client.ts";
