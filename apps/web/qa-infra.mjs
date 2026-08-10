/**
 * TESTPLAN sections 1, 2, 6 and 7 — everything under the browser.
 *
 * Contracts read from Sepolia, every gateway endpoint including the ones only
 * reachable with bad input, every external integration, and the repo hygiene
 * checks. `qa.mjs` and `qa-live.mjs` cover the pages and the flows; this covers
 * what they stand on.
 *
 *   node qa-infra.mjs
 */

import { JsonRpcProvider, Contract } from "ethers";
import { readFileSync, existsSync } from "node:fs";
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
    const note = await fn();
    record(id, true, note);
  } catch (e) {
    record(id, false, e.message.slice(0, 150));
  }
};
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const provider = new JsonRpcProvider(RPC, 11155111);
const POLICY_ID = env.POLICY_ID;

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

// ── 1. Contracts ────────────────────────────────────────────────────────────
console.log("\n1. CONTRACTS ON SEPOLIA");
const ADDR = {
  "1.1": ["PolicyRegistry", "0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304"],
  "1.2": ["OutcomeEscrow", "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B"],
  "1.3": ["USDCx", "0x0d864A625c280F7f9B9AD024d12F94f5D6DCCF13"],
  "1.4": ["tUSDC", "0x49C86277a91002c4943837bf20F6ED41976Db09F"],
};
for (const [id, [name, addr]] of Object.entries(ADDR)) {
  await item(id, async () => {
    const code = await provider.getCode(addr);
    must(code !== "0x", `${name} has no bytecode at ${addr}`);
    return `${name} deployed, ${(code.length - 2) / 2} bytes`;
  });
}

const REGISTRY_ABI = [
  "function getPolicy(uint256) view returns (tuple(address owner,uint64 expiry,uint32 version,address agent,uint8 status,bytes32 policyHash))",
  "function isUsable(uint256) view returns (bool)",
];
await item("1.5", async () => {
  const c = new Contract(ADDR["1.1"][1], REGISTRY_ABI, provider);
  const [p, usable] = await Promise.all([c.getPolicy(POLICY_ID), c.isUsable(POLICY_ID)]);
  must(Number(p.status) === 1, `status is ${p.status}, expected 1 (ACTIVE)`);
  must(usable === true, "registry does not report the policy usable");
  return `ACTIVE and usable, v${p.version}`;
});

await item("1.6", async () => {
  const { hashCanonicalJson } = await import(`${ROOT}packages/policy/dist/esm/canon/index.js`);
  const doc = JSON.parse(readFileSync(`${ROOT}apps/gateway/policy.json`, "utf8"));
  const local = hashCanonicalJson(doc.rules);
  const c = new Contract(ADDR["1.1"][1], REGISTRY_ABI, provider);
  const onChain = (await c.getPolicy(POLICY_ID)).policyHash;
  must(
    onChain.toLowerCase() === local.toLowerCase(),
    `registry holds ${onChain.slice(0, 12)}…, document hashes to ${local.slice(0, 12)}…`
  );
  return `document matches the anchor ${local.slice(0, 14)}…`;
});

await item("1.7", async () => {
  const c = new Contract(
    ADDR["1.2"][1],
    [
      "function intents(bytes32) view returns (address payer,address payee,address beneficiary,uint256 amount,uint64 refundableAt,uint8 state)",
      "function isClaimed(bytes32) view returns (bool)",
      "function escrowed() view returns (uint256)",
    ],
    provider
  );
  // A real claimed intent, from the /agent cycle. An unknown id is not a
  // useful probe: it proves the escrow rejects nonsense, not that it holds state.
  const REAL = "0x9818f89002a3e28c1ef3f08e2cd1ee16fb447848a118a6f85735ee82a41fd572";
  const [row, claimed, escrowed] = await Promise.all([
    c.intents(REAL),
    c.isClaimed(REAL),
    c.escrowed(),
  ]);
  must(claimed === true, "a known intent reads as unclaimed");
  must(row.amount > 0n, `intent amount is ${row.amount}`);
  must(escrowed >= 0n, "escrowed() did not return a balance");
  return `intents/isClaimed/escrowed all answer; ${row.amount} held on a real intent`;
});

