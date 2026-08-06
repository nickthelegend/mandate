/**
 * The agent, live. A payer posts a job and walks away; the agent does the rest.
 */
import { JsonRpcProvider, Wallet, Contract, parseUnits } from "ethers";
import { KeeperHubClient } from "./keeperhub/client.ts";
import { work, jobId, postJob } from "./agent.ts";

const CHAIN = 11155111;
const ESCROW = "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B";
const JOBS = ".outcome/jobs.jsonl";
const link = (h?: string) => (h ? `https://sepolia.etherscan.io/tx/${h}` : "(none)");

const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL!, CHAIN);
const agent = new Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);
const TOKEN = process.env.POLARIS_USDC!;

// --- a payer posts a job and escrows the fee, then stops paying attention ---
const AMOUNT = parseUnits("1", 6);
const BENEFICIARY = "0x000000000000000000000000000000000000dEaD";
const task = `deliver 1.00 tUSDC to treasury @ ${Date.now()}`;
const intentId = jobId(task, agent.address);

console.log("PAYER");
console.log("  task    :", task);
console.log("  intent  :", intentId.slice(0, 22) + "...");

const escrow = new Contract(ESCROW, ["function claim(bytes32,address,address,uint256,uint64)"], agent);
const c = await escrow.claim(intentId, agent.address, BENEFICIARY, AMOUNT, 3600);
await c.wait();
postJob(JOBS, { intentId, task, deliverTo: BENEFICIARY });
console.log("  escrowed:", link(c.hash));
console.log("  posted the job and walked away.\n");

// --- the agent wakes up and works, with nobody telling it what to do ---
console.log("AGENT");
const reports = await work({
  provider,
  wallet: agent,
  kh: new KeeperHubClient({ apiKey: process.env.KEEPERHUB_API_KEY! }),
  escrow: ESCROW,
  token: TOKEN,
  chainId: CHAIN,
  jobsPath: JOBS,
  lookbackBlocks: 400,
});

if (!reports.length) console.log("  found no open work.");
for (const r of reports) {
  console.log("  intent  :", r.intentId.slice(0, 22) + "...");
  console.log("  took    :", r.took);
  if (r.workTx) console.log("  work    :", link(r.workTx));
  if (r.outcome) console.log("  outcome :", r.outcome);
  console.log("  reason  :", r.reason.slice(0, 90));
}
