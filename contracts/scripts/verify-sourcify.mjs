/**
 * Verify deployed contracts on Sourcify, without an Etherscan key.
 *
 * `hardhat verify` wants ETHERSCAN_API_KEY, and its Sourcify path still speaks
 * the v1 API, which is in a scheduled brownout until 2027. A contract nobody
 * can read the source of is a contract nobody can check -- which, for a project
 * whose entire argument is "do not take that on trust", is not an acceptable
 * gap to leave open waiting on a key.
 *
 * So this posts the standard JSON input straight to Sourcify's v2 API. Etherscan
 * surfaces Sourcify matches, so the source shows up there too.
 *
 * The input comes from Hardhat's build-info, which is the exact compiler input
 * that produced the deployed bytecode. Picking the wrong build-info is the easy
 * mistake here and it fails loudly with a length mismatch rather than quietly
 * verifying the wrong source -- worth knowing, because an earlier build of this
 * escrow differs only by one struct field.
 *
 *   node scripts/verify-sourcify.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CHAIN_ID = 11155111;
const SERVER = "https://sourcify.dev/server";
const BUILD_INFO = "artifacts/build-info";

/**
 * Deployed addresses, newest deployment per contract.
 *
 * The escrow's denomination token, TestUSDC at 0x49C86277, is deliberately not
 * here: it was deployed by a different project and this repo's copy of the
 * source compiles to different bytecode. Listing it would produce a permanent
 * red line for something that is not this project's to verify.
 */
const TARGETS = [
  { name: "MandateEscrow", address: "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B" },
  { name: "USDCx", address: "0x0d864A625c280F7f9B9AD024d12F94f5D6DCCF13" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The most recent build-info containing this contract's source.
 *
 * Recency is the tiebreak because a contract that was redeployed after an edit
 * has several, and the newest is the one that matches what is on chain.
 */
function buildInfoFor(name) {
  const candidates = readdirSync(BUILD_INFO)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const parsed = JSON.parse(readFileSync(join(BUILD_INFO, f), "utf8"));
      return { file: f, parsed };
    })
    .filter(({ parsed }) => parsed.output?.contracts?.[`contracts/${name}.sol`]?.[name]);

  if (!candidates.length) throw new Error(`no build-info contains ${name}; run npx hardhat compile`);
  return candidates[candidates.length - 1];
}

async function verify({ name, address }) {
  const { parsed } = buildInfoFor(name);

  const submit = await fetch(`${SERVER}/v2/verify/${CHAIN_ID}/${address}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stdJsonInput: parsed.input,
      compilerVersion: parsed.solcLongVersion,
      contractIdentifier: `contracts/${name}.sol:${name}`,
    }),
  });

  const started = await submit.json();

  // Already verified is a success, not an error. Re-running this should be safe.
  if (!started.verificationId) {
    const already = JSON.stringify(started).includes("already");
    console.log(`  ${name.padEnd(14)} ${already ? "already verified" : `could not submit: ${JSON.stringify(started).slice(0, 120)}`}`);
    return already;
  }

  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    const job = await (await fetch(`${SERVER}/v2/verify/${started.verificationId}`)).json();
    if (!job.isJobCompleted) continue;

    const match = job.contract?.match;
    if (match) {
      console.log(`  ${name.padEnd(14)} ${match}  https://repo.sourcify.dev/${CHAIN_ID}/${address}`);
      return true;
    }
    console.log(`  ${name.padEnd(14)} FAILED: ${job.error?.customCode ?? job.error ?? "unknown"}`);
    return false;
  }

  console.log(`  ${name.padEnd(14)} timed out waiting for the job`);
  return false;
}

console.log(`verifying on Sourcify (chain ${CHAIN_ID})`);
let ok = true;
for (const t of TARGETS) ok = (await verify(t)) && ok;
process.exit(ok ? 0 : 1);
