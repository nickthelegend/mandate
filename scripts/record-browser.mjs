/**
 * The browser half of the demo: the site, and the chain.
 *
 * Six beats, in one continuous take — the problem, the engine refusing a spend
 * in the visitor's own browser, a policy being written and its hash moving, the
 * anchoring transaction on Etherscan, the connect page, and the payment the
 * agent actually made. The terminal beats are recorded separately and the
 * editor interleaves them; each beat here is cut on its own mark, so the order
 * on screen does not have to be the order in the film.
 *
 * THE ONE CLOCK
 *
 * Every beat holds for the measured duration of its own narration line plus a
 * breath, read from `recording/audio-full/durations.json`. Nothing is timed by
 * eye, because an estimate a few hundred milliseconds out on each of seventeen
 * lines is fifteen seconds of drift by the end.
 *
 * NOTHING IS STAGED
 *
 * The pages are the production build. The decision engine runs client-side, so
 * the refusal on screen is computed in front of the viewer. The two Etherscan
 * pages are real transactions this project sent — the anchoring one and the
 * agent's own payment — and both were executed by KeeperHub's relayer, which is
 * the claim the whole film is making.
 *
 *   node scripts/record-browser.mjs
 */

import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = process.env.DEMO_ROOT
  ? process.env.DEMO_ROOT.replace(/\/?$/, "/")
  : fileURLToPath(new URL("../", import.meta.url));

const BASE = (process.env.DEMO_BASE ?? "http://localhost:4199").replace(/\/$/, "");
const EXPLORER = "https://sepolia.etherscan.io";
const W = 1440;
const H = 900;
const OUT = `${ROOT}recording`;
const BREATH_MS = 500;

/*
 * Real transactions from this project, both sent by KeeperHub's relayer.
 * ANCHOR registered the policy the agent obeys; SPEND is the payment the agent
 * made during the terminal take. Overridable so a fresh take can point at its
 * own transactions rather than at these.
 */
const ANCHOR_TX =
  process.env.DEMO_ANCHOR_TX ?? "0xb314c15cd7053e8f8a714043fe8562f2af1e84b83b67051c40f377a4486e0e0d";
const SPEND_TX =
  process.env.DEMO_SPEND_TX ?? "0x33e133b2d3b9defb4ec665acc483003ef35a2c6728e46d372af8d83b34907994";

const durations = JSON.parse(readFileSync(`${OUT}/audio-full/durations.json`, "utf8"));
mkdirSync(`${OUT}/browser`, { recursive: true });

const t0 = Date.now();
const marks = [];

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
  recordVideo: { dir: `${OUT}/browser`, size: { width: W, height: H } },
  // Etherscan serves a different page to an obviously-automated client.
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
});
const page = await ctx.newPage();

// ── cursor, ring, scroll ────────────────────────────────────────────────────

/*
 * An SVG cursor moved with requestAnimationFrame, never the hardware pointer.
 * A real pointer jumps between coordinates and can be stolen mid-take by a
 * notification — both of which end a take.
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
      left: "50px",
      top: "50px",
      zIndex: "2147483647",
      pointerEvents: "none",
      filter: "drop-shadow(0 2px 4px rgba(0,0,0,.35))",
    });
    document.body.appendChild(c);
    window.__cursorAt = { x: 50, y: 50 };
  });
}

async function glide(x, y, ms = 640) {
  await page.evaluate(
    ([tx, ty, dur]) =>
      new Promise((done) => {
        const c = document.getElementById("__cursor");
        if (!c) return done();
        const from = window.__cursorAt ?? { x: 0, y: 0 };
        const t0 = performance.now();
        // easeInOutCubic: a pointer that accelerates and settles reads as a
        // hand; linear motion reads as a script.
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const step = (now) => {
          const p = Math.min(1, (now - t0) / dur);
          const e = ease(p);
          const x = from.x + (tx - from.x) * e;
          const y = from.y + (ty - from.y) * e;
          c.style.left = `${x}px`;
          c.style.top = `${y}px`;
          window.__cursorAt = { x, y };
          p < 1 ? requestAnimationFrame(step) : done();
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

/**
 * Scroll on our own clock, not the browser's.
 *
 * `scrollIntoView({behavior:"smooth"})` is the obvious choice and it is wrong
 * here: its duration is decided by the engine, so a beat cannot be paced
 * against it, and it stops early when the target is already partly visible.
 * This eases a fixed distance over a stated time, which is both filmable and
 * repeatable.
 */
