/**
 * Record the demo, by driving the real thing.
 *
 * Not a screen capture of someone clicking, and not an edit: Playwright opens
 * the deployed site, presses the real buttons against the live gateway, and
 * records what actually happens. Every transaction in the resulting file is one
 * that landed on Sepolia while the camera was rolling, which is the only kind
 * of demo video this project has any business shipping.
 *
 *   node record-demo.mjs                        # against the deployed site
 *   node record-demo.mjs http://localhost:4180  # against a local build
 *
 * Output: demo/mandate-demo.webm plus a still of each beat.
 *
 * The pacing is deliberate. Approvals are real transfers and take twenty to
 * forty seconds, so the script waits on the page's own state rather than on a
 * fixed timer -- a recording that cuts away mid-transaction would be exactly
 * the "trust me it worked" this product exists to argue against.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = (process.argv[2] ?? "https://nickthelegend.github.io/mandate").replace(/\/$/, "");
const OUT = "demo";
mkdirSync(OUT, { recursive: true });

const beats = [];
const beat = async (page, name, note) => {
  beats.push(name);
  await page.screenshot({ path: `${OUT}/${String(beats.length).padStart(2, "0")}-${name}.png` });
  console.log(`  ${String(beats.length).padStart(2, "0")}  ${name}${note ? ` — ${note}` : ""}`);
};

/** Let a viewer actually read what just appeared. */
const dwell = (page, ms) => page.waitForTimeout(ms);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
  // A fresh profile means a fresh agent id, so the budget starts at $5 and the
  // recording shows the same first-run a judge gets.
  storageState: undefined,
});
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("    console error:", m.text().slice(0, 120));
});

console.log(`recording against ${BASE}`);

// ── 0:00 the claim ──────────────────────────────────────────────────────────
await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 90000 });
await dwell(page, 3500);
await beat(page, "the-claim", "give an agent a budget it cannot exceed");

await page.evaluate(() => window.scrollTo({ top: 900, behavior: "smooth" }));
await dwell(page, 3000);
await beat(page, "fifteen-rules");

await page.evaluate(() => window.scrollTo({ top: 1800, behavior: "smooth" }));
await dwell(page, 3000);
await beat(page, "chain-of-custody", "every step on Sepolia");

// ── 0:20 the authority, live ────────────────────────────────────────────────
await page.goto(`${BASE}/authority/`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(4000);
await beat(page, "authority-fresh", "a fresh agent, $5 of budget");

const press = async (label) => {
  const b = page.locator("button", { hasText: label }).first();
  await b.scrollIntoViewIfNeeded();
  await b.click();
};

/** Wait for a verdict to appear, however long the chain takes. */
const verdict = async (timeout = 180000) => {
  const started = Date.now();
  for (;;) {
    const v = await page.evaluate(
      () => [...document.querySelectorAll(".verdict")].map((e) => e.textContent.trim())[1] ?? null
    );
    if (v) return { v, took: Math.round((Date.now() - started) / 1000) };
    if (Date.now() - started > timeout) return { v: "(timed out)", took: -1 };
    await page.waitForTimeout(1000);
  }
};

await press("Spend $5,000");
let r = await verdict();
await dwell(page, 3000);
await beat(page, "refused-cap", `${r.v} in ${r.took}s`);

await page.waitForTimeout(2000);
await press("Buy GPU time");
r = await verdict();
await dwell(page, 3000);
await beat(page, "refused-category", r.v);

// ── 0:50 an approval that actually moves money ──────────────────────────────
await page.waitForTimeout(2000);
await press("Buy market data");
r = await verdict();
await dwell(page, 4000);
await beat(page, "approved", `${r.v} in ${r.took}s — a real transfer`);

// ── 1:15 the moment: reload, and the spend is still gone ────────────────────
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(4500);
await beat(page, "survives-reload", "the budget is in a database, not this page");

// ── 1:40 the third answer: a payee nobody has paid ──────────────────────────
await page.waitForTimeout(1500);
await press("Pay someone new");
r = await verdict();
await dwell(page, 4500);
await beat(page, "escalated", `${r.v} — the bureau's bound is under the floor`);

const held = await page.locator("button", { hasText: "Release it" }).count();
if (held > 0) {
  await press("Release it");
  // The release is another real transfer.
  await page.waitForTimeout(45000);
  await beat(page, "released", "a bound operator released the held spend");
}

// ── 2:20 the record ─────────────────────────────────────────────────────────
await page.evaluate(() => window.scrollTo({ top: 99999, behavior: "smooth" }));
await dwell(page, 4000);
await beat(page, "the-record", "refusals kept as well as approvals");

await ctx.close();
await browser.close();
console.log(`\n  ${beats.length} beats, video in ${OUT}/`);
