/**
 * The whole loop, end to end, against live Sepolia.
 *
 *   claim -> do the work -> verify from the receipt -> settle through KeeperHub
 *
 * Runs it twice: once where the work really happened, and once where it did not.
 * The second case is the point -- a settlement rail that only demonstrates
 * success has not demonstrated anything.
 */
import { JsonRpcProvider, Contract, Wallet, keccak256, toUtf8Bytes, parseUnits } from "ethers";
import { verifyTransfer } from "outcome-sdk";
import { KeeperHubClient, settle } from "outcome-sdk/node";

const RPC = process.env.SEPOLIA_RPC_URL!;
const ESCROW = "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B";
const TOKEN = process.env.POLARIS_USDC!;
const CHAIN = 11155111;
const link = (h?: string) => (h ? `https://sepolia.etherscan.io/tx/${h}` : "(none)");

const ESCROW_ABI = [
  "function claim(bytes32,address,address,uint256,uint64)",
  "function intents(bytes32) view returns (address payer,address payee,address beneficiary,uint256 amount,uint64 refundableAt,uint8 state)",
];
const ERC20 = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
];
const STATE = ["None", "Open", "Released", "Refunded"];

async function main() {
  const provider = new JsonRpcProvider(RPC, CHAIN);
  const wallet = new Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);
  const escrow = new Contract(ESCROW, ESCROW_ABI, wallet);
  const token = new Contract(TOKEN, ERC20, wallet);
  const kh = new KeeperHubClient({ apiKey: process.env.KEEPERHUB_API_KEY! });

  const AMOUNT = parseUnits("2", 6);
  const payee = "0x000000000000000000000000000000000000dEaD";

  if ((await token.allowance(wallet.address, ESCROW)) < AMOUNT * 4n) {
    await (await token.approve(ESCROW, AMOUNT * 40n)).wait();
  }

  for (const scenario of ["work-done", "work-not-done"] as const) {
    const stamp = Date.now();
    const intentId = keccak256(toUtf8Bytes(`${scenario}:${stamp}`));
    console.log(`\n${"=".repeat(60)}\n${scenario}\n${"=".repeat(60)}`);
    console.log("intent :", intentId);

    const c = await escrow.claim(intentId, payee, payee, AMOUNT, 3600);
    await c.wait();
    console.log("claim  :", link(c.hash));

    // The "work": in the happy case a real transfer to the payee; in the other,
    // a transaction that mines and moves nothing to them.
    let workHash: string;
    if (scenario === "work-done") {
      const t = await token.transfer(payee, AMOUNT);
      await t.wait();
      workHash = t.hash;
    } else {
      // Approve emits an Approval, never a Transfer. Mines with status 0x1 and
      // moves nothing -- exactly the shape that fools a status-only check.
      const t = await token.approve(ESCROW, AMOUNT * 40n);
      await t.wait();
      workHash = t.hash;
    }
    console.log("work   :", link(workHash));

    const receipt = await provider.send("eth_getTransactionReceipt", [workHash]);
    const verdict = verifyTransfer(receipt, {
      token: TOKEN,
      recipient: payee,
      minAmount: AMOUNT,
    });
    console.log("status :", receipt.status, "| logs:", receipt.logs.length);
    console.log("verdict:", verdict.proven ? "PROVEN" : "NOT PROVEN", "--", verdict.reason);

    const res = await settle(kh, { escrow: ESCROW, chainId: CHAIN, intentId, verdict });
    console.log("settle :", res.action, res.outcome, res.error ? `(${res.error.kind}: ${res.error.message})` : "");
    if (res.transactionHash) console.log("       :", link(res.transactionHash));

    const i = await escrow.intents(intentId);
    console.log("state  :", STATE[Number(i.state)]);
  }
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
