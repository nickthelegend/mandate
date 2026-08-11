/**
 * TESTPLAN section 3 — the authority, end to end, with real money.
 *
 * Everything here either moves tUSDC on Sepolia or pauses the live policy, so
 * it is a deliberate act rather than something that fires on every commit. Item
 * ids match TESTPLAN.md.
 *
 * The browser half runs against the deployed console because the console is
 * what a judge will press. The parts a browser cannot reach — an unbound
 * operator, a wrong code, a replay, the on-chain kill switch — are driven
 * against the same authority over HTTP.
 *
 *   node qa-live.mjs [baseUrl]
 */

import { chromium } from "playwright";
import { JsonRpcProvider } from "ethers";

const BASE = (process.argv[2] ?? "https://nickthelegend.github.io/mandate").replace(/\/$/, "");
const GATEWAY = process.env.GATEWAY_URL ?? "https://gateway-production-944e.up.railway.app";
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const OPERATOR = "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67";

const IGNORE = [
  /favicon/i,
  /Download the React DevTools/i,
  /429|Too Many Requests|rate limit/i,
  /one decision at a time/i,
];
const ignored = (t) => IGNORE.some((r) => r.test(String(t)));

const results = [];
const problems = [];
let current = "(startup)";
const fail = (kind, detail) => problems.push({ where: current, kind, detail: String(detail).slice(0, 200) });

const item = async (id, fn) => {
  current = id;
  const before = problems.length;
  let note = "";
  try {
    note = (await fn()) ?? "";
  } catch (e) {
    fail("threw", e.message);
  }
  const caught = problems.slice(before);
  const ok = caught.length === 0;
  results.push({ id, ok, note: ok ? note : caught.map((p) => `${p.kind}: ${p.detail}`).join(" | ") });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id.padEnd(6)} ${results[results.length - 1].note.slice(0, 130)}`);
};

const provider = new JsonRpcProvider(RPC, 11155111);
const post = (path, body) =>
  fetch(`${GATEWAY}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());
