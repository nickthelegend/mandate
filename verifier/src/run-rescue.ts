/**
 * The rescue loop, live.
 *
 * A job is claimed and the work fails for a real, reproducible reason. The
 * service diagnoses it, decides whether a retry can fix it, retries, verifies
 * the retry from its receipt, and only then takes payment.
 *
 * The failure is manufactured honestly: a transfer larger than the payer holds.
 * It reverts on chain for a reason the classifier has to read, not a flag.
 */
import { JsonRpcProvider, Contract, Wallet, keccak256, toUtf8Bytes, parseUnits } from "ethers";
import { KeeperHubClient } from "../vendor-kh/client.ts";
import { verifyTransfer } from "./verify.ts";
import { diagnose, worthRescuing } from "./diagnose.ts";
import { settle } from "./settle.ts";

const ESCROW = "0x8Cd5537d9A8E55294f4939e8DBB939828BdAc89A";
const CHAIN = 11155111;
const link = (h?: string) => (h ? `https://sepolia.etherscan.io/tx/${h}` : "(none)");

const ESCROW_ABI = [
  "function claim(bytes32,address,uint256,uint64)",
  "function intents(bytes32) view returns (address payer,address payee,uint256 amount,uint64 refundableAt,uint8 state)",
];
const ERC20 = [
  "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];
const STATE = ["None", "Open", "Released", "Refunded"];

async function main() {
  const provider = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL!, CHAIN);
  const worker = Wallet.createRandom().connect(provider);
  const payer = new Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);
  const TOKEN = process.env.POLARIS_USDC!;
  const escrow = new Contract(ESCROW, ESCROW_ABI, payer);
  const kh = new KeeperHubClient({ apiKey: process.env.KEEPERHUB_API_KEY! });

  const AMOUNT = parseUnits("1", 6);
  const payee = "0x000000000000000000000000000000000000dEaD";
  const intentId = keccak256(toUtf8Bytes(`rescue:${Date.now()}`));

  console.log("intent :", intentId);
  const c = await escrow.claim(intentId, payee, AMOUNT, 3600);
  await c.wait();
  console.log("claim  :", link(c.hash), "\n");

  // ---- attempt 1: fails for a real reason ----
  console.log("--- attempt 1 ---");
  const token = new Contract(TOKEN, ERC20, payer);
  const held = await token.balanceOf(payer.address);
  let firstReason = "";
  try {
    // Deliberately more than exists. Reverts on chain, not in a mock.
    await token.transfer.staticCall(payee, held + parseUnits("1000000", 6));
    console.log("unexpectedly succeeded");
  } catch (e: any) {
    firstReason = e.shortMessage || e.message;
    console.log("failed :", firstReason.slice(0, 80));
  }

  const d = diagnose({ reason: firstReason });
  console.log("cause  :", d.cause, "| retryable:", d.retryable);
  console.log("fix    :", d.correction);
  console.log("rescue?:", worthRescuing(d) ? "take the job" : "decline -- a resend cannot fix this");

  // The classifier declines this one, which is correct: an over-balance
  // transfer is not fixable by resending. The rescue is to correct the call.
  console.log("\n--- attempt 2: corrected ---");
  const t = await token.transfer(payee, AMOUNT);
  await t.wait();
  console.log("work   :", link(t.hash));

  const receipt = await provider.send("eth_getTransactionReceipt", [t.hash]);
  const verdict = verifyTransfer(receipt, { token: TOKEN, recipient: payee, minAmount: AMOUNT });
  console.log("verdict:", verdict.proven ? "PROVEN" : "NOT PROVEN", "--", verdict.reason);

  const res = await settle(kh, { escrow: ESCROW, chainId: CHAIN, intentId, verdict });
  console.log("settle :", res.action, res.outcome);
  if (res.transactionHash) console.log("       :", link(res.transactionHash));

  const i = await escrow.intents(intentId);
  console.log("state  :", STATE[Number(i.state)]);
  console.log("\npaid only after the retry was proven, not after the attempt.");
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
