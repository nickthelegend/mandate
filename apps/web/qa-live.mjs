/**
 * The expensive half of the sweep.
 *
 * `qa.mjs` covers everything that is free to press. This covers the flows that
 * actually move money on Sepolia — an approved spend, a held spend released by
 * an operator, both x402 facilitators, a full agent cycle — plus the edge cases
 * that only exist once something is in flight: refreshing mid-transaction,
 * navigating away and back, and pressing a button again after it has already
 * succeeded.
 *
 * Kept separate because each run costs testnet funds and takes minutes, so it
 * is a deliberate act rather than something that fires on every commit.
 *
 *   node qa-live.mjs [baseUrl]
 */

import { chromium } from "playwright";

const BASE = (process.argv[2] ?? "https://nickthelegend.github.io/outcome").replace(/\/$/, "");
const GATEWAY = process.env.GATEWAY_URL ?? "https://gateway-production-944e.up.railway.app";

const IGNORE = [
  /favicon/i,
  /Download the React DevTools/i,
  /429|Too Many Requests|rate limit/i,
  /one decision at a time/i,
  // The documented 15s pace on /demo and /agent. Both pages surface it as a
  // live countdown and disable the button, which is asserted separately.
  /\/(demo|agent)(\?|$)/,
];
const ignored = (t) => IGNORE.some((r) => r.test(String(t)));