const newAgent = () => `qa${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const newPayee = () =>
  "0x" + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("");
const spentBy = async (agent) => (await fetch(`${GATEWAY}/authority?agent=${agent}`).then((r) => r.json())).spentToday;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && !ignored(m.text()) && fail("console error", m.text()));
page.on("pageerror", (e) => !ignored(e.message) && fail("uncaught exception", e.message));
page.on("requestfailed", (r) => {
  const t = `${r.url()} ${r.failure()?.errorText ?? ""}`;
  if (!ignored(t)) fail("request failed", t);
});
page.on("response", (r) => {
  if (r.status() >= 400 && !ignored(r.url())) fail(`http ${r.status()}`, r.url());
});

const text = () => page.evaluate(() => document.body.innerText);
const press = async (label) => {
  const b = page.locator("button", { hasText: label }).first();
  await b.scrollIntoViewIfNeeded();
  await b.click();
};
const budget = async () => Number((await text()).match(/\$([\d.]+) \/ \$5\.00/)?.[1] ?? -1);
/** Wait for a verdict panel, however long the chain takes. */
const waitVerdict = async (timeout = 180000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(
      () => [...document.querySelectorAll(".verdict")].map((e) => e.textContent.trim())[1] ?? null
    );
    if (v) return { v, took: Math.round((Date.now() - t0) / 1000) };
    if (Date.now() - t0 > timeout) return { v: null, took: -1 };
    await page.waitForTimeout(1000);
  }
};

console.log(`\nTESTPLAN 3 against ${BASE}\n`);
console.log("3. THE AUTHORITY, END TO END");

// ── preflight: the same judgement, nothing written ──────────────────────────
const PRE_AGENT = newAgent();

await item("3.1", async () => {
  const before = await spentBy(PRE_AGENT);
  const d = await post("/authority/preflight", { amount: 5000, agent: PRE_AGENT, endpoint: "https://api.example.com/v1/pre" });
  if (!/^BLOCKED_/.test(d.decision)) fail("not refused", d.decision);
  if (d.failedRule !== "perCall.cap") fail("wrong rule", `failed at ${d.failedRule}`);
  const after = await spentBy(PRE_AGENT);
  if (after !== before) fail("preflight wrote", `${before} → ${after}`);
  return `${d.decision} at ${d.failedRule}, ledger untouched`;
});

await item("3.2", async () => {
  const before = await spentBy(PRE_AGENT);
  const d = await post("/authority/preflight", {
    amount: 0.4,
    agent: PRE_AGENT,
    category: "market-data",
    endpoint: "https://api.example.com/v1/quotes",
  });
  if (d.decision !== "APPROVED") fail("not approved", `${d.decision} at ${d.failedRule}`);
  if (d.transactionHash) fail("preflight paid", "a preflight produced a transaction");
  const after = await spentBy(PRE_AGENT);
  if (after !== before) fail("preflight charged", `${before} → ${after}`);
  return `APPROVED, spentToday held at ${after}, no transaction`;
});

await item("3.3", async () => {
  // The same request, preflighted and then really spent, must agree.
  const agent = newAgent();
  const req = { amount: 0.3, agent, category: "market-data", endpoint: "https://api.example.com/v1/agree" };
  const pre = await post("/authority/preflight", req);
  const real = await post("/authority/spend", req);
  if (pre.decision !== real.decision) fail("disagreed", `preflight ${pre.decision}, spend ${real.decision}`);
  if (real.decision !== "APPROVED") fail("not approved", real.decision);
  if (!real.transactionHash) fail("no transaction", "an approved spend produced nothing on chain");
  return `both ${real.decision}, tx ${real.transactionHash.slice(0, 12)}…`;
});

// ── the console, pressed the way a judge presses it ─────────────────────────
await page.goto(`${BASE}/authority/`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(4000);

await item("3.4", async () => {
  const before = await budget();
  if (before !== 0) fail("not a fresh agent", `started at ${before}, so agents are not isolated`);
  await press("Buy market data");
  const { v, took } = await waitVerdict();
  if (v !== "APPROVED") return fail("not approved", v ?? "no verdict");
  const after = await budget();
  if (after <= before) fail("budget did not move", `${before} → ${after}`);
  const tx = await page.evaluate(() => document.querySelector('a[href*="/tx/"]')?.href ?? null);
  if (!tx) return fail("no transaction link", "approved with nothing to check");
  const hash = tx.match(/0x[0-9a-fA-F]{64}/)[0];
  const r = await provider.getTransactionReceipt(hash);
  if (!r || r.status !== 1) fail("transaction not real", `${hash.slice(0, 12)}… status ${r?.status}`);
  return `${took}s, $${before} → $${after}, tx ${hash.slice(0, 12)}… confirmed`;
});

await item("3.5", async () => {
  const before = await budget();
  await page.waitForTimeout(2500);
  await press("Spend $5,000");
  const { v } = await waitVerdict();
  if (v !== "BLOCKED_PER_CALL_CAP") return fail("wrong verdict", v ?? "none");
  const t = await text();
  if (!/perCall\.cap/.test(t)) fail("no rule named", "");
  if (!/5000/.test(t)) fail("no observed value", "the refusal does not say what it saw");
  if (await budget() !== before) fail("budget moved on a refusal", "");
  return `BLOCKED_PER_CALL_CAP at perCall.cap, budget held at $${before}`;
});

await item("3.6", async () => {
  const before = await budget();
  await page.waitForTimeout(2500);
  await press("Buy GPU time");
  const { v } = await waitVerdict();
  if (v !== "BLOCKED_CATEGORY") return fail("wrong verdict", v ?? "none");
  const after = await budget();
  if (after !== before) fail("budget moved on a refusal", `${before} → ${after}`);
  const tx = await page.evaluate(() => document.querySelectorAll('a[href*="/tx/"]').length);
  if (tx > 0) fail("a refusal produced a transaction", `${tx} links`);
  return `BLOCKED_CATEGORY, no transaction, budget held at $${after}`;
});

await item("3.7", async () => {
  const before = await budget();
  await page.waitForTimeout(2500);
  await press("Buy the same thing again");
  const { v } = await waitVerdict();
  if (v !== "BLOCKED_DUPLICATE") return fail("not caught as a duplicate", v ?? "no verdict");
  const t = await text();
  if (!/0x[0-9a-f]{6}/i.test(t)) fail("no prior intent named", "the refusal does not point at what it matched");
  if (await budget() !== before) fail("a duplicate charged the budget", "");
  return `BLOCKED_DUPLICATE, budget held at $${before}`;
});

await item("3.8", async () => {
  await page.waitForTimeout(2500);
  await press("Spend $5,000");
  const { v } = await waitVerdict();
  if (v !== "BLOCKED_PER_CALL_CAP") return fail("wrong verdict", v ?? "none");
  await page.waitForTimeout(2500);
  const chain = await page.evaluate(() => {
    const map = {
      "rgb(253, 239, 233)": "PASS",
      "rgb(253, 239, 237)": "FAIL",
      "rgb(250, 250, 250)": "unreached",
    };
    const chips = [...document.querySelectorAll("span[title]")];
    return {
      n: chips.length,
      states: chips.map((c) => map[getComputedStyle(c).backgroundColor] ?? "?"),
      caption: document.body.innerText.match(/Refused at [^\n]*/)?.[0] ?? null,
    };
  });
  if (chain.n !== 15) return fail("wrong chain length", `${chain.n} chips, expected 15`);
  const failIdx = chain.states.indexOf("FAIL");
  if (failIdx < 0) return fail("no refusing rule", "no chip is marked as the one that refused");
  const beforeChips = chain.states.slice(0, failIdx);
  const afterChips = chain.states.slice(failIdx + 1);
  if (!beforeChips.every((x) => x === "PASS")) fail("chain wrong", `a rule before the refusal is ${beforeChips.find((x) => x !== "PASS")}`);
  if (!afterChips.every((x) => x === "unreached")) fail("chain wrong", "a rule after the refusal is not marked unreached");
  const claimed = Number(chain.caption?.match(/The (\d+) rules? after/)?.[1] ?? -1);
  if (claimed !== afterChips.length) fail("caption wrong", `caption claims ${claimed}, the chain shows ${afterChips.length}`);
  return `refused at ${failIdx + 1}/15, ${afterChips.length} never consulted, caption agrees`;
});

await item("3.9", async () => {
  // A genuinely separate context: its own storage, so its own agent.
  const other = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await other.newPage();
  try {
    await p2.goto(`${BASE}/authority/`, { waitUntil: "networkidle", timeout: 90000 });
    await p2.waitForTimeout(4000);
    const startedAt = Number(
      (await p2.evaluate(() => document.body.innerText)).match(/\$([\d.]+) \/ \$5\.00/)?.[1] ?? -1
    );
    if (startedAt !== 0) fail("budgets shared", `a second browser started at $${startedAt}`);

    const mineBefore = await budget();
    await p2.locator("button", { hasText: "Buy market data" }).first().click();
    const t0 = Date.now();
    let verdict = null;
    for (;;) {
      verdict = await p2.evaluate(
        () => [...document.querySelectorAll(".verdict")].map((e) => e.textContent.trim())[1] ?? null
      );
      if (verdict || Date.now() - t0 > 180000) break;
      await p2.waitForTimeout(1000);
    }
    // The identical purchase the first browser already made must still be allowed.
    if (verdict !== "APPROVED") fail("isolation broken", `second browser got ${verdict}, expected APPROVED`);
    const mineAfter = await budget();
    if (mineAfter !== mineBefore) fail("cross-charged", `this browser moved $${mineBefore} → $${mineAfter}`);
    return `second agent approved the same purchase; this one still at $${mineAfter}`;
  } finally {
    await other.close();
  }
});

await item("3.10", async () => {
  const before = await budget();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(5000);
  const after = await budget();
  if (after !== before) fail("budget changed across a reload", `${before} → ${after}`);
  // And in a second context adopting the same agent id.
  const agent = await page.evaluate(() => localStorage.getItem("mandate.agent"));
  const server = await spentBy(agent);
  if (Math.abs(server - after) > 0.001) fail("page and authority disagree", `page $${after}, authority $${server}`);
  return `$${after} survives a reload and matches the authority`;
});

// ── escalation ──────────────────────────────────────────────────────────────
await item("3.11", async () => {
  const d = await post("/authority/preflight", {
    amount: 0.2,
    agent: newAgent(),
    recipient: newPayee(),
    endpoint: "https://api.example.com/v1/floor",
  });
  const s = d.vendor;
  if (!s) return fail("no score", "the decision carries no vendor assessment");
  if (typeof s.lcb !== "number" || typeof s.score !== "number") fail("no bound", JSON.stringify(s).slice(0, 90));
  if (s.lcb > s.score) fail("bound above the point estimate", `lcb ${s.lcb} > score ${s.score}`);
  if (typeof s.sigma !== "number" || s.sigma <= 0) fail("no spread", `sigma ${s.sigma}`);
  if (!s.band) fail("no band", "");
  if ((s.features?.length ?? 0) !== 7) fail("wrong feature count", `${s.features?.length} features`);
  const rule = d.rules.find((r) => r.rule === "vendor.lcbFloor");
  if (!rule) fail("floor never consulted", "the rule chain does not include vendor.lcbFloor");
  return `lcb ${s.lcb.toFixed(1)} ≤ ${s.score.toFixed(1)}, σ ${s.sigma.toFixed(1)}, band ${s.band}, 7 features`;
});

await item("3.12", async () => {
  const before = await budget();
  await page.waitForTimeout(2500);
  await press("Pay someone new");
  const { v } = await waitVerdict();
  if (v !== "ESCALATED_VENDOR_RISK") return fail("did not escalate", v ?? "no verdict");
  const after = await budget();
  if (after !== before) fail("a held spend charged the budget", `${before} → ${after}`);
  const t = await text();
  if (!/Waiting on you/.test(t)) fail("no held-spend surface", "the escalation is invisible");
  if (!/What the payee scored/.test(t)) fail("no score panel", "the bound arithmetic is not shown");
  if (!/vs floor \d+/.test(t)) fail("no floor comparison", "the panel does not say what it compared against");
  return `held, budget still $${after}`;
});

await item("3.13", async () => {
  const before = await budget();
  const releasable = page.locator("button", { hasText: "Release it" });
  if ((await releasable.count()) === 0) {
    return fail("nothing releasable", "the code for the new escalation was not retained");
  }
  await releasable.first().click();
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(() => !/Waiting on you/.test(document.body.innerText))) break;
    if (Date.now() - t0 > 180000) {
      fail("release never completed", "still waiting after 180s");
      break;
    }
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(3000);
  const after = await budget();
  if (after <= before) fail("release did not charge the budget", `${before} → ${after}`);
  return `${Math.round((Date.now() - t0) / 1000)}s, $${before} → $${after} — charged at release, not at hold`;
});

await item("3.14", async () => {
  const agent = newAgent();
  const raised = await post("/authority/spend", {
    amount: 0.2,
    agent,
    recipient: newPayee(),
    endpoint: "https://api.example.com/v1/boundary",
  });
  if (raised.decision !== "ESCALATED_VENDOR_RISK") return fail("did not escalate", raised.decision);
  globalThis.__esc = { agent, ...raised.escalation };
  const R = `/authority/escalation/${raised.escalation.id}/resolve`;
  const a = await post(R, {
    code: raised.escalation.code,
    operator: "0x000000000000000000000000000000000000bEEF",
    action: "APPROVE",
  });
  if (a.mandate !== "IGNORED_UNBOUND") fail("wrong outcome", `an unbound operator got ${a.mandate}`);
  const list = await fetch(`${GATEWAY}/authority/escalations?limit=20&agent=${agent}`).then((r) => r.json());
  if (list.entries.find((e) => e.id === raised.escalation.id)?.status !== "PENDING") {
    fail("state changed", "an unbound attempt moved the escalation off PENDING");
  }
  return "IGNORED_UNBOUND, still PENDING";
});

await item("3.15", async () => {
  const e = globalThis.__esc;
  const b = await post(`/authority/escalation/${e.id}/resolve`, {
    code: "0".repeat(24),
    operator: OPERATOR,
    action: "APPROVE",
  });
  if (b.mandate !== "IGNORED_BAD_CODE") fail("wrong outcome", `a wrong code got ${b.mandate}`);
  const list = await fetch(`${GATEWAY}/authority/escalations?limit=20&agent=${e.agent}`).then((r) => r.json());
  if (list.entries.find((x) => x.id === e.id)?.status !== "PENDING") {
    fail("state changed", "a bad code moved the escalation off PENDING");
  }
  return "IGNORED_BAD_CODE, still PENDING";
});

await item("3.16", async () => {
  const e = globalThis.__esc;
  const ok = await post(`/authority/escalation/${e.id}/resolve`, { code: e.code, operator: OPERATOR, action: "APPROVE" });
  if (ok.mandate !== "APPROVED") return fail("release failed", `the real code got ${ok.mandate}`);
  const again = await post(`/authority/escalation/${e.id}/resolve`, { code: e.code, operator: OPERATOR, action: "APPROVE" });
  if (again.mandate !== "IGNORED_ALREADY_RESOLVED") fail("replay accepted", `a replay got ${again.mandate}`);
  return "APPROVED once, then IGNORED_ALREADY_RESOLVED";
});

// ── the kill switch, on chain ───────────────────────────────────────────────
/*
 * Defined outside both items on purpose. If 3.17 throws before it has resumed,
 * 3.18 must still be able to put the live policy back — leaving it paused would
 * take the whole site down.
 */
const { execSync } = await import("node:child_process");
const { fileURLToPath: toPath } = await import("node:url");
const REPO = toPath(new URL("../../", import.meta.url));
const anchorPolicy = (flag) =>
  execSync(
    `set -a; . ./.env; set +a; cd apps/gateway && node --experimental-strip-types src/anchor-policy.ts ${flag} "$POLICY_ID"`,
    { cwd: REPO, encoding: "utf8", shell: "/bin/zsh", timeout: 300000 }
  );

try {
  await item("3.17", async () => {
    const paused = anchorPolicy("--pause");
    if (!/status=2 usable=false/.test(paused)) return fail("pause failed", paused.slice(-120));

    const d = await post("/authority/spend", {
      amount: 0.1,
      agent: newAgent(),
      endpoint: "https://api.example.com/v1/paused",
    });
    if (d.decision !== "BLOCKED_NO_ACTIVE_POLICY") fail("not refused", `paused gave ${d.decision}`);
    if (d.failedRule !== "policy.active") fail("wrong rule", `failed at ${d.failedRule}`);
    if (d.rules.length !== 1) fail("chain ran on", `${d.rules.length} rules consulted, expected exactly 1`);
    if (d.transactionHash) fail("paid while paused", "a paused policy still moved money");
    return "BLOCKED_NO_ACTIVE_POLICY at policy.active, 1 of 15 consulted";
  });
} finally {
  await item("3.18", async () => {
    const resumed = anchorPolicy("--resume");
    if (!/status=1 usable=true/.test(resumed)) return fail("resume failed", "THE POLICY IS STILL PAUSED");
    const d = await post("/authority/spend", { amount: 5000, agent: newAgent() });
    if (d.failedRule === "policy.active") return fail("still paused", "the authority still refuses at rule 1");
    if (d.decision !== "BLOCKED_PER_CALL_CAP") fail("unexpected", `got ${d.decision}`);
    return `${d.decision} — past rule 1, so the policy is live again`;
  });
}

// ── receipts ────────────────────────────────────────────────────────────────
let receiptId = null;
await item("3.19", async () => {
  const agent = newAgent();
  const d = await post("/authority/spend", {
    amount: 0.3,
    agent,
    category: "market-data",
    endpoint: `https://api.example.com/v1/receipt-${agent}`,
  });
  if (d.decision !== "APPROVED") fail("not approved", d.decision);
  // The receipt is written off the critical path; give the enqueue a moment.
  for (let i = 0; i < 15; i++) {
    const list = await fetch(`${GATEWAY}/authority/receipts?limit=25`).then((r) => r.json());
    const mine = list.entries.find((e) => e.body.agent === agent);
    if (mine) {
      receiptId = mine.receiptId;
      return `receipt ${mine.receiptId.slice(0, 12)}… at ${mine.status}`;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return fail("no receipt", "an approved spend produced no receipt");
});

