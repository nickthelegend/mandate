const { ethers } = require("hardhat");
const E = "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B";
async function main() {
  const [me] = await ethers.getSigners();
  const t = await ethers.getContractAt("TestUSDC", process.env.POLARIS_USDC);
  const tx = await t.approve(E, ethers.parseUnits("5000", 6));
  await tx.wait();
  console.log("approved:", tx.hash);
  console.log("allowance:", ethers.formatUnits(await t.allowance(me.address, E), 6));
}
main().catch(e => { console.error(e.shortMessage || e.message); process.exit(1); });
