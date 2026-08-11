/**
 * TESTPLAN sections 1, 2, 6 and 7 — everything under the browser.
 *
 * Contracts read from Sepolia, every gateway endpoint including the ones only
 * reachable with bad input, every external integration, and the repo hygiene
 * checks. `qa.mjs` covers the pages and `qa-live.mjs` the money flows; this
 * covers what they stand on.
 *
 * Item ids match TESTPLAN.md exactly, and every line printed here is one row of
 * that table. Where an item needs a real artefact — a confirmed receipt batch,
 * an approved spend, an execution id — it is discovered from the live record
 * rather than hardcoded, so the suite cannot pass on a hash that was true once.
 *
 *   node qa-infra.mjs
 */

import { JsonRpcProvider, Contract } from "ethers";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname: the repo lives under a path with a space, and
// .pathname keeps it percent-encoded so every fs call misses.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const G = process.env.GATEWAY_URL ?? "https://gateway-production-944e.up.railway.app";
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const env = Object.fromEntries(
  readFileSync(`${ROOT}.env`, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const results = [];
const record = (id, ok, note) => {
  results.push({ id, ok, note });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id.padEnd(6)} ${note}`);
};
const item = async (id, fn) => {
  try {
    record(id, true, await fn());
  } catch (e) {
    record(id, false, e.message.slice(0, 160));
  }
};
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const provider = new JsonRpcProvider(RPC, 11155111);
const POLICY_ID = env.POLICY_ID;
const DEPLOYER = env.DEPLOYER_ADDRESS;

const jget = async (path, expect = 200) => {
  const r = await fetch(`${G}${path}`);
  const body = await r.json().catch(() => ({}));
  must(r.status === expect, `${path} answered ${r.status}, expected ${expect}`);
  return body;
};
const jpost = async (path, payload, expect) => {
  const r = await fetch(`${G}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  const body = await r.json().catch(() => ({}));
  must(r.status === expect, `${path} answered ${r.status}, expected ${expect}: ${JSON.stringify(body).slice(0, 90)}`);
  return body;
};
/** The spend route is paced per client; space the deliberate-400 probes out. */
const pace = () => new Promise((r) => setTimeout(r, 1800));

/** One Mongo connection, reused. Several items need to look at the record. */
let _db = null;
async function db() {
  if (_db) return _db;
  const { MongoClient } = await import("mongodb");
  const c = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  await c.connect();
  _db = c.db(env.MANDATE_AUDIT_DB ?? "mandate");
  _db.__client = c;
  return _db;
}

// ── 1. Contracts ────────────────────────────────────────────────────────────
console.log("\n1. CONTRACTS ON SEPOLIA");
const ADDR = {
  registry: "0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304",
  receipts: env.MANDATE_RECEIPTS ?? "0x64AE971Fda589E4C878F66452b8CE0533032f60d",
  token: "0x49C86277a91002c4943837bf20F6ED41976Db09F",
};
for (const [id, key, name] of [
  ["1.1", "registry", "PolicyRegistry"],
  ["1.2", "receipts", "MandateReceipts"],
  ["1.3", "token", "tUSDC"],
]) {
  await item(id, async () => {
    const code = await provider.getCode(ADDR[key]);
    must(code !== "0x", `${name} has no bytecode at ${ADDR[key]}`);
    return `${name} ${ADDR[key].slice(0, 10)}… deployed, ${(code.length - 2) / 2} bytes`;
  });
}

const REGISTRY_ABI = [
  "function getPolicy(uint256) view returns (tuple(address owner,uint64 expiry,uint32 version,address agent,uint8 status,bytes32 policyHash))",
  "function isUsable(uint256) view returns (bool)",
];
await item("1.4", async () => {
  const c = new Contract(ADDR.registry, REGISTRY_ABI, provider);
  const [p, usable] = await Promise.all([c.getPolicy(POLICY_ID), c.isUsable(POLICY_ID)]);
  must(Number(p.status) === 1, `status is ${p.status}, expected 1 (ACTIVE)`);
  must(usable === true, "the registry does not report the policy usable");
  return `ACTIVE and usable, v${p.version}`;
});

await item("1.5", async () => {
  const { hashCanonicalJson } = await import(`${ROOT}packages/policy/dist/esm/canon/index.js`);
  const doc = JSON.parse(readFileSync(`${ROOT}apps/gateway/policy.json`, "utf8"));
  const local = hashCanonicalJson(doc.rules);
  const c = new Contract(ADDR.registry, REGISTRY_ABI, provider);
  const onChain = (await c.getPolicy(POLICY_ID)).policyHash;
  must(
    onChain.toLowerCase() === local.toLowerCase(),
    `registry holds ${onChain.slice(0, 12)}…, the document hashes to ${local.slice(0, 12)}…`
  );
  return `the document on disk matches the anchor ${local.slice(0, 14)}…`;
});

const RECEIPTS_ABI = [
  "function batchCount() view returns (uint256)",
  "function isAnchored(bytes32,bytes32) view returns (bool)",
  "function getAnchor(bytes32) view returns (tuple(bytes32 root,uint64 anchoredAt,address anchoredBy))",
];
await item("1.6", async () => {
  const c = new Contract(ADDR.receipts, RECEIPTS_ABI, provider);
  const n = await c.batchCount();
  must(n >= 1n, `batchCount is ${n}; nothing has ever been anchored`);
  return `${n} receipt batch(es) anchored on chain`;
});

/** The most recent CONFIRMED batch, which several items below need. */
const confirmedBatch = await (await db())
  .collection("authority_batches")
  .findOne({ status: "CONFIRMED" }, { sort: { createdAt: -1 } });

await item("1.7", async () => {
  must(confirmedBatch, "no batch has reached CONFIRMED, so there is no anchored root to check");
  const c = new Contract(ADDR.receipts, RECEIPTS_ABI, provider);
  const ok = await c.isAnchored(confirmedBatch.batchId, confirmedBatch.root);
  must(ok === true, `the chain does not hold ${confirmedBatch.root.slice(0, 12)}… under this batch id`);
  return `root ${confirmedBatch.root.slice(0, 14)}… is anchored, ${confirmedBatch.receiptIds.length} receipts under it`;
});

/**
 * Every transaction hash the site can currently show.
 *
 * Read from the record rather than a hardcoded list, so a hash that stopped
 * being displayed stops being checked and a new one starts.
 */
const shownTx = [
  ...(await (await db())
    .collection("authority_decisions")
    .find({ transactionHash: { $exists: true, $ne: null } })
    .sort({ at: -1 })
    .limit(8)
    .toArray()),
].map((d) => ({ what: d.decision, hash: d.transactionHash, amount: d.amount, recipient: d.recipient }));
if (confirmedBatch?.transactionHash) shownTx.push({ what: "anchor", hash: confirmedBatch.transactionHash });

await item("1.8", async () => {
  must(shownTx.length > 0, "the site has no transactions to show");
  for (const t of shownTx) {
    const r = await provider.getTransactionReceipt(t.hash);
    must(r, `${t.what} ${t.hash.slice(0, 12)}… is not a transaction`);
    must(r.status === 1, `${t.what} ${t.hash.slice(0, 12)}… has status ${r.status}`);
  }
  return `${shownTx.length} displayed transactions, all real, all status 1`;
});

await item("1.9", async () => {
  const spend = shownTx.find((t) => t.what === "APPROVED" && t.amount);
  must(spend, "no approved spend on record to check");
  const r = await provider.getTransactionReceipt(spend.hash);
  const transfers = r.logs.filter((l) => l.topics[0] === TRANSFER);
  must(transfers.length === 1, `expected exactly 1 ERC-20 Transfer, found ${transfers.length}`);
  const moved = BigInt(transfers[0].data);
  const expected = BigInt(Math.round(spend.amount * 1e6));
  must(moved === expected, `moved ${moved} base units, the decision recorded ${expected}`);
  const to = "0x" + transfers[0].topics[2].slice(26);
  must(to.toLowerCase() === spend.recipient.toLowerCase(), `paid ${to}, decision named ${spend.recipient}`);
  return `$${spend.amount} → ${to.slice(0, 10)}…, exactly ${moved} base units`;
});

await item("1.10", async () => {
  must(confirmedBatch?.transactionHash, "no anchor transaction to check");
  const r = await provider.getTransactionReceipt(confirmedBatch.transactionHash);
  must(
    r.from.toLowerCase() !== DEPLOYER.toLowerCase(),
    `the anchor was sent by the deployer ${DEPLOYER}, not by KeeperHub`
  );
  return `anchored by ${r.from.slice(0, 12)}… via ${r.to.slice(0, 12)}…, not the deployer`;
});

// ── 2. Gateway endpoints ────────────────────────────────────────────────────
console.log("\n2. GATEWAY ENDPOINTS");
await item("2.1", async () => {
  const b = await jget("/health");
  must(b.ok === true, "health did not report ok");
  must(b.policyId === POLICY_ID, `health serves policy ${b.policyId}, .env names ${POLICY_ID}`);
  must(b.keeperhub === true, "the gateway has no KeeperHub credential");
  /*
   * It must say what it can reach, not just that it is configured. A health
   * check whose body is identical whether Mongo answers or not is decoration.
   */
  must(Array.isArray(b.checks) && b.checks.length >= 4, "health reports no dependency checks");
  const down = b.checks.filter((c) => !c.up);
  must(down.length === 0, `unreachable: ${down.map((c) => `${c.name} (${c.detail})`).join(", ")}`);
  must(b.status === "UP", `aggregate status is ${b.status}`);
  return `${b.status} — ${b.checks.map((c) => `${c.name} ${c.ms}ms`).join(", ")}`;
});
await item("2.2", async () => {
  const b = await jget("/authority");
  must(b.onChain.status === "ACTIVE", `onChain.status is ${b.onChain.status}`);
  must(typeof b.vendorFloor === "number", "vendorFloor missing");
  must(typeof b.spentToday === "number" && typeof b.remaining === "number", "budget fields missing");
  must(b.totals && typeof b.totals.total === "number", "no system-wide totals");
  must(b.totals.total > 0, "the authority claims to have decided nothing");
  return `ACTIVE, floor ${b.vendorFloor}, ${b.totals.total} decisions (${b.totals.refused} refused, ${b.totals.escalated} held)`;
});
const PROBE_AGENT = `qa${Date.now().toString(36)}`;
await item("2.3", async () => {
  const b = await jget(`/authority?agent=${PROBE_AGENT}`);
  must(b.agent === PROBE_AGENT, `agent echoed as ${b.agent}`);
  must(b.spentToday === 0, `a brand new agent already shows ${b.spentToday} spent`);
  return `own partition, $${b.remaining} available`;
});
await item("2.4", async () => {
  const b = await jget("/authority?agent=!!", 400);
  must(/agent/i.test(b.error), `unexpected message: ${b.error}`);
  return b.error.slice(0, 50);
});
await item("2.5", async () => {
  const b = await jget("/authority/log?limit=5&agent=agent-ppqt8er7");
  must(Array.isArray(b.entries), "no entries array");
  must(b.entries.length > 0, "the log is empty for an agent that has decisions on record");
  if (b.entries.length > 1) must(b.entries[0].at >= b.entries[1].at, "entries are not newest-first");
  for (const e of b.entries) {
    must(e.decision, "an entry has no decision");
    must(Array.isArray(e.rules) && e.rules.length > 0, "an entry has no rule trace");
  }
  return `${b.entries.length} entries, newest first, all with traces`;
});
await item("2.6", async () => {
  const b = await jget("/authority/score/0x000000000000000000000000000000000000dEaD");
  must(b.lcb <= b.score, `lcb ${b.lcb} exceeds score ${b.score}`);
  must(b.features.length === 7, `${b.features.length} features, expected 7`);
  must(b.features.filter((f) => f.implemented).length === 4, "expected exactly 4 observed features");
  return `lcb ${b.lcb.toFixed(1)} ≤ score ${b.score.toFixed(1)}, band ${b.band}`;
});
await item("2.7", async () => {
  const b = await jget("/authority/score/junk", 400);
  must(/20-byte address/.test(b.error), b.error);
  return b.error;
});
await item("2.8", async () => {
  const b = await jget("/authority/escalations?limit=5");
  must(Array.isArray(b.entries), "no entries array");
  for (const e of b.entries) must(!e.approvalCodeHash, "an approval code hash leaked to the client");
  return `${b.entries.length} entries, no code hashes exposed`;
});
const LADDER = ["QUEUED", "BATCHED", "SUBMITTED", "CONFIRMED", "DEGRADED_UNANCHORED"];
let anchoredReceiptId = null;
await item("2.9", async () => {
  /*
   * A wide page, not the newest ten. Every run of this suite enqueues fresh
   * receipts, so the top of the list is whatever just arrived — asking for ten
   * and looking for a CONFIRMED one finds none and reports the ladder as
   * broken when it is working perfectly.
   */
  const b = await jget("/authority/receipts?limit=100");
  must(Array.isArray(b.entries) && b.entries.length > 0, "no receipts on record");
  must(b.moved && typeof b.moved.batched === "number", "the tick did not report what it moved");
  for (const e of b.entries) must(LADDER.includes(e.status), `receipt status ${e.status} is not on the ladder`);
  anchoredReceiptId = b.entries.find((e) => e.status === "CONFIRMED")?.receiptId ?? null;
  const seen = [...new Set(b.entries.map((e) => e.status))].join(", ");
  return `${b.entries.length} receipts (${seen}); tick moved ${JSON.stringify(b.moved)}`;
});
await item("2.10", async () => {
  must(anchoredReceiptId, "no CONFIRMED receipt to ask for a proof of");
  const p = await jget(`/authority/receipt/${anchoredReceiptId}`);
  must(Array.isArray(p.proof), "no merkle proof in the response");
  must(p.anchored === true, `a CONFIRMED receipt reports anchored=${p.anchored}`);
  must(p.status === "CONFIRMED", `status ${p.status}`);
  return `proof of ${p.proof.length} sibling(s) against root ${p.root.slice(0, 12)}…`;
});
await item("2.11", async () => {
  const b = await jget("/authority/receipt/junk", 400);
  must(/receipt id/.test(b.error), b.error);
  return b.error;
});

/** An executionId from anywhere in the record — decisions are per-agent. */
const execId = (
  await (await db())
    .collection("authority_decisions")
    .findOne({ executionId: { $exists: true, $ne: null } }, { sort: { at: -1 } })
)?.executionId;

await item("2.12", async () => {
  must(execId, "no decision on record carries an executionId to look up");
  const b = await jget(`/execution/${execId}`);
  must(b.status, "KeeperHub returned no status");
  return `${execId} → ${b.status}`;
});
await item("2.13", async () => {
  const b = await jget("/execution/!!!", 400);
  must(/execution id/.test(b.error), b.error);
  return b.error;
});
await item("2.14", async () => {
  const r = await fetch(`${G}/authority/spend`);
  must(r.status === 405, `expected 405, got ${r.status}`);
  return "405 POST only";
});

const BAD = [
  ["2.15", "{oops", /body must be JSON/],
  ["2.16", { amount: 0 }, /positive number/],
  ["2.17", { amount: 1e30 }, /implausible/],
  ["2.18", { amount: 0.1, recipient: "nope" }, /20-byte address/],
  ["2.19", { amount: 0.1, endpoint: "javascript:alert(1)" }, /http\(s\) URL/],
];
for (const [id, payload, re] of BAD) {
  await pace();
  await item(id, async () => {
    const b = await jpost("/authority/spend", payload, 400);
    must(re.test(b.error), `unexpected message: ${b.error}`);
    return b.error.slice(0, 58);
  });
}

await pace();
await item("2.20", async () => {
  const b = await jpost("/authority/spend", { amount: 0.1, category: "<img src=x onerror=alert(1)>" }, 400);
  must(/category must be/.test(b.error), b.error);
  const log = await jget("/authority/log?limit=50");
  const dirty = log.entries.filter((e) => /[<>]/.test(e.category ?? ""));
  must(dirty.length === 0, `${dirty.length} entries with markup survive in the public log`);
  return "refused, and nothing reached the log";
});

await item("2.21", async () => {
  // Back to back, no pacing: both must be answered on their merits.
  const send = () =>
    fetch(`${G}/authority/spend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: -1 }),
    });
  const [a, b] = [await send(), await send()];
  must(a.status === 400 && b.status === 400, `got ${a.status} then ${b.status}; the throttle ran first`);
  return "both 400, never 429";
});

const RESOLVE = "/authority/escalation/esc_0000000000000000000/resolve";
await item("2.22", async () => {
  const b = await jpost(RESOLVE, { code: "short", operator: DEPLOYER, action: "APPROVE" }, 400);
  must(/24 hex/.test(b.error), b.error);
  return b.error;
});
await item("2.23", async () => {
  const b = await jpost(RESOLVE, { code: "0".repeat(24), operator: "nope", action: "APPROVE" }, 400);
  must(/20-byte address/.test(b.error), b.error);
  return b.error;
});
await item("2.24", async () => {
  const b = await jpost(RESOLVE, { code: "0".repeat(24), operator: DEPLOYER, action: "MAYBE" }, 400);
  must(/APPROVE or DENY/.test(b.error), b.error);
  return b.error;
});
await item("2.25", async () => {
  const b = await jpost(RESOLVE, { code: "a".repeat(24), operator: DEPLOYER, action: "APPROVE" }, 200);
  must(b.mandate === "IGNORED_NOT_FOUND", `mandate was ${b.mandate}`);
  return b.mandate;
});
await item("2.26", async () => {
  const b = await jget("/not-a-route", 404);
  must(/no route \/not-a-route/.test(b.error), b.error);
  return b.error;
});
await item("2.27", async () => {
  for (const gone of ["/demo", "/agent", "/article", "/audit", "/verify", "/settle"]) {
    const r = await fetch(`${G}${gone}`);
    must(r.status === 404, `${gone} still answers ${r.status}`);
  }
  return "demo, agent, article, audit, verify, settle all 404";
});

await item("2.28", async () => {
  const b = await jget("/health");
  const names = (b.checks ?? []).map((c) => c.name).sort();
  must(
    JSON.stringify(names) === JSON.stringify(["keeperhub", "mongo", "policy-anchor", "sepolia"]),
    `checks are ${names.join(", ")}`
  );
  for (const c of b.checks) {
    must(typeof c.up === "boolean" && typeof c.ms === "number", `${c.name} reports no verdict or timing`);
    must(c.detail, `${c.name} says nothing about what it found`);
  }
  must(b.status === "UP", `aggregate is ${b.status}`);
  /*
   * The gateway's database must be the one this suite reads directly.
   *
   * They drifted: a local .env said `outcome`, the project's former name, while
   * production said `mandate`. Every direct-database assertion below was
   * reading a stale copy with a third of the rows and none of the notification
   * deliveries — passing, against the wrong system. Nothing else in the suite
   * could have caught that, because both databases exist and both answer.
   */
  const local = env.MANDATE_AUDIT_DB ?? "mandate";
  must(b.database === local, `the gateway uses "${b.database}", this suite reads "${local}"`);
  return `${b.checks.map((c) => `${c.name} ${c.up ? "up" : "DOWN"}`).join(", ")}, db "${b.database}"`;
});

const HOOK_MARK = `qa-${Date.now().toString(36)}`;
await item("2.29", async () => {
  const b = await jpost("/hook/operator", { kind: "held-spend", escalationId: HOOK_MARK }, 200);
  must(b.received === true && /^dlv_/.test(b.id ?? ""), `unexpected: ${JSON.stringify(b).slice(0, 80)}`);
  // It must be readable back — a hook that 200s and discards the body is not a
  // delivery record, which is the only reason this endpoint exists.
  const list = await jget("/authority/deliveries?limit=25");
  const mine = list.entries.find((e) => e.body?.escalationId === HOOK_MARK);
  must(mine, "the delivery was accepted and is not in the record");
  return `${b.id}, readable back`;
});
await item("2.30", async () => {
  const b = await jpost("/hook/operator", "{nope", 400);
  must(/body must be JSON/.test(b.error), b.error);
  return b.error;
});
await item("2.31", async () => {
  const r = await fetch(`${G}/hook/operator`);
  must(r.status === 405, `expected 405, got ${r.status}`);
  return "405 POST only";
});
await item("2.32", async () => {
  const b = await jget("/authority/deliveries?limit=3");
  must(/^https?:\/\//.test(b.destination ?? ""), `destination is ${b.destination}`);
  must(Array.isArray(b.entries), "no entries array");
  return `notices go to ${b.destination}`;
});

await item("2.33", async () => {
  const b = await jget("/authority/costs");
  must(typeof b.direct === "number" && b.direct > 0, `no direct executions counted (${b.direct})`);
  must(BigInt(b.gasUnits) > 0n, "KeeperHub reports zero gas across every execution");
  must(b.gasReportedBy > 0, "no run reported a gas figure");
  /*
   * Units, never a currency. KeeperHub returns gasCostWei and gasUsedWei with
   * identical values, so neither is a price — an ETH figure here would be a gas
   * price this code invented, which is exactly the shape of claim the product
   * refuses to make.
   */
  must(b.gasEth === undefined, "an ETH cost is being reported from a units field");
  must(b.succeeded + b.failed === b.direct, "the counts do not add up");
  must(/analytics\/runs$/.test(b.source ?? ""), `source is ${b.source}`);
  // Twice in a row must be identical: the route caches, and a cache that does
  // not cache means every page load is a burst against a third party.
  const again = await jget("/authority/costs");
  must(again.gasUnits === b.gasUnits, "the cache is not caching");
  return `${b.direct} direct, ${Number(b.gasUnits).toLocaleString()} gas units, median ${b.medianMs}ms, ${b.failed} failed`;
});

/*
 * The read-only chain proxy. It exists as the fallback for the proof check on
 * /ledger, because two public RPCs changed their CORS policy in a single day
 * and a verification that dies with somebody else's endpoint is not one.
 */
await item("2.34", async () => {
  must(confirmedBatch, "no CONFIRMED batch to check");
  const b = await jget(`/chain/is-anchored?batchId=${confirmedBatch.batchId}&root=${confirmedBatch.root}`);
  must(b.anchored === true, `anchored is ${b.anchored} for a root the chain holds`);
  must(b.via === "gateway", `via is ${b.via}`);
  return `anchored true, via ${b.via}`;
});
await item("2.35", async () => {
  const b = await jget("/chain/is-anchored?batchId=nope&root=nope", 400);
  must(/32 bytes of hex/.test(b.error), b.error);
  return b.error;
});
await item("2.36", async () => {
  /*
   * A root the chain does not hold is a legitimate question with a legitimate
   * answer. Erroring on it would make "not anchored" indistinguishable from
   * "the check broke", which is the one distinction this endpoint exists for.
   */
  must(confirmedBatch, "no CONFIRMED batch to check");
  const wrong = `0x${"ab".repeat(32)}`;
  const b = await jget(`/chain/is-anchored?batchId=${confirmedBatch.batchId}&root=${wrong}`);
  must(b.anchored === false, `a root the chain does not hold answered ${b.anchored}`);
  return "answered false, not an error";
});
await item("2.37", async () => {
  const b = await jget("/health");
  const local = env.MANDATE_AUDIT_DB ?? "mandate";
  must(b.database, "health does not name its database");
  must(b.database === local, `the gateway uses "${b.database}", this suite reads "${local}"`);
  return `both on "${b.database}"`;
});

// ── 6. External integrations ────────────────────────────────────────────────
console.log("\n6. EXTERNAL INTEGRATIONS");
await item("6.1", async () => {
  const n = await provider.getBlockNumber();
  must(n > 0, "no block number");
  const r = await provider.getTransactionReceipt(shownTx[0].hash);
  must(r?.blockNumber > 0, "a receipt read came back empty");
  return `Sepolia at block ${n}, receipts readable`;
});
await item("6.2", async () => {
  const d = await db();
  const counts = {};
  for (const n of ["authority_ledger", "authority_decisions", "authority_escalations", "authority_receipts", "authority_batches"]) {
    counts[n] = await d.collection(n).countDocuments();
  }
  must(counts.authority_decisions > 0, "the decision log is empty");
  must(counts.authority_ledger > 0, "no ledger partitions persisted");
  must(counts.authority_receipts > 0, "no receipts persisted");
  return `ledger ${counts.authority_ledger}, decisions ${counts.authority_decisions}, escalations ${counts.authority_escalations}, receipts ${counts.authority_receipts} in ${counts.authority_batches} batch(es)`;
});
await item("6.3", async () => {
  must(execId, "nothing to query");
  const b = await jget(`/execution/${execId}`);
  must(b.status === "completed", `KeeperHub reports ${b.status}`);
  return `the execute API returns ${b.status} for a real execution`;
});

const khRpc = async () => {
  let sid = null;
  const call = async (body) => {
    const h = {
      Authorization: `Bearer ${env.KEEPERHUB_API_KEY}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (sid) h["mcp-session-id"] = sid;
    const r = await fetch("https://app.keeperhub.com/mcp", { method: "POST", headers: h, body: JSON.stringify(body) });
    if (r.headers.get("mcp-session-id")) sid = r.headers.get("mcp-session-id");
    const t = await r.text();
    const line = t.split("\n").find((l) => l.startsWith("data: ")) ?? t;
    try {
      return JSON.parse(line.replace(/^data: /, ""));
    } catch {
      return {};
    }
  };
  await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "qa", version: "1" } } });
  await call({ jsonrpc: "2.0", method: "notifications/initialized" });
  return call;
};