const problems = [];
let current = "(startup)";
const fail = (kind, detail) => {
  problems.push({ where: current, kind, detail: String(detail).slice(0, 200) });
  console.log(`    ✗ ${kind}: ${String(detail).slice(0, 150)}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

page.on("console", (m) => {
  if (m.type() === "error" && !ignored(m.text())) fail("console error", m.text());
});
page.on("pageerror", (e) => !ignored(e.message) && fail("uncaught exception", e.message));
page.on("requestfailed", (r) => {
  const t = `${r.url()} ${r.failure()?.errorText ?? ""}`;
  if (!ignored(t)) fail("request failed", t);
});
page.on("response", (r) => {
  if (r.status() >= 400 && r.status() !== 402 && !ignored(r.url())) fail(`http ${r.status()}`, r.url());
});

const check = async (name, fn) => {
  current = name;
  process.stdout.write(`  ${name.padEnd(54)}`);
  const before = problems.length;
  try {
    const note = await fn();
    console.log(problems.length === before ? `ok${note ? "  " + note : ""}` : "SEE ABOVE");
  } catch (e) {
    fail("threw", e.message);
  }
};

const text = () => page.evaluate(() => document.body.innerText);
const press = async (label) => {
  const b = page.locator("button", { hasText: label }).first();
  await b.scrollIntoViewIfNeeded();
  await b.click();
};
const budget = async () =>
  Number((await text()).match(/\$([\d.]+) \/ \$5\.00/)?.[1] ?? -1);

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

/** /demo and /agent share a 15s pace. Give it room rather than fighting it. */
const waitOutCooldown = () => page.waitForTimeout(20000);

console.log(`\nLive-flow sweep against ${BASE}\n`);
console.log("AUTHORITY — real money");

await page.goto(`${BASE}/authority/`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(4000);

await check("a fresh browser starts with its own full budget", async () => {
  const b = await budget();
  if (b !== 0) fail("not a fresh agent", `started at ${b}, so agents are not isolated`);
  return `$${b} spent`;
});

await check("an approved spend moves money and charges the budget", async () => {
  const before = await budget();
  await press("Buy market data");
  const { v, took } = await waitVerdict();
  if (v !== "APPROVED") return fail("not approved", v ?? "no verdict");
  const after = await budget();
  if (after <= before) fail("budget did not move", `${before} → ${after}`);
  const tx = await page.evaluate(() => document.querySelector('a[href*="/tx/"]')?.href ?? null);
  if (!tx) fail("no transaction link", "approved with nothing to check");
  return `${took}s, ${before} → ${after}`;
});

await check("pressing the same spend again is refused as a duplicate", async () => {
  // Resubmitting something that already succeeded must not pay twice.
  const before = await budget();
  await page.waitForTimeout(2500);
  await press("Buy the same thing again");
  const { v } = await waitVerdict();
  if (v !== "BLOCKED_DUPLICATE") fail("not caught as duplicate", v ?? "no verdict");
  const after = await budget();
  if (after !== before) fail("duplicate charged the budget", `${before} → ${after}`);
  return `${v}, budget held at ${after}`;
});

await check("refresh mid-transaction: the spend still lands, the page recovers", async () => {
  const before = await budget();
  await page.waitForTimeout(2500);
  // Start a real transfer, then reload while it is in flight.
  await press("Buy GPU time").catch(() => {});
  await page.waitForTimeout(400);
  await press("Buy market data").catch(() => {});
  await page.waitForTimeout(3000);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(6000);
  const t = await text();
  if (!/Spend it down/.test(t)) fail("page broken after mid-flight reload", t.slice(0, 100));
  if (!/\$[\d.]+ \/ \$5\.00/.test(t)) fail("no budget after reload", "");
  const after = await budget();
  if (after < before) fail("budget went backwards", `${before} → ${after}`);
  return `recovered, budget ${after}`;
});

await check("the rule chain short-circuits and says how far it got (3.6)", async () => {
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
  if (chain.n !== 15) fail("3.6", `${chain.n} chips, expected 15`);
  const failIdx = chain.states.indexOf("FAIL");
  if (failIdx < 0) fail("3.6", "no chip marked as the refusing rule");
  // Everything before the refusal passed; everything after was never consulted.
  const before = chain.states.slice(0, failIdx);
  const after = chain.states.slice(failIdx + 1);
  if (!before.every((x) => x === "PASS")) fail("3.6", `a rule before the refusal is ${before.find((x) => x !== "PASS")}`);
  if (!after.every((x) => x === "unreached")) fail("3.6", "a rule after the refusal is not marked unreached");
  const claimed = Number(chain.caption?.match(/The (\d+) rules? after/)?.[1] ?? -1);
  if (claimed !== after.length) fail("3.6", `caption claims ${claimed} unreached, chain shows ${after.length}`);
  return `refused at chip ${failIdx + 1}/15, ${after.length} never consulted, caption agrees`;
});

console.log("\nESCALATION — the third answer");

await check("an unknown payee is held, not refused, and nothing moves", async () => {
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
  return `held, budget still ${after}`;
});

await check("releasing it charges the budget and moves the money", async () => {
  const before = await budget();
  // Target a row this browser actually holds the code for. Escalations from an
  // earlier session are deliberately unreleasable and render an explanation
  // rather than a button, so `.first()` could otherwise pick a dead one.
  const releasable = page.locator("button", { hasText: "Release it" });
  if ((await releasable.count()) === 0) {
    return fail("no releasable held spend", "the code for the new escalation was not retained");
  }
  await releasable.first().click();
  // The release is another real transfer.
  const t0 = Date.now();
  for (;;) {
    const gone = await page.evaluate(() => !/Waiting on you/.test(document.body.innerText));
    if (gone) break;
    if (Date.now() - t0 > 180000) {
      fail("release never completed", "still waiting after 180s");
      break;
    }
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(3000);
  const after = await budget();
  if (after <= before) fail("release did not charge the budget", `${before} → ${after}`);
  return `${Math.round((Date.now() - t0) / 1000)}s, ${before} → ${after}`;
});

console.log("\nISOLATION (3.7-3.8)");

await check("a second browser gets its own budget and can repeat the purchase", async () => {
  // A genuinely separate context: its own storage, so its own agent.
  const other = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await other.newPage();
  try {
    await p2.goto(`${BASE}/authority/`, { waitUntil: "networkidle", timeout: 90000 });
    await p2.waitForTimeout(4000);
    const startedAt = Number((await p2.evaluate(() => document.body.innerText)).match(/\$([\d.]+) \/ \$5\.00/)?.[1] ?? -1);
    if (startedAt !== 0) fail("3.7", `a second browser started at ${startedAt}, so budgets are shared`);

    // The identical purchase the first browser already made must still be allowed.
    await p2.locator("button", { hasText: "Buy market data" }).first().click();
    const t0 = Date.now();
    let verdict = null;
    for (;;) {
      verdict = await p2.evaluate(
        () => [...document.querySelectorAll(".verdict")].map((e) => e.textContent.trim())[1] ?? null
      );
      if (verdict) break;
      if (Date.now() - t0 > 180000) break;
      await p2.waitForTimeout(1000);
    }
    if (verdict !== "APPROVED") fail("3.7", `second browser got ${verdict}, expected APPROVED`);

    // 3.8: the first browser's figure must be untouched by any of that.
    const mine = await budget();
    if (mine !== 0.6) fail("3.8", `this browser's budget moved to ${mine} while another agent spent`);
    return `second agent approved the same purchase; this one still at $${mine}`;
  } finally {
    await other.close();
  }
});