async function smoothScroll(toY, ms = 1800) {
  await page.evaluate(
    ([target, dur]) =>
      new Promise((done) => {
        const from = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const to = Math.max(0, Math.min(target, max));
        const t0 = performance.now();
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const step = (now) => {
          const p = Math.min(1, (now - t0) / dur);
          window.scrollTo(0, from + (to - from) * ease(p));
          p < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      }),
    [toY, ms]
  );
}

/**
 * Scroll an element to a comfortable reading position, smoothly.
 *
 * Resolved through a Playwright locator rather than `document.querySelector`,
 * so engine-only selectors like `:has-text()` work — passing one of those into
 * the page throws `not a valid selector`, since the browser only knows CSS.
 */
async function scrollTo(selector, { offset = 180, ms = 1800 } = {}) {
  const el = page.locator(selector).first();
  if (!(await el.count())) throw new BeatFailure("scrollTo", `nothing matches ${selector}`);
  const box = await el.boundingBox();
  if (!box) throw new BeatFailure("scrollTo", `${selector} has no box`);
  const y = await page.evaluate(([top, off]) => window.scrollY + top - off, [box.y, offset]);
  await smoothScroll(y, ms);
}

/**
 * Frame two elements so both are wholly visible.
 *
 * Scrolling to one of them is what broke the policy beat: the field being
 * edited sat at the top edge and the hash it changes was pushed off screen
 * entirely, so the shot showed a cause with no effect. This centres the union
 * of the two boxes, and only tightens to the taller one if they cannot both fit.
 */
async function frameBoth(a, b, ms = 1800) {
  const boxes = [];
  for (const sel of [a, b]) {
    const el = page.locator(sel).first();
    if (!(await el.count())) throw new BeatFailure("frameBoth", `nothing matches ${sel}`);
    const box = await el.boundingBox();
    if (!box) throw new BeatFailure("frameBoth", `${sel} has no box`);
    boxes.push(box);
  }
  const top = Math.min(...boxes.map((x) => x.y));
  const bottom = Math.max(...boxes.map((x) => x.y + x.height));
  const y = await page.evaluate(
    ([t, b, h]) => {
      const span = b - t;
      // Centre the pair when they fit; otherwise pin the top with a margin, so
      // whatever is cut is the bottom rather than the thing being pointed at.
      const margin = span < h ? (h - span) / 2 : 80;
      return window.scrollY + t - margin;
    },
    [top, bottom, H]
  );
  await smoothScroll(y, ms);
}

/**
 * Click without letting the browser scroll the page underneath the shot.
 *
 * Focusing an input makes the engine scroll it into view on its own terms,
 * which jumped the policy beat a hundred pixels mid-take and sliced the top off
 * the frame. The intended position is restored on the next frame.
 */
async function lockedClick(el) {
  const before = await page.evaluate(() => window.scrollY);
  await el.click();
  await page.evaluate((y) => window.scrollTo(0, y), before);
}

/** Move to an element, ring it, click it. */
async function press(label, selector) {
  const el = page.locator(selector).first();
  if (!(await el.count())) throw new BeatFailure(label, `nothing matches ${selector}`);
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (!box) throw new BeatFailure(label, "the target has no box");
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await glide(x, y, 620);
  await ring(x, y);
  await page.waitForTimeout(150);
  await el.click();
}

/**
 * Take the explorer's cookie banner out of the shot.
 *
 * Hidden rather than accepted: clicking "Got it" would be consenting to
 * third-party cookies on the operator's behalf to make a video look tidier,
 * which is not a trade this script gets to make. Hiding the element changes
 * only what the camera sees.
 */
async function hideCookieBanner() {
  await page.addStyleTag({
    content: `#cookieconsent, .cookie-consent, #cookies, [class*="cookieConsent"],
              [id*="cookieconsent"], .fixed-bottom.bg-light { display: none !important; }`,
  });
}

let currentBeat = null;
function line(id) {
  const at = Date.now() - t0;
  currentBeat = { id, at };
  marks.push(currentBeat);
  console.log(`  ${(at / 1000).toFixed(1).padStart(6)}s  ${id}`);
}

/** Hold for this beat's measured narration plus a breath, minus what it has already spent. */
async function hold(spentMs = 0) {
  const secs = durations[currentBeat?.id];
  if (secs === undefined) throw new BeatFailure(currentBeat?.id ?? "unknown", "no measured duration");
  const left = Math.round(secs * 1000) + BREATH_MS - spentMs;
  if (left > 0) await page.waitForTimeout(left);
}

/** Everything a beat does costs time; this measures it so `hold` can subtract it. */
async function timed(fn) {
  const start = Date.now();
  await fn();
  return Date.now() - start;
}

// ── the take ────────────────────────────────────────────────────────────────

console.log(`recording browser · ${BASE}\n`);

/* 1. The problem, stated. */
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1800); // the hero video's first loop
await installCursor();
line("problem");
{
  const spent = await timed(async () => {
    await page.waitForTimeout(6500); // the headline, read
    await smoothScroll(430, 2600); // down to the live totals in the tray
    await page.waitForTimeout(2200);
  });
  await hold(spent);
}

