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

import { JsonRpcProvider, Contract, Wallet, keccak256, toUtf8Bytes } from "ethers";
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { KeeperHubClient } from "./keeperhub/client.ts";
import { createTools } from "./tools.ts";

const ESCROW_ABI = [
  "event Claimed(bytes32 indexed intentId, address indexed payer, address indexed payee, address beneficiary, uint256 amount, uint64 refundableAt)",
  "function intents(bytes32) view returns (address payer,address payee,address beneficiary,uint256 amount,uint64 refundableAt,uint8 state)",
];
const ERC20 = ["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"];

/**
 * What a job actually asks for.
 *
 * The intent id is `keccak(task|payee)`, so an intent commits to its task
 * string without storing it. The agent keeps the preimages it knows about; a
 * job whose task it cannot reconstruct is one it cannot verify it did, so it
 * declines rather than guessing.
 */
export type Job = { intentId: string; task: string; deliverTo: string };

export function jobId(task: string, payee: string): string {
  return keccak256(toUtf8Bytes(`${task}|${payee.toLowerCase()}`));
}

export function loadJobs(path: string): Map<string, Job> {
  const m = new Map<string, Job>();
  if (!existsSync(path)) return m;
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

export function postJob(path: string, job: Job): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(job) + "\n");
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
  wallet: Wallet;
  kh: KeeperHubClient;
  escrow: string;
  token: string;
  chainId: number;
  jobsPath: string;
  lookbackBlocks?: number;
}): Promise<AgentReport[]> {
  const { provider, wallet, escrow, token, jobsPath } = opts;
  const tools = createTools({
    provider,
    kh: opts.kh,
    escrow,
    token,
    chainId: opts.chainId,
  });

  const c = new Contract(escrow, ESCROW_ABI, provider);
  const head = await provider.getBlockNumber();
  const from = Math.max(0, head - (opts.lookbackBlocks ?? 45_000));

  // Only intents naming this agent. Filtering by topic rather than pulling
  // everything keeps the agent from paying attention to work that is not its.
  const claims = await c.queryFilter(
    c.filters.Claimed(null, null, wallet.address),
    from,
    head
  );

  const jobs = loadJobs(jobsPath);
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

    const erc20 = new Contract(token, ERC20, wallet);
    const owed = BigInt(state.amount);

    if ((await erc20.balanceOf(wallet.address)) < owed) {
      reports.push({
        intentId,
        took: false,
        reason: "cannot fund the delivery; declining rather than failing mid-job",
      });
      continue;
    }

    // Do the work.
    const tx = await erc20.transfer(job.deliverTo, owed);
    await tx.wait();

    // Then prove it. The agent hands over a hash, not a claim.
    const settled = await tools.outcome_settle({
      intentId,
      workTransactionHash: tx.hash,
    });

    reports.push({
      intentId,
      took: true,
      workTx: tx.hash,
      outcome: `${settled.action}:${settled.settled ? "succeeded" : "failed"}`,
      reason: settled.reason ?? "",
    });
  }

  return reports;
}
