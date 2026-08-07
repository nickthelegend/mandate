const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("deployer:", deployer.address);
  console.log("balance :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  const Token = await ethers.getContractFactory("USDCx");
  const token = await Token.deploy();
  await token.waitForDeployment();
  const addr = await token.getAddress();

  console.log("USDCx   :", addr);
  console.log("tx      :", token.deploymentTransaction().hash);

  // Fund the payer so the x402 demo has something to spend.
  const mint = await token.mint(deployer.address, ethers.parseUnits("10000", 6));
  await mint.wait();
  console.log("minted  :", ethers.formatUnits(await token.balanceOf(deployer.address), 6), "USDCx");
  console.log("domain  :", await token.DOMAIN_SEPARATOR());
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
