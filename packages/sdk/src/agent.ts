/**
 * A worker agent that finds jobs, does them, and gets itself paid.
 *
 * Nothing here is driven by a human. The loop is:
 *
 *   watch the chain for open intents naming this agent as payee
 *     -> read the job the intent commits to
 *     -> do the work on chain
 *     -> verify its own work from the receipt
 *     -> settle through KeeperHub, which pays it
 *
 * The agent does not get to declare its work complete. It performs the action,
 * then hands a transaction hash to a verifier that reads the receipt and
 * decides. An agent that could assert its way to a payout is the thing this
 * project exists to replace, so the agent is held to the same evidence standard
 * as anyone else -- including when the agent is the one being paid.
 *
 * It is also allowed to fail. If the work does not land, the verifier refunds
 * the payer and the agent earns nothing. That is the intended behaviour, not an
 * error path, and the demo exercises it.
 */

import { JsonRpcProvider, Contract, keccak256, toUtf8Bytes, formatUnits } from "ethers";
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { KeeperHubClient } from "./keeperhub/client.ts";
import { fileJobs, type Job, type JobStore } from "./jobs.ts";
import type { AuditStore } from "./audit.ts";
import { createTools } from "./tools.ts";

const ESCROW_ABI = [
  "event Claimed(bytes32 indexed intentId, address indexed payer, address indexed payee, address beneficiary, uint256 amount, uint64 refundableAt)",
  "function intents(bytes32) view returns (address payer,address payee,address beneficiary,uint256 amount,uint64 refundableAt,uint8 state)",
];
const ERC20 = ["function decimals() view returns (uint8)"];

export type { Job, JobStore } from "./jobs.ts";
export { fileJobs, memoryJobs, mongoJobs, jobsFromEnv } from "./jobs.ts";

export function jobId(task: string, payee: string): string {
  return keccak256(toUtf8Bytes(`${task}|${payee.toLowerCase()}`));
}

/** @deprecated use a JobStore. Kept so existing callers keep working. */
export function loadJobs(path: string): Map<string, Job> {
  if (!existsSync(path)) return new Map();
  const m = new Map<string, Job>();
  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    try {
      const j = JSON.parse(line) as Job;
      m.set(j.intentId.toLowerCase(), j);
    } catch {
      // A torn final line costs one job, not the board.
    }
  }
  return m;
}

/** @deprecated use a JobStore. */
export function postJob(path: string, job: Job): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(job)}\n`);
}

export type AgentReport = {
  intentId: string;
  took: boolean;
  workTx?: string;
  outcome?: string;
  reason: string;
};

/**
 * One pass of the agent's loop.
 *
 * Returns a report per intent rather than logging, so the caller decides how to
 * present it and the behaviour stays testable.
 */
export async function work(opts: {
  provider: JsonRpcProvider;
  /**
   * The address this agent is paid at.
   *
   * An address, not a wallet. The agent signs nothing and holds no key: it
   * reads the chain through a public provider and moves value through
   * KeeperHub, which owns the only signer involved. An agent that had to guard
   * a private key would need somewhere safe to keep it, and "somewhere safe"
   * is not a thing an autonomous process running unattended has.
   */
  agentAddress: string;
  kh: KeeperHubClient;
  escrow: string;
  token: string;
  chainId: number;
  /** Where the task strings live. A path uses the file store. */
  jobsPath?: string;
  /** A store, when the caller has one -- a database, typically. */
  jobs?: JobStore;
  /** Where the agent's decisions are recorded. */
  audit?: AuditStore;
  lookbackBlocks?: number;
}): Promise<AgentReport[]> {
  const { provider, agentAddress, escrow, token } = opts;
  const jobStore = opts.jobs ?? fileJobs(opts.jobsPath ?? ".outcome/jobs.jsonl");
  const tools = createTools(
    {
      provider,
      kh: opts.kh,
      escrow,
      token,
      chainId: opts.chainId,
    },
    opts.audit ? { audit: opts.audit } : {}
  );

  const c = new Contract(escrow, ESCROW_ABI, provider);
  const head = await provider.getBlockNumber();
  const from = Math.max(0, head - (opts.lookbackBlocks ?? 45_000));

  // Only intents naming this agent. Filtering by topic rather than pulling
  // everything keeps the agent from paying attention to work that is not its.
  const claims = await c.queryFilter(
    c.filters.Claimed(null, null, agentAddress),
    from,
    head
  );

  // Read once: the transfer API speaks human units and the escrow speaks base
  // units, so something has to know the scale.
  const decimals: number = await new Contract(token, ERC20, provider).decimals();

  const jobs = await jobStore.all();
  const reports: AgentReport[] = [];

  for (const ev of claims) {
    // queryFilter widens to Log | EventLog; a topic-filtered query only ever
    // yields the decoded form, but the type does not know that.
    if (!("args" in ev)) continue;
    const intentId: string = ev.args.intentId;
    const state = await tools.outcome_get_intent({ intentId });
    if (state.state !== "open") continue;

    const job = jobs.get(intentId.toLowerCase());
    if (!job) {
      // The agent cannot verify work it cannot describe, so it will not take
      // money for it. Leaving the intent open lets the payer reclaim.
      reports.push({
        intentId,
        took: false,
        reason: "no job description for this intent; declining rather than guessing",
      });
      continue;
    }

    const owed = BigInt(state.amount);

    /*
     * Do the work, through KeeperHub.
     *
     * There is no local balance pre-check any more, and losing it is an
     * improvement rather than a regression. KeeperHub simulates before it
     * sends, so an underfunded wallet fails here as a clean refusal that never
     * touches the chain -- strictly better than a balance read that can be
     * stale by the time the transaction lands.
     *
     * The idempotency key is the intent id. Two copies of this agent racing the
     * same open intent produce the same key, and the second one replays the
     * first one's result instead of paying twice. The escrow's claim guard
     * stops two *payers* colliding; this stops two *workers* colliding, and
     * they are different collisions.
     */
    let workTx: string | undefined;
    try {
      const status = await opts.kh.transferAndConfirm(
        {
          chainId: opts.chainId,
          recipientAddress: job.deliverTo,
          amount: formatUnits(owed, decimals),
          tokenAddress: token,
        },
        { idempotencyKey: `outcome-work-${intentId}` }
      );
      workTx = status.transactionHash;
    } catch (err: unknown) {
      const e = err as { message?: string };
      reports.push({
        intentId,
        took: false,
        reason: `could not deliver: ${e.message ?? String(err)}`,
      });
      continue;
    }

    if (!workTx) {
      // Completed with no transaction to point at. Not a payment.
      reports.push({
        intentId,
        took: false,
        reason: "KeeperHub reported completion but named no transaction",
      });
      continue;
    }

    // Then prove it. The agent hands over a hash, not a claim -- and it is held
    // to that standard even though it is the one being paid.
    const settled = await tools.outcome_settle({
      intentId,
      workTransactionHash: workTx,
    });

    reports.push({
      intentId,
      took: true,
      workTx,
      outcome: `${settled.action}:${settled.settled ? "succeeded" : "failed"}`,
      reason: settled.reason ?? "",
    });
  }

  return reports;
}
