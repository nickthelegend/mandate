/**
 * Take the verifier role away from the admin.
 *
 * The constructor grants it to the deployer so the escrow is usable before any
 * verifier exists. Leaving it there afterwards is a hole in the only claim this
 * project makes: that payment follows evidence rather than authority. An admin
 * who can call release() directly can pay anyone for nothing, and no amount of
 * receipt-reading elsewhere changes that.
 *
 * After this, KeeperHub's executing address is the only address that can move
 * escrowed funds, and that is checkable on chain by anyone.
 *
 * Reversible: admin can re-grant. Admin cannot, however, release while revoked.
 */
const { ethers } = require("hardhat");

const ESCROW = "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B";
const KEEPERHUB = "0x7a4FdD120a17e5390D87565e74a3Fbf80dF05FC1";

async function main() {
  const [admin] = await ethers.getSigners();
  const escrow = await ethers.getContractAt("OutcomeEscrow", ESCROW);

  console.log("before:");
  console.log("  admin     ", admin.address, await escrow.isVerifier(admin.address));
  console.log("  keeperhub ", KEEPERHUB, await escrow.isVerifier(KEEPERHUB));

  if (!(await escrow.isVerifier(KEEPERHUB))) {
    throw new Error("refusing to revoke: KeeperHub is not a verifier, this would strand every open intent");
  }

  const tx = await escrow.setVerifier(admin.address, false);
  await tx.wait();
  console.log("\nrevoked:", tx.hash);

  console.log("\nafter:");
  console.log("  admin     ", admin.address, await escrow.isVerifier(admin.address));
  console.log("  keeperhub ", KEEPERHUB, await escrow.isVerifier(KEEPERHUB));
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