const SITE_TX = {
  anchor: "0x17cc144a475c94e2243dd859166a90ab2fd2923728f876de5bc9dda7054a9ad2",
  spend: "0xd8bd2b6170811f38831ea6b118f142ecaebbf0b2389e137e2ac5e508062288b8",
  reanchor: "0xdd035281df43216c5873e6822d92f0092c963166adb9113261dfcfd1d235f4e8",
  pause: "0x384a73fe41aaad058d171984d17838b08a50ebab440bc40d3d4e47db436e1b9d",
  lying: "0x6db7218d717f5be3c3b37f386593bf0bdf3760b0407ac1145c617ac172136603",
  honest: "0x3aac3134ba7c4ce4e12c04e206ad7ce468318607fdb7a8e7ad85e91a70fe72ee",
};
await item("1.8", async () => {
  for (const [name, h] of Object.entries(SITE_TX)) {
    const r = await provider.getTransactionReceipt(h);
    must(r, `${name} ${h.slice(0, 12)}… is not a transaction`);
    must(r.status === 1, `${name} has status ${r.status}`);
  }
  return `${Object.keys(SITE_TX).length} displayed transactions all real, all status 1`;
});

await item("1.9", async () => {
  const r = await provider.getTransactionReceipt(SITE_TX.lying);
  const transfers = r.logs.filter((l) => l.topics[0] === TRANSFER);
  must(transfers.length === 0, `the "moved nothing" tx has ${transfers.length} Transfer logs`);
  must(r.logs.length > 0, "it should still have emitted a log — that is the point");
  return `status 1, ${r.logs.length} log, zero Transfers`;
});

await item("1.10", async () => {
  const r = await provider.getTransactionReceipt(SITE_TX.honest);
  const t = r.logs.filter((l) => l.topics[0] === TRANSFER);
  must(t.length === 1, `expected exactly 1 Transfer, found ${t.length}`);
  must(BigInt(t[0].data) === 1000000n, `moved ${BigInt(t[0].data)}, expected 1000000`);
  return "1 Transfer of exactly 1000000 base units";
});

// ── 2. Gateway endpoints ────────────────────────────────────────────────────
console.log("\n2. GATEWAY ENDPOINTS");
await item("2.1", async () => {
  const b = await jget("/health");
  must(b.ok === true, "health did not report ok");
  must(/^0x[0-9a-fA-F]{40}$/.test(b.facilitator), "no facilitator address");
  return `ok, facilitator ${b.facilitator.slice(0, 10)}…`;
});
await item("2.2", async () => {
  const b = await jget("/authority");
  must(b.onChain.status === "ACTIVE", `onChain.status is ${b.onChain.status}`);
  must(typeof b.vendorFloor === "number", "vendorFloor missing");
  must(typeof b.spentToday === "number" && typeof b.remaining === "number", "budget fields missing");
  return `ACTIVE, floor ${b.vendorFloor}, spent ${b.spentToday}`;
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
  const b = await jget("/authority/log?limit=5");
  must(Array.isArray(b.entries), "no entries array");
  if (b.entries.length > 1) {
    must(b.entries[0].at >= b.entries[1].at, "entries are not newest-first");
  }
  for (const e of b.entries) {
    must(e.decision, "an entry has no decision");
    must(Array.isArray(e.rules), "an entry has no rule trace");
  }
  return `${b.entries.length} entries, newest first, all with traces`;
});
await item("2.6", async () => {
  const b = await jget("/authority/escalations?limit=5");
  must(Array.isArray(b.entries), "no entries array");
  for (const e of b.entries) must(!e.approvalCodeHash, "an approval code hash leaked to the client");
  return `${b.entries.length} entries, no code hashes exposed`;
});
await item("2.7", async () => {
  const b = await jget("/authority/score/0x000000000000000000000000000000000000dEaD");
  must(b.lcb <= b.score, `lcb ${b.lcb} exceeds score ${b.score}`);
  must(b.features.length === 7, `${b.features.length} features, expected 7`);
  must(b.features.filter((f) => f.implemented).length === 4, "expected exactly 4 observed features");
  return `lcb ${b.lcb.toFixed(1)} ≤ score ${b.score.toFixed(1)}, band ${b.band}`;
});
await item("2.8", async () => {
  const b = await jget("/authority/score/junk", 400);
  must(/20-byte address/.test(b.error), b.error);
  return b.error;
});
await item("2.9", async () => {
  const b = await jget("/audit?limit=3");
  must(typeof b.total === "number" && b.total > 0, "no persisted audit entries");
  return `${b.total} persisted decisions`;
});
await item("2.10", async () => {
  const b = await jget("/execution/!!!", 400);
  must(/execution id/.test(b.error), b.error);
  return b.error;
});
/**
 * An executionId from anywhere in the record.
 *
 * `/authority/log` defaults to the shared agent, and every real decision is
 * partitioned per agent, so the default view is legitimately empty. Read the
 * collection directly to find one rather than asserting against a partition
 * nothing writes to.
 */