await item("6.4", async () => {
  const call = await khRpc();
  const list = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const n = list?.result?.tools?.length ?? 0;
  must(n >= 40, `KeeperHub MCP exposed ${n} tools`);
  return `${n} tools over MCP`;
});
await item("6.5", async () => {
  const { discover } = await import(`${ROOT}packages/sdk/dist/esm/marketplace.js`);
  const l = await discover({ apiKey: env.KEEPERHUB_API_KEY });
  const paid = l.filter((x) => Number(x.priceUsdcPerCall ?? 0) > 0);
  must(l.length > 0 && paid.length > 0, `${l.length} listings, ${paid.length} paid`);
  return `${l.length} listings, ${paid.length} paid`;
});
await item("6.6", async () => {
  const call = await khRpc();
  const listing = JSON.parse(
    (
      await call({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "get_workflow_listing", arguments: { slug: "mandate-policy-status" } },
      })
    ).result.content[0].text
  );
  must(listing.priceUsdcPerCall === "0.02", `listed at ${listing.priceUsdcPerCall}, expected 0.02`);
  must(!/escrow/i.test(JSON.stringify(listing)), "the listing still advertises the removed escrow");

  /*
   * And it must actually answer. A priced listing whose workflow errors is
   * worse than no listing — the buyer has paid before they find out. Paying is
   * out of scope here (Base mainnet USDC), so the challenge is checked for
   * shape and the workflow is run directly as its owner.
   */
  const challenge = (
    await call({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "call_workflow", arguments: { slug: "mandate-policy-status", inputs: { policyId: POLICY_ID } } },
    })
  ).result.content[0].text;
  /*
   * The 402 arrives as a prose line, the JSON challenge, then more prose about
   * how to pay. Take the object and stop, rather than parsing to end of string.
   */
  const quoted = JSON.parse(challenge.slice(challenge.indexOf("{")).split("\n")[0]);
  must(quoted.x402Version === 2, `challenge is x402 v${quoted.x402Version}`);
  const a = quoted.accepts?.[0];
  must(a?.scheme === "exact" && a.amount === "20000" && /^0x[0-9a-fA-F]{40}$/.test(a.payTo), "the challenge is not spec-shaped");

  const probe = JSON.parse(
    (
      await call({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "execute_workflow", arguments: { workflowId: listing.id ?? "ucsufidzsjt9hvq6igpdn", input: { policyId: POLICY_ID } } },
      })
    ).result.content[0].text
  );
  await new Promise((r) => setTimeout(r, 12000));
  const run = JSON.parse(
    (
      await call({
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "get_execution", arguments: { executionId: probe.executionId } },
      })
    ).result.content[0].text
  );
  const err = run.progress?.errorContext?.error ?? run.logs?.execution?.error ?? null;
  must(!err, `the listed workflow errors: ${String(err).slice(0, 80)}`);
  return `${listing.listedSlug} at $${listing.priceUsdcPerCall}/call, x402 v2 challenge, workflow runs green`;
});
await item("6.7", async () => {
  const out = execSync(
    `printf '%s\\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"qa","version":"1"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node --experimental-strip-types packages/mcp/src/cli.ts 2>/dev/null`,
    { cwd: ROOT, encoding: "utf8", timeout: 60000 }
  );
  const line = out.split("\n").find((l) => l.includes('"id":2'));
  const tools = JSON.parse(line).result.tools.map((t) => t.name).sort();
  const expected = [
    "mandate_budget",
    "mandate_can_spend",
    "mandate_decisions",
    "mandate_escalations",
    "mandate_policy",
    "mandate_score",
    "mandate_spend",
  ];
  must(
    JSON.stringify(tools) === JSON.stringify(expected),
    `tools are ${tools.join(",")}, expected ${expected.join(",")}`
  );
  return `${tools.length} tools over stdio, no credential needed to list`;
});
await item("6.8", async () => {
  const out = execSync(
    `printf '%s\\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"qa","version":"1"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"mandate_can_spend","arguments":{"amount":5000,"agent":"qa-mcp","endpoint":"https://api.example.com/v1/probe"}}}' | node --experimental-strip-types packages/mcp/src/cli.ts 2>/dev/null`,
    { cwd: ROOT, encoding: "utf8", timeout: 120000, env: { ...process.env, MANDATE_AUTHORITY_URL: G } }
  );
  /*
   * The tools answer in prose, because a model has only the prose to go on.
   * So this asserts on the sentence: the verdict, the rule, the numbers it
   * compared, and no transaction — a preflight that reported one would be
   * reporting a payment it must not have made.
   */
  const line = out.split("\n").find((l) => l.includes('"id":2'));
  const said = JSON.parse(line).result.content[0].text;
  must(/BLOCKED_PER_CALL_CAP/.test(said), `the tool answered: ${said.slice(0, 90)}`);
  must(/`perCall\.cap`/.test(said), "the refusal did not name the rule");
  must(/of 15 rules/.test(said) && /never consulted/.test(said), "no short-circuit reported");
  must(/Observed 5000/.test(said), "the refusal did not say what it compared");
  must(!/0x[0-9a-f]{64}/i.test(said), "a preflight reported a transaction");
  return said.slice(0, 74);
});
await item("6.9", async () => {
  const state = {};
  for (const p of ["mandate-sdk", "mandate-policy", "mandate-mcp"]) {
    const r = await fetch(`https://registry.npmjs.org/${p}`);
    state[p] = r.ok ? (await r.json())["dist-tags"]?.latest : null;
  }
  const missing = Object.entries(state).filter(([, v]) => !v).map(([k]) => k);
  const { mongoLedger, executeIfAuthorised } = await import(`${ROOT}packages/sdk/dist/esm/node.js`);
  must(typeof mongoLedger === "function" && typeof executeIfAuthorised === "function", "sdk exports missing");
  must(missing.length === 0, `not published: ${missing.join(", ")} — the site tells a reader to install them`);
  return Object.entries(state).map(([k, v]) => `${k}@${v}`).join(", ");
});
await item("6.10", async () => {
  const { bindingFor, bindingMismatches } = await import(`${ROOT}packages/sdk/dist/esm/x402-guard.js`);
  const expected = { slug: "s", amount: "20000", asset: "0xA", payTo: "0xB", baseUrl: "https://x" };
  const honest = { amount: "20000", asset: "0xA", payTo: "0xB" };
  must(bindingMismatches(bindingFor(expected, honest)).length === 0, "an honest challenge did not bind");
  const swapped = bindingMismatches(bindingFor(expected, { ...honest, payTo: "0xC" }));
  must(swapped.length === 1 && swapped[0].field === "recipient", "a swapped payee was not caught");
  const priced = bindingMismatches(bindingFor(expected, { ...honest, amount: "999" }));
  must(priced.some((m) => m.field === "amount"), "a raised price was not caught");
  return "honest binds; swapped payee and raised price both caught";
});

