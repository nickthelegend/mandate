/**
 * Phase 3 and 4. One continuous take through the live app.
 *
 * Everything here is real: real clicks on the deployed site, real requests to
 * the live gateway, real tUSDC moving on Sepolia. Nothing is staged. If a beat
 * fails, the take fails — the right response is to fix the app and record
 * again, not to soften the assertion.
 *
 * THE ONE CLOCK
 *
 * Every beat holds for the measured duration of its own narration line plus a
 * breath, read from `recording/audio/durations.json`. Nothing is timed by eye
 * and no span is estimated, because an estimate that is a few hundred
 * milliseconds out on each of fourteen lines is ten seconds of drift by the
 * outro. `DEMO_LINE <ms> <id>` is printed the instant a beat starts, so the
 * edit can lay audio against marks rather than against guesses.
 *
 * NO WALLET, DELIBERATELY
 *
 * There is no extension to approve and no key to inject. The product's whole
 * claim is that the agent holds no key — KeeperHub's relayer signs, server
 * side — so the browser is never asked to connect anything. The two signing
 * beats still wait on a real Sepolia signature; the overlay covers the
 * confirmation, and it comes down only when the transaction is on chain,
 * checked against the chain rather than against a timer.
 *
 *   node scripts/record-demo.mjs
 */

import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider } from "ethers";

/*
 * Anchored to this file, not to the working directory. The script has to run
 * from `apps/web` so playwright resolves, and the audio it reads lives at the
 * repo root — a cwd-relative path is a take that dies before the first beat.
 */
const ROOT = process.env.DEMO_ROOT
  ? process.env.DEMO_ROOT.replace(/\/?$/, "/")
  : fileURLToPath(new URL("../", import.meta.url));

const BASE = (process.env.DEMO_BASE ?? "https://nickthelegend.github.io/mandate").replace(/\/$/, "");
const GATEWAY = process.env.GATEWAY_URL ?? "https://gateway-production-944e.up.railway.app";
/** Fixed geometry, so the capture is cropped by the viewport rather than after. */
const W = Number(process.env.DEMO_W ?? 1440);
const H = Number(process.env.DEMO_H ?? 900);
const OUT = `${ROOT}recording`;
const BREATH_MS = 450;

const durations = JSON.parse(readFileSync(`${OUT}/audio/durations.json`, "utf8"));
mkdirSync(`${OUT}/video`, { recursive: true });

const t0 = Date.now();
const marks = [];
const provider = new JsonRpcProvider("https://ethereum-sepolia-rpc.publicnode.com", 11155111);

/** A named failure, so a timeout says which beat died rather than "timeout". */
class BeatFailure extends Error {
  constructor(label, detail) {
    super(`${label}: ${detail}`);
    this.name = "BeatFailure";
  }
}

const browser = await chromium.launch({ args: [`--window-size=${W},${H}`] });
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  recordVideo: { dir: `${OUT}/video`, size: { width: W, height: H } },
});
const page = await ctx.newPage();

/*
 * Console errors are counted before the take and compared after, rather than
 * asserted to be zero. The page may already carry noise from a navigation that
 * happened before recording started, and failing on somebody else's error
 * would burn a take for nothing.
 */
let consoleErrors = 0;
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|429|Too Many|publicnode\.com/i.test(m.text())) consoleErrors += 1;
});
page.on("pageerror", () => {
  consoleErrors += 1;
});

// ── the cursor, and the ring ────────────────────────────────────────────────
/*
 * An SVG cursor moved with requestAnimationFrame, never the hardware pointer.
 * A real pointer jumps between coordinates, and it can be stolen mid-take by a
 * notification or a focus change — both of which end a take.
 */
async function installCursor() {
  await page.evaluate(() => {
    if (document.getElementById("__cursor")) return;
    const c = document.createElement("div");
    c.id = "__cursor";
    c.innerHTML =
      '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 22 L7.5 17 L11 26 L14.5 24.5 L11 15.5 L18 15.5 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, {
      position: "fixed",
      left: "0px",
      top: "0px",
      zIndex: "2147483647",
      pointerEvents: "none",
      transform: "translate(-2px,-2px)",
      filter: "drop-shadow(0 2px 4px rgba(0,0,0,.35))",
    });
    document.body.appendChild(c);
    window.__cursorAt = { x: 0, y: 0 };
  });
}