/* 2. The engine, refusing in the visitor's own browser. */
line("try-it");
{
  const spent = await timed(async () => {
    await scrollTo("h2:has-text('Try to overspend')", { offset: 120, ms: 2000 });
    await page.waitForTimeout(1400);
    /*
     * The five-thousand-dollar case, chosen by its label rather than by index
     * so reordering the demo cannot silently change which refusal the narration
     * is describing. It is deliberately the same number a prompt-injected agent
     * asks for later in the film: first the engine refuses it in the abstract,
     * then a real agent is talked into asking and refused anyway.
     */
    await press("try-it", "button:has-text('Agent tries to spend $5,000')");
    await page.waitForTimeout(2600);
    await smoothScroll(await page.evaluate(() => window.scrollY + 260), 1400);
    await page.waitForTimeout(1800);
  });
  await hold(spent);
}

/* 3. A policy being written, and its hash moving. */
await page.goto(`${BASE}/policy/`, { waitUntil: "networkidle" });
await installCursor();
await page.waitForTimeout(900);
line("policy-build");
{
  const spent = await timed(async () => {
    /*
     * Framed so the field being edited and the hash it changes are both fully
     * on screen at once — the beat is the causal link between them, and it is
     * unwatchable if either is cut off by the top edge.
     */
    await frameBoth("input[type=number]", ".card-p:has-text('keccak256')", 1900);
    await page.waitForTimeout(2400);

    const daily = page.locator("input[type=number]").first();
    const box = await daily.boundingBox();
    await glide(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2), 620);
    await ring(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
    await lockedClick(daily);
    await page.waitForTimeout(500);

    /*
     * Select the whole field, then type the new number a digit at a time.
     *
     * `End` does not move the caret in a number input, so an earlier version
     * typed the digit at position zero: 5 became "05", which is still five, so
     * the hash never moved and the beat silently asserted nothing. Replacing
     * the selection is caret-independent. Typing "5" first re-enters the same
     * value — the badge correctly stays ANCHORED — and the second keystroke is
     * the one that flips it, which is exactly the story being told.
     */
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.waitForTimeout(400);
    await page.keyboard.type("5");
    await page.waitForTimeout(900);
    await page.keyboard.type("0");
    await page.waitForTimeout(1200);

    /* The take fails here rather than shipping a beat whose narration is a lie. */
    const flipped = await page.locator("text=NOT ANCHORED").count();
    const value = await daily.inputValue();
    if (value !== "50" || !flipped) {
      throw new BeatFailure("policy-build", `field is "${value}" and NOT ANCHORED is ${flipped ? "shown" : "absent"}`);
    }
    await page.waitForTimeout(3600); // the reason, read

    // And back, so the film leaves the policy as it found it.
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.waitForTimeout(300);
    await page.keyboard.type("5");
    await page.waitForTimeout(2400);
  });
  await hold(spent);
}