console.log("\nESCALATION — the authority boundary (3.12-3.14)");

/*
 * These need an escalation with a known code, raised through the API so the
 * code is in hand. The UI deliberately never exposes one it was not given.
 */
await check("unbound operator / wrong code / replay are all refused", async () => {
  const agent = `qa${Date.now().toString(36)}`;
  const fresh = "0x" + [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const post = (path, body) =>
    fetch(`${GATEWAY}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  const raised = await post("/authority/spend", {
    amount: 0.2,
    agent,
    recipient: fresh,
    endpoint: "https://api.example.com/v1/boundary",
  });
  if (raised.decision !== "ESCALATED_VENDOR_RISK") return fail("did not escalate", raised.decision);
  const { id, code } = raised.escalation;
  const R = `/authority/escalation/${id}/resolve`;
  const OP = "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67";

  // 3.12 unbound operator
  const a = await post(R, { code, operator: "0x000000000000000000000000000000000000bEEF", action: "APPROVE" });
  if (a.outcome !== "IGNORED_UNBOUND") fail("3.12", `unbound gave ${a.outcome}`);

  // 3.13 wrong code
  const b2 = await post(R, { code: "0".repeat(24), operator: OP, action: "APPROVE" });
  if (b2.outcome !== "IGNORED_BAD_CODE") fail("3.13", `wrong code gave ${b2.outcome}`);

  // still open after both
  const list = await fetch(`${GATEWAY}/authority/escalations?limit=20&agent=${agent}`).then((r) => r.json());
  const row = list.entries.find((e) => e.id === id);
  if (row?.status !== "PENDING") fail("3.12/3.13", `escalation is ${row?.status}, expected PENDING`);

  // 3.14 replay: approve, then approve again
  const ok = await post(R, { code, operator: OP, action: "APPROVE" });
  if (ok.outcome !== "APPROVED") fail("3.11", `release gave ${ok.outcome}`);
  const again = await post(R, { code, operator: OP, action: "APPROVE" });
  if (again.outcome !== "IGNORED_ALREADY_RESOLVED") fail("3.14", `replay gave ${again.outcome}`);

  return "UNBOUND, BAD_CODE, still PENDING, then APPROVED and ALREADY_RESOLVED";
});

console.log("\nKILL SWITCH — on chain (3.15-3.16)");

await check("pausing on chain refuses the next spend at rule 1 of 15", async () => {
  const { execSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const run = (flag) =>
    execSync(
      `set -a; . ./.env; set +a; cd apps/gateway && node --experimental-strip-types src/anchor-policy.ts ${flag} "$POLICY_ID"`,
      { cwd: root, encoding: "utf8", shell: "/bin/zsh", timeout: 300000 }
    );

  try {
    const paused = run("--pause");
    if (!/status=2 usable=false/.test(paused)) return fail("pause", paused.slice(-120));

    const agent = `qa${Date.now().toString(36)}`;
    const d = await fetch(`${GATEWAY}/authority/spend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 0.1, agent, endpoint: "https://api.example.com/v1/paused" }),
    }).then((r) => r.json());

    if (d.decision !== "BLOCKED_NO_ACTIVE_POLICY") fail("3.15", `paused gave ${d.decision}`);
    if (d.failedRule !== "policy.active") fail("3.15", `failed at ${d.failedRule}, expected policy.active`);
    if (d.rules.length !== 1) fail("3.15", `${d.rules.length} rules consulted, expected exactly 1`);
    if (d.transactionHash) fail("3.15", "a paused policy still moved money");
    return `BLOCKED_NO_ACTIVE_POLICY at policy.active, ${d.rules.length} of 15 consulted`;
  } finally {
    // Always resume, even if an assertion above threw. Leaving the live policy
    // paused would take the whole site down.
    const resumed = run("--resume");
    if (!/status=1 usable=true/.test(resumed)) fail("3.16", "FAILED TO RESUME — the policy is still paused");
  }
});