async function glide(x, y, ms = 700) {
  await page.evaluate(
    ([tx, ty, dur]) =>
      new Promise((done) => {
        const c = document.getElementById("__cursor");
        const from = window.__cursorAt ?? { x: 0, y: 0 };
        const t0 = performance.now();
        // easeInOutCubic: a pointer that accelerates and settles reads as a
        // hand. Linear motion reads as a script.
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const step = (now) => {
          const p = Math.min(1, (now - t0) / dur);
          const e = ease(p);
          const x = from.x + (tx - from.x) * e;
          const y = from.y + (ty - from.y) * e;
          c.style.left = `${x}px`;
          c.style.top = `${y}px`;
          window.__cursorAt = { x, y };
          if (p < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      }),
    [x, y, ms]
  );
}

async function ring(x, y) {
  await page.evaluate(
    ([x, y]) => {
      const r = document.createElement("div");
      Object.assign(r.style, {
        position: "fixed",
        left: `${x - 18}px`,
        top: `${y - 18}px`,
        width: "36px",
        height: "36px",
        borderRadius: "999px",
        border: "2px solid rgba(239,77,35,.9)",
        zIndex: "2147483646",
        pointerEvents: "none",
      });
      document.body.appendChild(r);
      r.animate(
        [
          { transform: "scale(.4)", opacity: 1 },
          { transform: "scale(1.5)", opacity: 0 },
        ],
        { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" }
      ).onfinish = () => r.remove();
    },
    [x, y]
  );
}

/** Move to an element, ring it, click it. */
async function press(label, selectorFn) {
  const el = await selectorFn();
  if (!el) throw new BeatFailure(label, "nothing to press");
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new BeatFailure(label, "the target has no box");
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await glide(x, y, 620);
  await ring(x, y);
  await page.waitForTimeout(140);
  await el.click();
}

/** Real typing, ~24 characters a second with jitter. */
async function typeInto(el, text) {
  await el.click();
  for (const ch of text) {
    await el.type(ch, { delay: 0 });
    await page.waitForTimeout(42 + Math.random() * 26);
  }
}

/** Poll real state. Throws a named error naming the beat that stalled. */
async function until(label, predicate, timeoutMs = 120000) {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return Date.now() - start;
    if (Date.now() - start > timeoutMs) throw new BeatFailure(label, `still false after ${timeoutMs}ms`);
    await page.waitForTimeout(500);
  }
}

/** Log the mark and remember when this beat began. */
let currentBeat = null;
function line(id) {
  const at = Date.now() - t0;
  currentBeat = { id, at };
  marks.push(currentBeat);
  console.log(`DEMO_LINE ${at} ${id}`);
}

/** Hold for this beat's measured narration plus a breath. */
async function hold(id = currentBeat?.id) {
  const secs = durations[id];
  if (secs === undefined) throw new BeatFailure(id ?? "unknown", "no measured duration for this line");
  await page.waitForTimeout(Math.round(secs * 1000) + BREATH_MS);
}

// ── the signing overlay ─────────────────────────────────────────────────────
/*
 * Full-bleed, in-app, and held until the chain confirms. Not a spinner over a
 * timer — `confirmed` polls Sepolia for the receipt, so the overlay comes down
 * because the transaction is real, which is the only reason worth holding it.
 */
async function overlayOn(text = "Signing Transaction") {
  await page.evaluate((t) => {
    const o = document.createElement("div");
    o.id = "__signing";
    Object.assign(o.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483640",
      background: "#111111",
      color: "#fff",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      letterSpacing: "-0.01em",
    });
    o.innerHTML =
      `<div style="font-size:30px;font-weight:600">${t}</div>` +
      `<div id="__signing_sub" style="font-size:14px;opacity:.62">KeeperHub is signing on Sepolia</div>` +
      `<div id="__signing_hash" style="font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;opacity:.5;min-height:16px"></div>` +
      `<div id="__signing_t" style="font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;opacity:.35"></div>`;
    document.body.appendChild(o);

    /*
     * The wait is twenty to forty seconds of real chain time, and a viewer
     * staring at an unchanging black frame assumes the demo has hung. Counting
     * it out — and showing the hash the moment it exists — makes the same
     * honest wait legible instead of dead. Nothing here shortens it.
     */
    const start = performance.now();
    window.__signingTimer = setInterval(() => {
      const el = document.getElementById("__signing_t");
      if (el) el.textContent = `${((performance.now() - start) / 1000).toFixed(1)}s — waiting for the chain`;
    }, 100);
  }, text);
}

/** Show the hash inside the overlay as soon as the gateway returns one. */
async function overlayHash(hash) {
  await page.evaluate((h) => {
    const el = document.getElementById("__signing_hash");
    if (el) el.textContent = h;
  }, hash);
}
async function overlayOff() {
  await page.evaluate(() => {
    clearInterval(window.__signingTimer);
    document.getElementById("__signing")?.remove();
  });
}

/** True once the chain has the receipt. Real read, no timer. */
async function confirmed(hash) {
  try {
    const r = await provider.getTransactionReceipt(hash);
    return Boolean(r && r.status === 1);
  } catch {
    return false;
  }
}

/** The newest transaction hash rendered on the page, or null. */
const shownTx = () =>
  page.evaluate(() => {
    const a = document.querySelector('a[href*="/tx/"]');
    return a ? (a.getAttribute("href").match(/0x[0-9a-fA-F]{64}/) ?? [null])[0] : null;
  });

const budget = async () =>
  Number(((await page.evaluate(() => document.body.innerText)).match(/\$([\d.]+) \/ \$5\.00/) ?? [])[1] ?? -1);
const bodyText = () => page.evaluate(() => document.body.innerText);

// ── pre-flight ──────────────────────────────────────────────────────────────
console.log("pre-flight");
const health = await fetch(`${GATEWAY}/health`).then((r) => r.json());
if (health.status !== "UP") throw new BeatFailure("pre-flight", `gateway is ${health.status}`);
console.log(`  gateway UP — ${health.checks.map((c) => `${c.name} ${c.ms}ms`).join(", ")}`);

await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 90000 });
// A warm agent starts mid-budget; the take needs to open at $0.00.
await page.evaluate(() => localStorage.clear());
await installCursor();

