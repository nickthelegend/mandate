const { ethers } = require("hardhat");

const ESCROW = "0x8Cd5537d9A8E55294f4939e8DBB939828BdAc89A";
const TOKEN = "0x49C86277a91002c4943837bf20F6ED41976Db09F";
const link = (h) => "https://sepolia.etherscan.io/tx/" + h;

async function main() {
  const [me] = await ethers.getSigners();
  const escrow = await ethers.getContractAt("OutcomeEscrow", ESCROW);
  const token = await ethers.getContractAt("TestUSDC", TOKEN);

  const AMOUNT = 5_000_000n; // 5 tUSDC
  const intentId = ethers.keccak256(
    ethers.toUtf8Bytes("job:summarise-block-11427313|payee:" + me.address)
  );
  console.log("intentId:", intentId);

  if ((await token.allowance(me.address, ESCROW)) < AMOUNT * 3n) {
    const a = await token.approve(ESCROW, AMOUNT * 20n);
    await a.wait();
    console.log("approve :", link(a.hash));
  }

  console.log("\n--- 1. claim (money into escrow, payee unpaid) ---");
  const escrowBefore = await token.balanceOf(ESCROW);
  const c = await escrow.claim(intentId, me.address, AMOUNT, 3600);
  const cr = await c.wait();
  const escrowAfter = await token.balanceOf(ESCROW);
  console.log("tx      :", link(c.hash));
  console.log("escrow delta:", (escrowAfter - escrowBefore).toString(), "base units");

  console.log("\n--- 2. duplicate claim must revert ---");
  try {
    await escrow.claim.staticCall(intentId, me.address, AMOUNT, 3600);
    console.log("NOT REVERTED - idempotency guard failed");
  } catch (e) {
    console.log("reverted:", (e.shortMessage || e.message).slice(0, 90));
  }

  console.log("\n--- 3. verify, then release ---");
  // The proof is a commitment to the evidence: the claim receipt plus the
  // balance delta actually observed on chain. A verifier that cannot show a
  // delta has nothing to attest.
  const proof = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "uint256"],
      [cr.hash, cr.blockNumber, escrowAfter - escrowBefore]
    )
  );
  const payeeBefore = await token.balanceOf(me.address);
  const r = await escrow.release(intentId, proof);
  await r.wait();
  const payeeAfter = await token.balanceOf(me.address);
  console.log("tx      :", link(r.hash));
  console.log("proof   :", proof);
  console.log("payee delta:", (payeeAfter - payeeBefore).toString(), "base units");

  console.log("\n--- state ---");
  const i = await escrow.intents(intentId);
  console.log("state   :", ["None", "Open", "Released", "Refunded"][Number(i.state)]);
  console.log("escrowed:", (await escrow.escrowed()).toString());
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
