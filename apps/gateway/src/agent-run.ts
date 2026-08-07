/**
 * One full agent cycle, as data.
 *
 * A payer posts a job and escrows against it, then walks away. The agent finds
 * the intent, does the work through KeeperHub, hands the verifier a transaction
 * hash, and is paid only if the transfer is proven.
 *
 * The payer needs a wallet here because claiming escrow means moving the
 * payer's own tokens, and that is their signature to give. The agent does not:
 * it holds an address and nothing else, which is the point of the whole
 * exercise. An unattended process that must guard a private key needs somewhere
 * safe to keep it, and an unattended process does not have somewhere safe.
 */

import { Contract, Wallet, type JsonRpcProvider } from "ethers";
import { work, jobId, postJob, type KeeperHubClient } from "outcome-sdk/node";

const ESCROW = process.env.OUTCOME_ESCROW ?? "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B";
const TOKEN = process.env.POLARIS_USDC ?? "0x49C86277a91002c4943837bf20F6ED41976Db09F";
const BENEFICIARY = "0x000000000000000000000000000000000000dEaD";
const AMOUNT = 1_000_000n;
const REFUND_WINDOW = 3600;

/*
 * The job board lives on disk beside the process. Small and deliberate: an
 * intent commits to its task by hash without storing the string, so the agent
 * needs the preimage from somewhere, and a job it cannot describe is one it
 * cannot prove it did.
 */
const JOBS = process.env.OUTCOME_JOBS ?? "/tmp/outcome-jobs.jsonl";

const ESCROW_ABI = [
  "function claim(bytes32,address,address,uint256,uint64)",
  "function isClaimed(bytes32) view returns (bool)",
];
const ERC20 = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];

export type AgentCycle = {
  task: string;
  intentId: string;
  claimTransactionHash: string;
  agentAddress: string;
  reports: {
    intentId: string;
    took: boolean;
    workTx?: string;
    outcome?: string;
    reason: string;
  }[];
  /**
   * Older intents the agent looked at and declined this pass.
   *
   * Reported as a count rather than dropped, because declining is a real
   * behaviour worth knowing about -- the agent will not take money for work it
   * cannot describe -- but a demo that listed every stale intent from previous
   * runs would bury the one the visitor just created.
   */
  declinedOthers: number;
};

export async function runAgentCycle(opts: {
  provider: JsonRpcProvider;
  wallet: Wallet;
  kh: KeeperHubClient;
  chainId: number;
}): Promise<AgentCycle> {
  const { provider, wallet, kh, chainId } = opts;

  // The task string carries a timestamp so each run is a distinct intent. Two
  // runs of the same job would collide on the claim guard, which is correct
  // behaviour but makes for a confusing demo.
  const task = `deliver 1.00 tUSDC to treasury @ ${Date.now()}`;
  const intentId = jobId(task, wallet.address);

  const token = new Contract(TOKEN, ERC20, wallet);
  if ((await token.allowance(wallet.address, ESCROW)) < AMOUNT) {
    const approve = await token.approve(ESCROW, AMOUNT * 100n);
    await approve.wait();
  }

  const escrow = new Contract(ESCROW, ESCROW_ABI, wallet);
  const claim = await escrow.claim(intentId, wallet.address, BENEFICIARY, AMOUNT, REFUND_WINDOW);
  await claim.wait();

  postJob(JOBS, { intentId, task, deliverTo: BENEFICIARY });

  const reports = await work({
    provider,
    agentAddress: wallet.address,
    kh,
    escrow: ESCROW,
    token: TOKEN,
    chainId,
    jobsPath: JOBS,
    // Only this run's claim is interesting, and a wide lookback would make the
    // agent re-examine every intent it has ever settled.
    lookbackBlocks: 200,
  });

  const mine = reports.filter((r) => r.intentId.toLowerCase() === intentId.toLowerCase());

  return {
    task,
    intentId,
    claimTransactionHash: claim.hash,
    agentAddress: wallet.address,
    reports: mine,
    declinedOthers: reports.length - mine.length,
  };
}
