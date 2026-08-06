const { ethers } = require("hardhat");
const ESCROW = "0x8Cd5537d9A8E55294f4939e8DBB939828BdAc89A";
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