/* 3b. Deploying that budget — one command, run by KeeperHub. */
line("deploy");
{
  const spent = await timed(async () => {
    await scrollTo(".card-p:has-text('Then put it on chain')", { offset: 240, ms: 1800 });
    await page.waitForTimeout(2200);
    await press("deploy", "button:has-text('node scripts/new-policy.mjs')");
    await page.waitForTimeout(3000);
    await smoothScroll(await page.evaluate(() => window.scrollY + 300), 1600);
    await page.waitForTimeout(2400);
  });
  await hold(spent);
}

/* 4. The anchoring transaction, on the explorer. */
await page.goto(`${EXPLORER}/tx/${ANCHOR_TX}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4500);
await hideCookieBanner();
await installCursor();
line("explorer-anchor");
{
  const spent = await timed(async () => {
    await page.waitForTimeout(2200);
    await smoothScroll(300, 2400); // From / To, where the relayer shows
    await page.waitForTimeout(3200);
    await smoothScroll(560, 2000);
    await page.waitForTimeout(2000);
  });
  await hold(spent);
}

/* 5. Connecting an agent. */
await page.goto(`${BASE}/connect/`, { waitUntil: "networkidle" });
await installCursor();
await page.waitForTimeout(1400); // the live check resolves
line("connect");
{
  const spent = await timed(async () => {
    await page.waitForTimeout(2600);
    await scrollTo("pre", { offset: 200, ms: 1900 }); // the config
    await page.waitForTimeout(3400);
    await smoothScroll(await page.evaluate(() => window.scrollY + 420), 1800); // the seven tools
    await page.waitForTimeout(4200);
  });
  await hold(spent);
}

/* 6. The payment the agent made. */
await page.goto(`${EXPLORER}/tx/${SPEND_TX}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(4500);
await hideCookieBanner();
await installCursor();
line("explorer-spend");
{
  const spent = await timed(async () => {
    await page.waitForTimeout(2000);
    await smoothScroll(300, 2200);
    await page.waitForTimeout(2600);
    await smoothScroll(520, 2000); // the ERC-20 transfer row
    await page.waitForTimeout(3000);
  });
  await hold(spent);
}

/* 7. The file itself, walked step by step. */
await page.goto(`${BASE}/connect/`, { waitUntil: "networkidle" });
await installCursor();
await page.waitForTimeout(900);
await press("sdk-tab", "button:has-text('Write an agent')");
await page.waitForTimeout(1100);
line("sdk");
{
  const spent = await timed(async () => {
    await scrollTo("table", { offset: 90, ms: 1700 });
    await page.waitForTimeout(1600);

    /*
     * One pass down the marked steps. The cursor moves quickly and rests on
     * each — the narration is doing the explaining, and a pointer that lingers
     * reads as hesitation rather than emphasis. Rows are found by the same
     * `data-step` the component sets, so a change to the file cannot leave the
     * pointer indicating the wrong lines.
     */
    for (let step = 1; step <= 5; step++) {
      const row = page.locator(`tr[data-step="${step}"]`).first();
      if (!(await row.count())) throw new BeatFailure("sdk", `no line marked step ${step}`);
      await row.scrollIntoViewIfNeeded();
      const box = await row.boundingBox();
      if (!box) throw new BeatFailure("sdk", `step ${step} has no box`);
      const x = Math.round(box.x + Math.min(box.width - 40, 320));
      const y = Math.round(box.y + box.height / 2);
      await glide(x, y, 430);
      await ring(x, y);
      await page.waitForTimeout(step === 5 ? 3400 : 2600);
    }
  });
  await hold(spent);
}

line("end");
await page.waitForTimeout(1200);

await ctx.close();
await browser.close();

const took = Date.now() - t0;
writeFileSync(
  `${OUT}/browser-beats.json`,
  JSON.stringify({ base: BASE, anchorTx: ANCHOR_TX, spendTx: SPEND_TX, tookMs: took, marks }, null, 2)
);
console.log(`\n${(took / 1000).toFixed(1)}s → recording/browser/`);