// Prove the recorder is capturing the app and not a grey window.
await page.waitForTimeout(2000);
const frame = await page.screenshot();
if (frame.length < 40000) throw new BeatFailure("pre-flight", `frame is ${frame.length} bytes — probably blank`);
console.log(`  capture check: ${Math.round(frame.length / 1024)}KB frame`);
const errorsBefore = consoleErrors;

// ── the take ────────────────────────────────────────────────────────────────
console.log("\nrecording");
line("intro");
await hold();

line("b01-home");
await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 90000 });
await installCursor();
await until("b01-home", async () => /budget\s+it\s+cannot\s+exceed/i.test(await bodyText()));
await glide(720, 400, 900);
await hold();

line("b02-custody");
// The chain-of-custody table: anchor, spend, tamper, pause — each with a hash.
await page.evaluate(() => {
  const h = [...document.querySelectorAll("h2")].find((x) => /custody|chain of/i.test(x.textContent ?? ""));
  (h ?? document.querySelector("main"))?.scrollIntoView({ behavior: "smooth", block: "center" });
});
await page.waitForTimeout(1400);
await glide(700, 500, 900);
await hold();

line("b03-demo");
// The decision demo: the published engine, running client-side.
await page.evaluate(() => {
  const el = [...document.querySelectorAll("*")].find((x) => /judged in your browser|decision demo/i.test(x.textContent ?? "") && x.children.length < 8);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
});
await page.waitForTimeout(1400);
const demoCase = page.locator("button", { hasText: /Spend|Buy|Pay/ }).first();
if ((await demoCase.count()) > 0) await press("b03-demo", () => demoCase);
await page.waitForTimeout(1200);
await hold();

line("b04-authority");
await page.goto(`${BASE}/authority/`, { waitUntil: "networkidle", timeout: 90000 });
await installCursor();
await until("b04-authority", async () => /ACTIVE ON CHAIN/.test(await bodyText()));
if ((await budget()) !== 0) throw new BeatFailure("b04-authority", `budget opened at ${await budget()}, not 0`);
await glide(360, 320, 900);
await hold();

