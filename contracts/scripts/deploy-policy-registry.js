/**
 * Deploy PolicyRegistry to Sepolia.
 *
 * The registry is where a spend policy stops being a config file and becomes a
 * fact: the policy hash and its expiry are written on chain, so a decision can
 * cite the exact policy version it was judged under and anyone can check that
 * version was live at that moment.
 */
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("deployer:", deployer.address);
  console.log("balance :", hre.ethers.formatEther(bal), "ETH");

  const F = await hre.ethers.getContractFactory("PolicyRegistry");
  const c = await F.deploy();
  console.log("tx sent :", c.deploymentTransaction().hash);
  await c.waitForDeployment();

  const addr = await c.getAddress();
  console.log("deployed:", addr);
  console.log("explorer: https://sepolia.etherscan.io/address/" + addr);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