async function anyExecutionId() {
  const { MongoClient } = await import("mongodb");
  const c = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await c.connect();
  const row = await c
    .db(env.OUTCOME_AUDIT_DB ?? "outcome")
    .collection("authority_decisions")
    .findOne({ executionId: { $exists: true, $ne: null } }, { sort: { at: -1 } });
  await c.close();
  return row?.executionId ?? null;
}

await item("2.11", async () => {
  const withExec = { executionId: await anyExecutionId() };
  must(withExec.executionId, "no decision on record carries an executionId to look up");
  const b = await jget(`/execution/${withExec.executionId}`);
  must(b.status, "KeeperHub returned no status");
  return `${withExec.executionId} → ${b.status}`;
});
await item("2.12", async () => {
  const r = await fetch(`${G}/article`);
  must(r.status === 402, `expected 402, got ${r.status}`);
  const b = await r.json();
  must(Array.isArray(b.accepts) && b.accepts.length > 0, "no accepts[] in the challenge");
  const a = b.accepts[0];
  must(a.scheme === "exact" && a.asset && a.payTo, "challenge is not spec-shaped");
  return `402 with a ${a.scheme} challenge`;
});
await item("2.13", async () => {
  const r = await fetch(`${G}/authority/spend`);
  must(r.status === 405, `expected 405, got ${r.status}`);
  return "405 POST only";
});

const BAD = [
  ["2.14", "{oops", 400, /body must be JSON/],
  ["2.15", { amount: 0 }, 400, /positive number/],
  ["2.16", { amount: 1e30 }, 400, /implausible/],
  ["2.17", { amount: 0.1, recipient: "nope" }, 400, /20-byte address/],
  ["2.18", { amount: 0.1, endpoint: "javascript:alert(1)" }, 400, /http\(s\) URL/],
];
for (const [id, payload, status, re] of BAD) {
  await pace();
  await item(id, async () => {
    const b = await jpost("/authority/spend", payload, status);
    must(re.test(b.error), `unexpected message: ${b.error}`);
    return b.error.slice(0, 58);
  });
}

await pace();
await item("2.19", async () => {
  const b = await jpost("/authority/spend", { amount: 0.1, category: "<img src=x onerror=alert(1)>" }, 400);
  must(/category must be/.test(b.error), b.error);
  const log = await jget("/authority/log?limit=50");
  const dirty = log.entries.filter((e) => /[<>]/.test(e.category ?? ""));
  must(dirty.length === 0, `${dirty.length} entries with markup survive in the public log`);
  return "refused, and the log is clean";
});

await item("2.20", async () => {
  // Back to back, no pacing: both must be answered on their merits.
  const a = await fetch(`${G}/authority/spend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount: -1 }),
  });
  const b = await fetch(`${G}/authority/spend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount: -1 }),
  });
  must(a.status === 400 && b.status === 400, `got ${a.status} then ${b.status}; the throttle ran first`);
  return "both 400, never 429";
});

const RESOLVE = "/authority/escalation/esc_0000000000000000000/resolve";
await item("2.21", async () => {
  const b = await jpost(RESOLVE, { code: "short", operator: env.DEPLOYER_ADDRESS ?? "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67", action: "APPROVE" }, 400);
  must(/24 hex/.test(b.error), b.error);
  return b.error;
});
await item("2.22", async () => {
  const b = await jpost(RESOLVE, { code: "0".repeat(24), operator: "nope", action: "APPROVE" }, 400);
  must(/20-byte address/.test(b.error), b.error);
  return b.error;
});
await item("2.23", async () => {
  const b = await jpost(RESOLVE, { code: "0".repeat(24), operator: "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67", action: "MAYBE" }, 400);
  must(/APPROVE or DENY/.test(b.error), b.error);
  return b.error;
});
await item("2.24", async () => {
  const b = await jpost(RESOLVE, { code: "a".repeat(24), operator: "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67", action: "APPROVE" }, 200);
  must(b.outcome === "IGNORED_NOT_FOUND", `outcome was ${b.outcome}`);
  return b.outcome;
});