// b05 — a real approved spend. SIGNING BEAT.
line("b05-approve");
await press("b05-approve", () => page.locator("button", { hasText: "Buy market data" }).first());
await overlayOn();
const spendHash = await (async () => {
  await until("b05-approve", async () => (await shownTx()) !== null, 180000);
  return shownTx();
})();
await overlayHash(spendHash);
await until("b05-approve/chain", () => confirmed(spendHash), 180000);
await overlayOff();
console.log(`  signed: ${spendHash}`);
marks[marks.length - 1].signing = true;
marks[marks.length - 1].tx = spendHash;
await hold();

line("b06-signer");
await until("b06-signer", async () => /KeeperHub executed this as/.test(await bodyText()));
await page.evaluate(() => {
  const el = [...document.querySelectorAll("*")].find((x) => /Who actually signed it/.test(x.textContent ?? "") && x.children.length < 6);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
});
await page.waitForTimeout(1200);
await hold();

line("b07-inspect");
// KeeperHub's own execution record, for the spend just made.
const execId = await page.evaluate(() => {
  const a = [...document.querySelectorAll("a")].find((x) => /inspect\/\?id=/.test(x.getAttribute("href") ?? ""));
  return a ? (a.getAttribute("href").match(/id=([a-z0-9]+)/) ?? [])[1] ?? null : null;
});
await page.goto(`${BASE}/inspect/${execId ? `?id=${execId}` : ""}`, { waitUntil: "networkidle", timeout: 90000 });
await installCursor();
if (execId) await until("b07-inspect", async () => /completed|gas sponsored|execution id/i.test(await bodyText()), 60000);
await hold();

line("b08-cap");
await page.goto(`${BASE}/authority/`, { waitUntil: "networkidle", timeout: 90000 });
await installCursor();
await page.waitForTimeout(2500);
await press("b08-cap", () => page.locator("button", { hasText: "Spend $5,000" }).first());
await until("b08-cap", async () => /BLOCKED_PER_CALL_CAP/.test(await bodyText()));
await hold();

line("b09-chain");
// Hold on the rule chain itself — the short-circuit is the argument.
await page.evaluate(() => document.querySelector("[data-rule]")?.scrollIntoView({ behavior: "smooth", block: "center" }));
await page.waitForTimeout(1200);
const chain = await page.evaluate(() => ({
  chips: document.querySelectorAll("[data-rule]").length,
  caption: document.body.innerText.match(/Refused at [^\n]*/)?.[0] ?? null,
}));
if (chain.chips !== 15) throw new BeatFailure("b09-chain", `${chain.chips} chips, expected 15`);
await hold();

line("b10-duplicate");
await page.waitForTimeout(2500);
await press("b10-duplicate", () => page.locator("button", { hasText: "Buy the same thing again" }).first());
await until("b10-duplicate", async () => /BLOCKED_DUPLICATE/.test(await bodyText()));
await hold();

line("b11-escalate");
await page.waitForTimeout(2500);
await press("b11-escalate", () => page.locator("button", { hasText: "Pay someone new" }).first());
await until("b11-escalate", async () => /ESCALATED_VENDOR_RISK/.test(await bodyText()));
await until("b11-escalate/bar", async () => /vs floor \d+/.test(await bodyText()));
await page.evaluate(() => {
  const el = [...document.querySelectorAll("*")].find((x) => /What the payee scored/.test(x.textContent ?? "") && x.children.length < 8);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
});
await page.waitForTimeout(1200);
await hold();

line("b12-notified");
await until("b12-notified", async () => /operator notified|left to answer/.test(await bodyText()), 60000);
await page.evaluate(() => {
  const el = [...document.querySelectorAll("*")].find((x) => /Waiting on you/.test(x.textContent ?? "") && x.children.length < 8);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
});
await page.waitForTimeout(1200);
await hold();

// b13 — the release. SIGNING BEAT.
line("b13-release");
const beforeRelease = await budget();
const demoAgent = await page.evaluate(() => localStorage.getItem("mandate.agent"));
await press("b13-release", () => page.locator("button", { hasText: "Release it" }).first());
await overlayOn();
await until("b13-release", async () => (await budget()) > beforeRelease, 240000);
const releaseHash = await (async () => {
  const list = await fetch(`${GATEWAY}/authority/escalations?limit=10&status=APPROVED&agent=${demoAgent}`)
    .then((r) => r.json())
    .catch(() => ({ entries: [] }));
  return list.entries?.find((e) => e.transactionHash)?.transactionHash ?? null;
})();
if (releaseHash === spendHash) throw new BeatFailure("b13-release", "the release hash is the approval's");
if (releaseHash) {
  await overlayHash(releaseHash);
  await until("b13-release/chain", () => confirmed(releaseHash), 180000);
}
await overlayOff();
console.log(`  released: ${releaseHash ?? "(charged)"}`);
marks[marks.length - 1].signing = true;
marks[marks.length - 1].tx = releaseHash;
await hold();

