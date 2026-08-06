const { ethers } = require("hardhat");
const ESCROW = "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B";
// The address KeeperHub actually executes from. Discovered the honest way: the
// contract refused its verdict with NotVerifier and named it in the revert.
const KH_EXECUTOR = "0x7a4FdD120a17e5390D87565e74a3Fbf80dF05FC1";

async function main() {
  const e = await ethers.getContractAt("OutcomeEscrow", ESCROW);
  if (await e.isVerifier(KH_EXECUTOR)) return console.log("already a verifier");
  const tx = await e.setVerifier(KH_EXECUTOR, true);
  await tx.wait();
  console.log("granted:", tx.hash);
  console.log("isVerifier:", await e.isVerifier(KH_EXECUTOR));
}
main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