await item("6.11", async () => {
  /*
   * The SDK's claim, executed. `examples/authority.mjs` imports only published
   * packages, so if it runs the packages compose — and if it did not, the SDK
   * would be a private detail of one gateway wearing a public name.
   *
   * Run for a refusal only. The approval path moves real tUSDC and is covered
   * by section 3; what is under test here is that the five steps assemble at
   * all from npm.
   */
  const out = execSync(`set -a; . ./.env; set +a; cd examples && node authority.mjs 5000 market-data 2>&1`, {
    cwd: ROOT,
    encoding: "utf8",
    shell: "/bin/zsh",
    timeout: 180000,
  });
  // \s+ because the example pads its labels into a column.
  must(/policy\s+v\d+ ACTIVE/.test(out), `the example could not read the anchor: ${out.slice(0, 120)}`);
  must(/BLOCKED_PER_CALL_CAP at perCall\.cap/.test(out), `unexpected verdict: ${out.slice(-120)}`);
  must(/nothing moved/.test(out), "a refusal did not say it moved nothing");
  return "composes from npm: reads the anchor, refuses at the cap, records it";
});

// ── 7. Hygiene ──────────────────────────────────────────────────────────────
console.log("\n7. REPOSITORY HYGIENE");
await item("7.1", async () => {
  const out = execSync(
    `grep -rniE "\\b(TODO|FIXME|XXX|HACK|dummy|not implemented|coming soon)\\b|\\bmock[a-z]*\\b|\\bstub[a-z]*\\b" --include="*.ts" --include="*.tsx" --include="*.sol" apps packages 2>/dev/null | grep -v "/dist/" | grep -v "/.next/" | grep -v "test/" | grep -v "\\.test\\." || true`,
    { cwd: ROOT, encoding: "utf8" }
  ).trim();
  const lines = out ? out.split("\n") : [];
  // Comments describing a past bug, and the empty STUBBED_RULES export kept for
  // callers that still import the name, are not stubs.
  const real = lines.filter(
    (l) =>
      !/STUBBED_RULES|No RULE_EVAL stubs remain|no provider to mock|not in a mock|used to compare a hardcoded|fake success|rather than returning a fake/.test(l)
  );
  must(real.length === 0, `${real.length} genuine hits: ${real[0]?.slice(0, 110)}`);
  return `${lines.length} matches, all comments about past bugs or the empty STUBBED_RULES const`;
});
await item("7.2", async () => {
  /*
   * The previous product is gone; its vocabulary must be too.
   *
   * Scoped to what would actually mislead a reader: the deleted contracts, and
   * links or fetches to routes that no longer exist. "facilitator" on its own
   * is not on the list — it is x402's own word for a real role in a protocol
   * this still implements, and banning it would mean renaming a spec field.
   */
  const out = execSync(
    `grep -rniE "\\bescrow|USDCx|[\\"'\\\`/](demo|agent|article|audit|claim|verify|explorer|settle)/" --include="*.ts" --include="*.tsx" --include="*.sol" --include="*.json" --include="*.md" apps packages contracts/contracts 2>/dev/null | grep -v "/dist/" | grep -v "/.next/" | grep -v "/out/" || true`,
    { cwd: ROOT, encoding: "utf8" }
  ).trim();
  const lines = out ? out.split("\n") : [];
  const live = lines.filter(
    (l) =>
      // A comment recording what was removed is the opposite of a leftover.
      !/^\S+:\d+:\s*(\*|\/\/|\/\*)/.test(l) &&
      // Nor is prose that says, in as many words, that it is describing the past.
      !/\b(was|were) removed|used to be|no longer exists?|none of which exist|previous version/i.test(l) &&
      // The marketplace listing slug is a name registered with KeeperHub, not a
      // code path; it is checked for real by 6.6.
      !/escrow-intent-status/.test(l)
  );
  must(live.length === 0, `${live.length} live references: ${live[0]?.slice(0, 110)}`);
  return `${lines.length} matches, none of them live code`;
});
await item("7.3", async () => {
  const out = execSync("npm test 2>&1; npm run test:contracts 2>&1 || true", {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 900000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, MONGODB_URI: env.MONGODB_URI },
  });
  /*
   * node:test's summary lines start with a multi-byte `ℹ`, and there is one
   * block per workspace. Anchoring on the word rather than the glyph avoids the
   * encoding trap; summing across blocks avoids reading only the last package.
   */
  const sum = (word) => [...out.matchAll(new RegExp(`^\\S* ?${word} (\\d+)$`, "gm"))].reduce((s, m) => s + Number(m[1]), 0);
  const pass = sum("pass");
  const fail = sum("fail");
  // Hardhat prints its own summary, so the contract tests are counted apart.
  const contracts = Number(out.match(/(\d+) passing/)?.[1] ?? 0);
  const contractsFailed = Number(out.match(/(\d+) failing/)?.[1] ?? 0);
  must(fail === 0 && contractsFailed === 0, `${fail + contractsFailed} failing tests`);
  must(pass >= 180, `only ${pass} unit tests ran`);
  must(contracts >= 25, `only ${contracts} contract tests ran`);
  return `${pass} unit + ${contracts} contract = ${pass + contracts} pass, 0 fail`;
});
await item("7.4", async () => {
  const out = execSync("npm run typecheck 2>&1 | grep -cE 'error TS' || true", { cwd: ROOT, encoding: "utf8", timeout: 600000 }).trim();
  must(out === "0", `${out} typecheck errors`);
  return "0 errors";
});
await item("7.5", async () => {
  /*
   * Wait for the head commit's runs rather than reading whatever is newest.
   * An in-progress run has a null conclusion, and treating that as a failure
   * makes this item fail purely because the check ran too soon after a push.
   */
  const head = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  const deadline = Date.now() + 600000;
  for (;;) {
    const out = execSync(
      `gh run list --commit ${head} --json workflowName,status,conclusion -q '.[] | "\\(.workflowName):\\(.status):\\(.conclusion)"'`,
      { cwd: ROOT, encoding: "utf8", timeout: 120000 }
    ).trim();
    const runs = out ? out.split("\n") : [];
    const done = runs.length >= 2 && runs.every((r) => r.includes(":completed:"));
    if (done) {
      const bad = runs.filter((r) => !r.endsWith(":success"));
      must(bad.length === 0, `CI: ${bad.join(", ")}`);
      return runs.map((r) => `${r.split(":")[0]}:success`).join(", ");
    }
    must(Date.now() < deadline, `CI still running after 10 minutes: ${runs.join(", ") || "no runs yet"}`);
    await new Promise((r) => setTimeout(r, 15000));
  }
});
await item("7.6", async () => {
  const out = execSync(
    `git grep -nEi "kh_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|mongodb\\+srv://[^ ]+:|npm_[A-Za-z0-9]{30,}" -- ':!*.md' || true`,
    { cwd: ROOT, encoding: "utf8" }
  ).trim();
  must(out === "", `secrets in tracked files: ${out.slice(0, 120)}`);
  return "no credentials in tracked files";
});

// ── summary ─────────────────────────────────────────────────────────────────
await (await db()).__client.close();
const failed = results.filter((r) => !r.ok);
console.log("\n" + "=".repeat(64));
console.log(`${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  ${f.id}  ${f.note}`);
}
process.exit(failed.length === 0 ? 0 : 1);