// ── 6. External integrations ────────────────────────────────────────────────
console.log("\n6. EXTERNAL INTEGRATIONS");
await item("6.1", async () => {
  const n = await provider.getBlockNumber();
  must(n > 0, "no block number");
  return `Sepolia at block ${n}`;
});
await item("6.2", async () => {
  const { MongoClient } = await import("mongodb");
  const c = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await c.connect();
  const db = c.db(env.OUTCOME_AUDIT_DB ?? "outcome");
  const counts = {};
  for (const n of ["authority_ledger", "authority_decisions", "authority_escalations"]) {
    counts[n] = await db.collection(n).countDocuments();
  }
  await c.close();
  must(counts.authority_decisions > 0, "the decision log is empty");
  must(counts.authority_ledger > 0, "no ledger partitions persisted");
  return `ledger ${counts.authority_ledger}, decisions ${counts.authority_decisions}, escalations ${counts.authority_escalations}`;
});
await item("6.3", async () => {
  const id = await anyExecutionId();
  must(id, "nothing to query");
  const b = await jget(`/execution/${id}`);
  must(b.status === "completed", `KeeperHub reports ${b.status}`);
  return `execute API returns ${b.status} for a real execution`;
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
  must(n > 30, `KeeperHub MCP exposed ${n} tools`);
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
  const r = await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_workflow_listing", arguments: { slug: "outcome-escrow-intent-status" } } });
  const d = JSON.parse(r.result.content[0].text);
  must(d.priceUsdcPerCall === "0.02", `listed at ${d.priceUsdcPerCall}, expected 0.02`);
  return `${d.listedSlug} live at $${d.priceUsdcPerCall}/call`;
});
await item("6.7", async () => {
  const out = execSync(
    `printf '%s\\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"qa","version":"1"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node --experimental-strip-types packages/mcp/src/cli.ts 2>/dev/null`,
    { cwd: ROOT, encoding: "utf8", timeout: 60000 }
  );
  const line = out.split("\n").find((l) => l.includes('"id":2'));
  const tools = JSON.parse(line).result.tools.map((t) => t.name);
  must(tools.length === 6, `${tools.length} tools, expected 6`);
  must(tools.includes("outcome_verify") && tools.includes("outcome_settle"), "expected tools missing");
  return `${tools.length} tools over stdio, no credential needed to list`;
});
await item("6.8", async () => {
  for (const p of ["outcome-sdk", "outcome-policy"]) {
    const r = await fetch(`https://registry.npmjs.org/${p}`);
    must(r.ok, `${p} is not published`);
    const d = await r.json();
    must(d["dist-tags"].latest, `${p} has no latest tag`);
  }
  const { mongoLedger, executeIfAuthorised } = await import(`${ROOT}packages/sdk/dist/esm/node.js`);
  must(typeof mongoLedger === "function" && typeof executeIfAuthorised === "function", "sdk exports missing");
  return "both published, exports resolve";
});
await item("6.9", async () => {
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
  const out = execSync("npm test 2>&1 || true", {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 900000,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, MONGODB_URI: env.MONGODB_URI },
  });
  const pass = [...out.matchAll(/pass (\d+)/g)].reduce((s, m) => s + Number(m[1]), 0);
  const fail = [...out.matchAll(/fail (\d+)/g)].reduce((s, m) => s + Number(m[1]), 0);
  must(fail === 0, `${fail} failing tests`);
  must(pass >= 185, `only ${pass} tests ran`);
  return `${pass} pass, ${fail} fail`;
});
await item("7.3", async () => {
  const out = execSync("npm run typecheck 2>&1 | grep -cE 'error TS' || true", { cwd: ROOT, encoding: "utf8", timeout: 600000 }).trim();
  must(out === "0", `${out} typecheck errors`);
  return "0 errors";
});
await item("7.4", async () => {
  const out = execSync("gh run list --limit 6 --json workflowName,conclusion -q '.[] | \"\\(.workflowName):\\(.conclusion)\"'", { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  const recent = out.trim().split("\n").slice(0, 2);
  must(recent.every((l) => l.endsWith(":success")), `CI: ${recent.join(", ")}`);
  return recent.join(", ");
});
await item("7.5", async () => {
  const out = execSync(
    `git grep -nEi "kh_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|mongodb\\+srv://[^ ]+:|npm_[A-Za-z0-9]{30,}" -- ':!*.md' || true`,
    { cwd: ROOT, encoding: "utf8" }
  ).trim();
  must(out === "", `secrets in tracked files: ${out.slice(0, 120)}`);
  return "no credentials in tracked files";
});

// ── summary ─────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log("\n" + "=".repeat(64));
console.log(`${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  ${f.id}  ${f.note}`);
}
process.exit(failed.length === 0 ? 0 : 1);
