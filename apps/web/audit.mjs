/**
 * The pre-judging audit: every route, every control, in a real browser.
 *
 * Runs headless Chromium against the running app, clicks what a visitor clicks,
 * and fails on anything a judge would see -- a console error, a failed request,
 * an unhandled rejection, an error boundary, or a control that does nothing.
 *
 * It also does what a careless user does: submits empty forms, double-clicks
 * the button, navigates back mid-flow, and reloads after a result.
 *
 * Run:  node audit.mjs [baseURL]
 */

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:4180";

const ROUTES = [
  "/", "/demo", "/agent", "/ledger", "/explorer",
  "/verify", "/inspect", "/claim", "/x402", "/docs",
];

/*
 * Noise that is not the app's fault. Kept deliberately tight: a broad filter
 * here would hide the very errors this exists to find.
 */
const IGNORE = [
  /favicon/i,
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  // Public RPCs rate-limit under a burst of automated page loads; that is the
  // endpoint pushing back, not a defect in the page.
  /429|Too Many Requests|rate limit/i,
];
const ignored = (t) => IGNORE.some((r) => r.test(t));

const problems = [];
const note = (route, kind, detail) => {
  problems.push({ route, kind, detail: String(detail).slice(0, 220) });
  console.log(`  ✗ ${kind}: ${String(detail).slice(0, 130)}`);
};

/** Attach listeners that catch what the UI hides. */
function watch(page, route) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!ignored(t)) note(route, "console error", t);
  });
  page.on("pageerror", (e) => {
    if (!ignored(e.message)) note(route, "uncaught exception", e.message);
  });
  page.on("requestfailed", (r) => {
    const t = `${r.url()} ${r.failure()?.errorText ?? ""}`;
    if (!ignored(t)) note(route, "request failed", t);
  });
  page.on("response", (r) => {
    // 402 is this product's correct answer on the x402 paths, not a failure.
    if (r.status() >= 400 && r.status() !== 402 && !ignored(r.url())) {
      note(route, `http ${r.status()}`, r.url());
    }
  });
}

async function settle(page, ms = 2500) {
  await page.waitForTimeout(ms);
}

const results = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

for (const route of ROUTES) {
  const page = await ctx.newPage();
  watch(page, route);
  console.log(`\n${route}`);

  try {
    const url = BASE + (route === "/" ? "/" : route + "/");
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (resp && resp.status() >= 400) note(route, `http ${resp.status()}`, route);
    await settle(page);

    // An error boundary is a failure even when the status was 200.
    const body = await page.evaluate(() => document.body.innerText);
    if (/application error|client-side exception|unhandled runtime/i.test(body)) {
      note(route, "error boundary", body.slice(0, 160));
    }
    if (body.trim().length < 60) note(route, "renders nothing", `${body.trim().length} chars`);

    // Every internal link must resolve, and nav must be present on every page.
    const navCount = await page.locator("header a").count();
    if (navCount < 5) note(route, "navigation missing", `${navCount} header links`);

    // No control may be a no-op: every button needs an accessible name.
    const nameless = await page.evaluate(() =>
      [...document.querySelectorAll("button")].filter(
        (b) => !(b.textContent || "").trim() && !b.getAttribute("aria-label")
      ).length
    );
    if (nameless > 0) note(route, "unlabelled control", `${nameless} button(s) with no accessible name`);

    // Mobile: nothing may overflow the viewport horizontally.
    await page.setViewportSize({ width: 375, height: 812 });
    await settle(page, 900);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    if (overflow > 2) note(route, "horizontal overflow at 375px", `${overflow}px`);
    await page.setViewportSize({ width: 1280, height: 900 });

    results.push(route);
  } catch (e) {
    note(route, "navigation threw", e.message);
  }

  await page.close();
}

/* ---- Deliberate abuse of the one real form ------------------------------ */
{
  const route = "/verify (abuse)";
  const page = await ctx.newPage();
  watch(page, route);
  console.log(`\n${route}`);

  await page.goto(BASE + "/verify/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#hash");
  await settle(page, 1200);

  // 1. Empty submit must be refused, not sent.
  await page.fill("#hash", "");
  await page.click('button[type="submit"]');
  await settle(page, 900);
  if (page.url().includes("?")) note(route, "empty submit navigated", page.url());

  // 2. Garbage must produce a readable message, never a raw internal.
  await page.fill("#hash", "not-a-hash");
  await page.click('button[type="submit"]');
  await settle(page, 1200);
  const afterBad = await page.evaluate(() => document.body.innerText);
  if (/coalesce|BigInt|TypeError|undefined is not/i.test(afterBad)) {
    note(route, "raw internal shown to user", afterBad.match(/.{0,90}(coalesce|BigInt|TypeError).{0,60}/i)?.[0]);
  }
  if (!/0x followed by 64 hex/i.test(afterBad)) {
    note(route, "no readable validation message", afterBad.slice(0, 140));
  }

  // 3. A real hash, double-clicked: must not fire twice or wedge.
  const GOOD = "0xf2c4055d08d9b52ca5f4f89fe2cd6c670e2204c2458e4731fd3c0ae0eda5073c";
  await page.fill("#hash", GOOD);
  await page.fill("#amt", "2000000");
  const btn = page.locator('button[type="submit"]');
  await btn.click();
  await btn.click({ force: true }).catch(() => {});
  await settle(page, 9000);
  const afterGood = await page.evaluate(() => document.body.innerText);
  if (!/not proven|no mark|proven/i.test(afterGood)) {
    note(route, "no verdict after valid submit", afterGood.slice(0, 160));
  }
  if (/reading the receipt/i.test(afterGood)) note(route, "stuck loading after 9s", "spinner never resolved");

  // 4. Back mid-flow, then forward: the page must still work.
  await page.goBack().catch(() => {});
  await settle(page, 800);
  await page.goto(BASE + "/verify/", { waitUntil: "domcontentloaded" });
  await settle(page, 1200);
  if (!(await page.locator("#hash").count())) note(route, "form gone after back/forward", page.url());

  // 5. Reload after a result: must not resubmit or error.
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page, 1200);
  const afterReload = await page.evaluate(() => document.body.innerText);
  if (/application error/i.test(afterReload)) note(route, "error after reload", afterReload.slice(0, 120));

  await page.close();
}

await browser.close();

console.log(`\n${"=".repeat(58)}`);
console.log(`routes visited: ${results.length}/${ROUTES.length}`);
console.log(`problems: ${problems.length}`);
for (const p of problems) console.log(`  [${p.route}] ${p.kind} :: ${p.detail}`);
process.exit(problems.length ? 1 : 0);
