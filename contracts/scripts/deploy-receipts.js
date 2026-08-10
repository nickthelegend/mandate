/**
 * Deploy MandateReceipts to Sepolia.
 *
 * Separate from PolicyRegistry on purpose: the registry gates the money and
 * this records what was decided, and an upgrade to the evidence trail should
 * not require touching the thing that gates spending.
 */
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("deployer:", deployer.address);
  console.log("balance :", hre.ethers.formatEther(bal), "ETH");

  const F = await hre.ethers.getContractFactory("MandateReceipts");
  const c = await F.deploy();
  console.log("tx sent :", c.deploymentTransaction().hash);
  await c.waitForDeployment();

  const addr = await c.getAddress();
  console.log("\nMANDATE_RECEIPTS=" + addr);
  console.log("explorer: https://sepolia.etherscan.io/address/" + addr);

  // Read it back, so the script proves the deployment rather than assuming it.
  const count = await c.batchCount();
  console.log("batchCount:", count.toString(), "(a fresh contract)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