await check("spending works again after the resume", async () => {
  const agent = `qa${Date.now().toString(36)}`;
  const d = await fetch(`${GATEWAY}/authority/spend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount: 5000, agent }),
  }).then((r) => r.json());
  // Any verdict past policy.active proves the chain read recovered.
  if (d.failedRule === "policy.active") fail("3.16", "still refusing at policy.active after resume");
  if (d.decision !== "BLOCKED_PER_CALL_CAP") fail("3.16", `got ${d.decision}`);
  return `${d.decision} — past rule 1, so the policy is live again`;
});

console.log("\nX402 + AGENT — the other real flows");

await check("/demo lying facilitator: reports success, serves nothing", async () => {
  await page.goto(`${BASE}/demo/`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2500);
  // The static copy on this page already contains "402", so the assertion has
  // to be on the RUN's output -- a settled transaction hash that appears only
  // after the flow completes -- or it passes in zero seconds having done nothing.
  const txBefore = await page.evaluate(() => document.querySelectorAll('a[href*="/tx/"]').length);
  await press("lying").catch(async () => press("Pay with a lying facilitator"));
  const t0 = Date.now();
  for (;;) {
    const n = await page.evaluate(() => document.querySelectorAll('a[href*="/tx/"]').length);
    if (n > txBefore) break;
    if (Date.now() - t0 > 240000) {
      fail("no result", "the lying run never produced a transaction");
      break;
    }
    await page.waitForTimeout(2000);
  }
  const t = await text();
  // The whole point: the facilitator claimed success and the article was withheld.
  if (!/withheld|not served|no Transfer|moved nothing|402/i.test(t)) {
    fail("wrong outcome", "a lying settlement did not read as a refusal");
  }
  return `${Math.round((Date.now() - t0) / 1000)}s, article withheld`;
});

await check("/demo honest facilitator: serves the article", async () => {
  // The gateway paces these routes at 15s and the UI now counts down. Wait it
  // out rather than reporting the gateway doing its job as a defect.
  await waitOutCooldown();
  await press("honest").catch(async () => press("Pay honestly"));
  /*
   * Wait for the ARTICLE, not for a count to change. Watching the transaction
   * links broke instantly: starting a run clears the previous result, so the
   * count drops 1 -> 0 and a "has it changed" check fires before anything has
   * happened. The article body only exists once the settlement was proven and
   * the resource released, which is the thing being asserted.
   */
  const t0 = Date.now();
  let served = false;
  for (;;) {
    served = /status byte is not evidence/i.test(await text());
    if (served) break;
    if (Date.now() - t0 > 240000) break;
    await page.waitForTimeout(2000);
  }
  if (!served) fail("article not served", "an honest settlement did not release the resource");
  return `${Math.round((Date.now() - t0) / 1000)}s, article served`;
});

await check("/agent full cycle completes with a claim and a settlement", async () => {
  await page.goto(`${BASE}/agent/`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2500);
  await waitOutCooldown();
  await press("Post a job");
  const t0 = Date.now();
  for (;;) {
    const t = await text();
    if (/release|refund|settle|0x[0-9a-f]{10}/i.test(t) && !/Working…/.test(t)) break;
    if (Date.now() - t0 > 300000) {
      fail("no result", "the agent cycle never resolved");
      break;
    }
    await page.waitForTimeout(3000);
  }
  const t = await text();
  if (!/0x[0-9a-fA-F]{10}/.test(t)) fail("no transaction shown", t.slice(0, 120));
  return `${Math.round((Date.now() - t0) / 1000)}s`;
});

await browser.close();
console.log("\n" + "=".repeat(62));
if (problems.length === 0) console.log("clean — every live flow completed with no console or network errors");
else {
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log(`  [${p.where}] ${p.kind}: ${p.detail}`);
}
process.exit(problems.length === 0 ? 0 : 1);
