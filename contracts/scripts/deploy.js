const { ethers } = require("hardhat");

/*
 * Reuses the existing Sepolia test token rather than deploying another. The
 * demo needs a funded payer more than it needs a fresh ERC-20, and this token
 * already has a public faucet.
 */
const TOKEN = process.env.POLARIS_USDC || "0x49C86277a91002c4943837bf20F6ED41976Db09F";

async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("deployer :", deployer.address);
  console.log("balance  :", ethers.formatEther(bal), "ETH");
  console.log("token    :", TOKEN);

  const Escrow = await ethers.getContractFactory("OutcomeEscrow");
  const escrow = await Escrow.deploy(TOKEN, deployer.address);
  await escrow.waitForDeployment();

  const addr = await escrow.getAddress();
  const tx = escrow.deploymentTransaction();
  console.log();
  console.log("OutcomeEscrow:", addr);
  console.log("tx           :", tx.hash);
  console.log("explorer     : https://sepolia.etherscan.io/tx/" + tx.hash);
}

main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exit(1);
});