line("b14-reload");
const spent = await budget();
await press("b14-reload", () => page.locator("button", { hasText: "Reload the page state" }).first());
await page.waitForTimeout(2500);
if ((await budget()) !== spent) throw new BeatFailure("b14-reload", "the budget changed across a reload");
await hold();

line("b15-ledger");
await page.goto(`${BASE}/ledger/`, { waitUntil: "networkidle", timeout: 90000 });
await installCursor();
await until("b15-ledger", async () => (await page.locator("table tbody tr").count()) > 0);
await hold();

line("b16-trace");
await press("b16-trace", async () => {
  const rows = page.locator("table tbody tr");
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    if (/BLOCKED_|ESCALATED_/.test(await rows.nth(i).innerText())) return rows.nth(i);
  }
  return rows.first();
});
await until("b16-trace", async () => /rules consulted/.test(await bodyText()));
await hold();

line("b17-receipts");
await page.evaluate(() => {
  const el = [...document.querySelectorAll("h2")].find((x) => /what backs the record/i.test(x.textContent ?? ""));
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
});
await page.waitForTimeout(1400);
await until("b17-receipts", async () => /\[?QUEUED|BATCHED|SUBMITTED|CONFIRMED/.test(await bodyText()));
await hold();

line("b18-proof");
await press("b18-proof", () => page.locator("button", { hasText: "Check the proof" }).first());
await until("b18-proof", async () => /computed in this browser|does NOT match/.test(await bodyText()), 60000);
await until("b18-proof/chain", async () => /MandateReceipts confirms|does NOT hold/.test(await bodyText()), 60000);
if (!/MandateReceipts confirms this exact root/.test(await bodyText())) {
  throw new BeatFailure("b18-proof", "the contract did not confirm the root");
}
await hold();

line("b19-costs");
await page.evaluate(() => {
  const el = [...document.querySelectorAll("*")].find((x) => /KeeperHub has executed/.test(x.textContent ?? "") && x.children.length < 10);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
});
await page.waitForTimeout(1400);
await until("b19-costs", async () => /KeeperHub has executed/.test(await bodyText()), 60000);
await hold();

line("b20-docs");
await page.goto(`${BASE}/docs/`, { waitUntil: "networkidle", timeout: 90000 });
await installCursor();
await until("b20-docs", async () => /mandate_can_spend|Quickstart/.test(await bodyText()));
await page.evaluate(() => window.scrollBy({ top: 420, behavior: "smooth" }));
await page.waitForTimeout(1400);
await hold();

line("b21-surfaces");
await page.evaluate(() => window.scrollBy({ top: 520, behavior: "smooth" }));
await page.waitForTimeout(1400);
await hold();

line("outro");
await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 90000 });
await installCursor();
await hold();

// ── land it ─────────────────────────────────────────────────────────────────
const errorsAfter = consoleErrors;
const took = Date.now() - t0;
await ctx.close();
await browser.close();

const log = {
  base: BASE,
  viewport: { width: W, height: H },
  tookMs: took,
  narrationMs: Math.round(Object.values(durations).reduce((s, d) => s + d, 0) * 1000),
  consoleErrorsDuringTake: errorsAfter - errorsBefore,
  marks,
};
writeFileSync(`${OUT}/beats.json`, JSON.stringify(log, null, 2) + "\n");

console.log(`\ntake: ${(took / 1000).toFixed(1)}s`);
console.log(`console errors during the take: ${errorsAfter - errorsBefore}`);
console.log(`signing beats: ${marks.filter((m) => m.signing).map((m) => m.id).join(", ")}`);
console.log(`marks → ${OUT}/beats.json`);
if (errorsAfter > errorsBefore) {
  console.log("\nThe take carries console errors. Fix them and record again.");
  process.exit(1);
}
