/**
 * Verify one of this authority's decision receipts, from scratch.
 *
 *   node scripts/verify-a-receipt.mjs [receiptId]
 *
 * Everything a sceptic needs and nothing they have to take on trust. It uses no
 * package of ours — not `mandate-receipts`, not `mandate-sdk` — because a
 * verifier that imports the code it is checking proves only that the code
 * agrees with itself. The merkle arithmetic is thirty lines below, the chain is
 * asked over a public RPC with no key, and the only thing fetched from us is
 * the proof itself, which is the thing under test.
 *
 * What it establishes, in order:
 *
 *   1. The authority hands over a leaf, a set of siblings, and a root.
 *   2. Recomputing the path from that leaf lands on that root — so the proof is
 *      internally consistent and the leaf really is in the tree.
 *   3. `MandateReceipts` on Sepolia holds that exact root under that batch id —
 *      so the tree was committed to on chain, at a block, by an address anyone
 *      can look up.
 *
 * If step 2 passes and step 3 fails, the authority is claiming an anchor it
 * does not have. Both are printed separately for exactly that reason.
 */

const GATEWAY = process.env.GATEWAY_URL ?? "https://gateway-production-944e.up.railway.app";
const RECEIPTS = "0x64AE971Fda589E4C878F66452b8CE0533032f60d";

/*
 * Several, tried in order. A free endpoint refusing says nothing about the
 * contract, and a verification that reports "inconclusive" because one host
 * was busy is not much of a verification.
 */
const RPCS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.drpc.org",
  "https://rpc.sepolia.org",
  "https://1rpc.io/sepolia",
];

// ── keccak256, so this depends on nothing ───────────────────────────────────
/*
 * A compact Keccak-f[1600]. Written out rather than imported because the whole
 * argument is that you do not need our code — or, for that matter, ethers — to
 * check what we published.
 */
const RC = [
  0x00000001n, 0x00008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn,
  0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an, 0x000000008000808bn,
  0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n,
  0x8000000000000080n, 0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const R = [
  [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56], [27, 20, 39, 8, 14],
];
const M = (1n << 64n) - 1n;
const rotl = (x, n) => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M;

function keccakF(A) {
  for (let round = 0; round < 24; round++) {
    const C = [0n, 0n, 0n, 0n, 0n];
    for (let x = 0; x < 5; x++) C[x] = A[x][0] ^ A[x][1] ^ A[x][2] ^ A[x][3] ^ A[x][4];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) A[x][y] ^= D;
    }
    const B = [[], [], [], [], []];
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y][(2 * x + 3 * y) % 5] = rotl(A[x][y], R[x][y]);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) A[x][y] = B[x][y] ^ (~B[(x + 1) % 5][y] & M & B[(x + 2) % 5][y]);
    A[0][0] ^= RC[round];
  }
  return A;
}

/** keccak256 over raw bytes, returning `0x…`. */
function keccak256(bytes) {
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes);
  padded[bytes.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  let A = Array.from({ length: 5 }, () => [0n, 0n, 0n, 0n, 0n]);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      A[i % 5][Math.floor(i / 5)] ^= lane;
    }
    A = keccakF(A);
  }
  let out = "";
  for (let i = 0; i < 4; i++) {
    let lane = A[i % 5][Math.floor(i / 5)];
    for (let b = 0; b < 8; b++) {
      out += Number(lane & 0xffn).toString(16).padStart(2, "0");
      lane >>= 8n;
    }
  }
  return `0x${out}`;
}

const bytes = (hex) => Uint8Array.from(hex.replace(/^0x/, "").match(/../g).map((h) => parseInt(h, 16)));
const cat = (...hs) => {
  const parts = hs.map(bytes);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};

/**
 * Walk the proof.
 *
 * Siblings are ordered by value, and every internal node is prefixed `0x01`.
 * The prefix is the part that matters: without domain separation an internal
 * node can be presented as a leaf, and a holder "proves" a receipt that was
 * never written.
 */
function rootFrom(leaf, proof) {
  let node = leaf;
  for (const sib of proof) {
    const [a, b] = node.toLowerCase() < sib.toLowerCase() ? [node, sib] : [sib, node];
    node = keccak256(cat("0x01", a, b));
  }
  return node;
}

async function rpc(method, params) {
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await r.json();
      if (j.result !== undefined) return j.result;
    } catch {
      /* next endpoint */
    }
  }
  throw new Error("no Sepolia RPC answered");
}

// ── run ─────────────────────────────────────────────────────────────────────
let id = process.argv[2];
if (!id) {
  const list = await fetch(`${GATEWAY}/authority/receipts?limit=60`).then((r) => r.json());
  id = list.entries.find((e) => e.status === "CONFIRMED")?.receiptId;
  if (!id) {
    console.error("no confirmed receipt yet — a batch anchors on four receipts or two minutes");
    process.exit(1);
  }
}

const p = await fetch(`${GATEWAY}/authority/receipt/${id}`).then((r) => r.json());
if (p.error) {
  console.error(p.error);
  process.exit(1);
}

console.log(`receipt   ${p.receiptId}`);
console.log(`leaf      ${p.leaf}`);
console.log(`siblings  ${p.proof.length}`);
console.log(`batch     ${p.batchId}`);

const recomputed = rootFrom(p.leaf, p.proof);
const consistent = recomputed.toLowerCase() === p.root.toLowerCase();
console.log(`\nrecomputed ${recomputed}`);
console.log(`claimed    ${p.root}`);
console.log(consistent ? "  the proof is internally consistent" : "  MISMATCH — the proof does not reach the claimed root");

// isAnchored(bytes32,bytes32) — the selector, derived here rather than pasted.
const selector = keccak256(new TextEncoder().encode("isAnchored(bytes32,bytes32)")).slice(0, 10);
const word = (h) => h.replace(/^0x/, "").padStart(64, "0");
const answer = await rpc("eth_call", [
  { to: RECEIPTS, data: `${selector}${word(p.batchId)}${word(p.root)}` },
  "latest",
]);
const anchored = BigInt(answer) === 1n;

console.log(`\nMandateReceipts ${RECEIPTS}`);
console.log(anchored ? "  the chain holds this exact root under this batch id" : "  the chain does NOT hold this root");

if (consistent && anchored) {
  console.log("\nVERIFIED — this decision was committed to on Sepolia, and nothing above came from our code.");
  process.exit(0);
}
console.log("\nNOT VERIFIED");
process.exit(1);
