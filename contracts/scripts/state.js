const { ethers } = require("hardhat");
const E = "0x8Cd5537d9A8E55294f4939e8DBB939828BdAc89A";
async function main() {
  const p = ethers.provider;
  const c = await ethers.getContractAt("OutcomeEscrow", E);
  const head = await p.getBlockNumber();
  const from = head - 45000;
  const [claimed, rel, ref] = await Promise.all([
    c.queryFilter(c.filters.Claimed(), from, head),
    c.queryFilter(c.filters.Released(), from, head),
    c.queryFilter(c.filters.Refunded(), from, head),
  ]);
  console.log("block    :", head);
  console.log("escrowed :", ethers.formatUnits(await c.escrowed(), 6));
  console.log("claims   :", claimed.length);
  console.log("releases :", rel.length);
  console.log("refunds  :", ref.length);
}
main().catch(e => { console.error(e.shortMessage || e.message); process.exit(1); });