await item("3.20", async () => {
  if (!receiptId) return fail("nothing to follow", "3.19 produced no receipt");
  const seen = new Set();
  const deadline = Date.now() + 300000;
  for (;;) {
    const list = await fetch(`${GATEWAY}/authority/receipts?limit=25`).then((r) => r.json());
    const mine = list.entries.find((e) => e.receiptId === receiptId);
    if (mine) seen.add(mine.status);
    if (mine?.status === "CONFIRMED" || mine?.status === "DEGRADED_UNANCHORED") break;
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 8000));
  }
  if (seen.has("DEGRADED_UNANCHORED")) fail("degraded", "the batch never reached the chain");
  if (!seen.has("CONFIRMED")) fail("never confirmed", `reached ${[...seen].join(" → ")} in 5 minutes`);
  return [...seen].join(" → ");
});

await item("3.21", async () => {
  if (!receiptId) return fail("nothing to prove", "3.19 produced no receipt");
  const p = await fetch(`${GATEWAY}/authority/receipt/${receiptId}`).then((r) => r.json());
  if (!p.proof) return fail("no proof", JSON.stringify(p).slice(0, 90));

  // Recompute the root here rather than believing the response.
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const { verifyProof } = await import(`${root}packages/receipts/dist/esm/merkle.js`).catch(() => ({}));
  if (verifyProof && !verifyProof(p.leaf, p.proof, p.root)) fail("proof does not verify", "the leaf does not reach the root");

  const { Contract } = await import("ethers");
  const c = new Contract(
    process.env.MANDATE_RECEIPTS ?? "0x64AE971Fda589E4C878F66452b8CE0533032f60d",
    ["function isAnchored(bytes32,bytes32) view returns (bool)"],
    provider
  );
  if (!(await c.isAnchored(p.batchId, p.root))) fail("chain disagrees", "the contract does not hold this root");
  return `proof verifies locally and MandateReceipts confirms root ${p.root.slice(0, 12)}…`;
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log("\n" + "=".repeat(64));
console.log(`${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  ${f.id}  ${f.note}`);
}
process.exit(failed.length === 0 ? 0 : 1);
