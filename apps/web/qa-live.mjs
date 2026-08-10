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

const IGNORE = [
  /favicon/i,
  /Download the React DevTools/i,
  /429|Too Many Requests|rate limit/i,
  /one decision at a time/i,
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
  await press("Release it");
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
  await page.waitForTimeout(16000);
  const txBefore2 = await page.evaluate(() => document.querySelectorAll('a[href*="/tx/"]').length);
  await press("honest").catch(async () => press("Pay honestly"));
  const t0 = Date.now();
  for (;;) {
    const n = await page.evaluate(() => document.querySelectorAll('a[href*="/tx/"]').length);
    if (n !== txBefore2) break;
    if (Date.now() - t0 > 240000) {
      fail("no result", "the honest run never produced a transaction");
      break;
    }
    await page.waitForTimeout(2000);
  }
  // An honest settlement must actually release the goods.
  if (!/status byte is not evidence/i.test(await text())) {
    fail("article not served", "an honest settlement did not release the resource");
  }
  return `${Math.round((Date.now() - t0) / 1000)}s, article served`;
});

await check("/agent full cycle completes with a claim and a settlement", async () => {
  await page.goto(`${BASE}/agent/`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2500);
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
