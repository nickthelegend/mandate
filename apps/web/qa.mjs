/**
 * TESTPLAN sections 4 and 5 — the pages, and what happens when they are abused.
 *
 * Section 4 is "does every page render what it claims to". Section 5 is the
 * part that actually finds bugs: empty submits, double clicks, back mid-flow,
 * refresh mid-transaction, pressing a button the instant it appears.
 *
 * Every page is watched for console errors, uncaught exceptions, failed
 * requests and any HTTP >= 400 throughout, and a page that reaches the right
 * screen with a red console fails its item. Item ids match TESTPLAN.md.
 *
 *   node qa.mjs [baseUrl]
 */

import { chromium } from "playwright";

const BASE = (process.argv[2] ?? "https://nickthelegend.github.io/mandate").replace(/\/$/, "");
const GATEWAY = process.env.GATEWAY_URL ?? "https://gateway-production-944e.up.railway.app";

/** Noise that is genuinely not the app's fault. Kept tight on purpose. */
const IGNORE = [
  /favicon/i,
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  // Public RPCs push back under a burst of automated loads. That is the
  // endpoint rate-limiting us, not a defect in the page.
  /429|Too Many Requests|rate limit/i,
  // The authority answers 400 for input it correctly refuses. Asserted
  // explicitly in qa-infra rather than treated as a page defect here.
  /one decision at a time/i,
  // The browser logs a console error for a 404 response. On the deliberate
  // unknown-route test that is the correct status being reported, not a bug.
  /Failed to load resource: the server responded with a status of 404/i,
];
const ignored = (t) => IGNORE.some((r) => r.test(String(t)));

const results = [];
let current = "(startup)";
const problems = [];
const fail = (kind, detail) => {
  problems.push({ where: current, kind, detail: String(detail).slice(0, 200) });
};

function watch(page) {
  page.on("console", (m) => {
    if (m.type() === "error" && !ignored(m.text())) fail("console error", m.text());
  });
  page.on("pageerror", (e) => {
    if (!ignored(e.message)) fail("uncaught exception", e.message);
  });
  page.on("requestfailed", (r) => {
    const t = `${r.url()} ${r.failure()?.errorText ?? ""}`;
    if (!ignored(t)) fail("request failed", t);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !ignored(r.url()) && !page.__expectBadRequest) {
      fail(`http ${r.status()}`, r.url());
    }
  });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
watch(page);

const go = async (path) => {
  current = path;
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2500);
};
const text = () => page.evaluate(() => document.body.innerText);
const has = async (re) => re.test(await text());

/** One plan item. Anything the watchers caught while it ran belongs to it. */
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

console.log(`\nTESTPLAN 4 and 5 against ${BASE}\n`);

// ── 4. Pages ────────────────────────────────────────────────────────────────
console.log("4. PAGES");

await item("4.1", async () => {
  await go("/");
  if (!(await has(/budget\s+it\s+cannot\s+exceed/i))) fail("missing content", "the headline is not on the page");
  // A <video> element that never decodes a frame is a grey box, and the page
  // looks broken to the one person whose first impression decides everything.
  const v = await page.evaluate(() => {
    const el = document.querySelector("video");
    if (!el) return { missing: true };
    return {
      ready: el.readyState,
      paused: el.paused,
      w: el.videoWidth,
      err: el.error?.message ?? null,
      thirdParty: /^https?:/.test(el.querySelector("source")?.getAttribute("src") ?? ""),
    };
  });
  if (v.missing) return fail("no hero video", "the video element is absent");
  if (v.err) fail("hero video error", v.err);
  if (v.ready < 3) fail("hero video not playable", `readyState ${v.ready}`);
  if (v.paused) fail("hero video paused", "autoplay did not start");
  if (!v.w) fail("hero video has no frame", "videoWidth is 0");
  if (v.thirdParty) fail("hero from a third party", "the source is an absolute URL");
  return `headline renders, video ${v.w}px, readyState ${v.ready}, playing`;
});

await item("4.2", async () => {
  // The homepage states the authority's standing totals. A zero here is the
  // page claiming the authority has never decided anything.
  const live = await fetch(`${GATEWAY}/authority`).then((r) => r.json());
  const shown = (await text()).match(/(\d+)\s*\n?\s*Decisions/i)?.[1];
  if (!shown) return fail("no totals", "the homepage shows no decision count");
  if (Number(shown) === 0) fail("zero totals", "the homepage claims zero decisions");
  if (Number(shown) !== live.totals.total) {
    fail("totals disagree", `page shows ${shown}, the authority reports ${live.totals.total}`);
  }
  return `${shown} decisions, matching the authority`;
});

await item("4.3", async () => {
  await go("/authority/");
  const t = await text();
  if (!/ACTIVE ON CHAIN/.test(t)) fail("no chain status", t.slice(0, 120));
  if (!/\$\d+\.\d\d \/ \$\d+\.\d\d/.test(t)) fail("no budget", "the budget readout is missing");
  const cases = await page.evaluate(
    () => [...document.querySelectorAll("button")].filter((b) => /Buy|Spend|Pay/.test(b.textContent)).length
  );
  if (cases < 5) fail("too few spend cases", `${cases} buttons, expected at least 5`);
  if (!/decision|verdict|refused|approved/i.test(t)) fail("no decision log", "");
  return `ACTIVE on chain, budget shown, ${cases} spend cases`;
});

await item("4.4", async () => {
  await go("/ledger/");
  const t = await text();
  const rows = (t.match(/BLOCKED_\w+|APPROVED|ESCALATED_\w+/g) ?? []).length;
  if (rows === 0) return fail("no decisions", "the ledger shows no decision on any row");
  // The count in the header must match what is actually on the page, or the
  // page is asserting a number it did not render.
  const claimed = Number(t.match(/the last (\d+) decisions?/)?.[1] ?? -1);
  if (claimed !== rows) fail("count disagrees", `header claims ${claimed}, ${rows} rows rendered`);
  // Three states, in this product's vocabulary — not the removed one's.
  if (/Not proven|Awaiting|\bProven\b/.test(t)) fail("stale vocabulary", "the ledger still says proven/not proven");
  if (!/Refused|Approved|Held/.test(t)) fail("no verdict marks", "");
  return `${rows} decisions, header agrees, approved/refused/held`;
});

await item("4.5", async () => {
  await go("/inspect/");
  if (!(await has(/execution/i))) fail("missing content", "no mention of an execution");
  return "renders";
});

await item("4.6", async () => {
  await go("/docs/");
  const t = await text();
  if (!/Quickstart/i.test(t)) fail("no quickstart", "");
  const tools = (t.match(/mandate_\w+/g) ?? []).filter((v, i, a) => a.indexOf(v) === i);
  if (tools.length < 7) fail("tools undocumented", `${tools.length} of 7 named: ${tools.join(", ")}`);
  return `quickstart plus ${tools.length} tools documented`;
});

await item("4.7", async () => {
  // The 404 status is correct and the browser logging it is not a defect, so
  // this one page is exempt from the response assertion.
  page.__expectBadRequest = true;
  const r = await page.goto(`${BASE}/nope-not-a-page/`, { waitUntil: "networkidle" }).catch(() => null);
  await page.waitForTimeout(2000);
  const t = await text();
  page.__expectBadRequest = false;
  if (!/No such page/i.test(t)) fail("unbranded 404", t.slice(0, 90));
  const outs = await page.evaluate(
    () =>
      [...document.querySelectorAll("a")].filter((a) =>
        /authority|ledger|inspect|docs/.test(a.getAttribute("href") ?? "")
      ).length
  );
  if (outs < 4) fail("no way out", `${outs} links back into the site`);
  return `http ${r?.status()}, ${outs} ways out`;
});

const PAGES = ["/", "/authority/", "/ledger/", "/inspect/", "/docs/"];

await item("4.8", async () => {
  for (const p of PAGES) {
    current = `4.8 ${p}`;
    await page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const meta = await page.evaluate(() => ({
      title: document.title,
      desc: document.querySelector('meta[name="description"]')?.content ?? "",
    }));
    if (!meta.title || meta.title.length < 8) fail("weak title", `${p}: "${meta.title}"`);
    if (!meta.desc) fail("no description", p);
  }
  return `${PAGES.length} pages, all with a title and a description`;
});

await item("4.9", async () => {
  for (const [name, w, h] of [
    ["375", 375, 812],
    ["768", 768, 1024],
    ["1440", 1440, 900],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    for (const p of PAGES) {
      current = `4.9 ${name} ${p}`;
      await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(1500);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) fail("horizontal overflow", `${p} overflows by ${over}px at ${name}`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  return "no overflow at 375, 768 or 1440";
});

await item("4.10", async () => {
  const logs = [];
  const listener = (m) => {
    if (m.type() === "log" && !ignored(m.text())) logs.push(m.text().slice(0, 60));
  };
  page.on("console", listener);
  for (const p of PAGES) {
    current = `4.10 ${p}`;
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);
  }
  page.off("console", listener);
  if (logs.length) fail("stray console.log", logs.join(" | "));
  return "no console.log on any page";
});

await item("4.11", async () => {
  /*
   * Hrefs already carry the deployment's basePath, so they are resolved
   * against the ORIGIN, not against BASE. Joining them to BASE produces
   * /mandate/mandate/… and every link "fails" — a harness bug that reads
   * exactly like a broken site.
   */
  const origin = new URL(BASE).origin;
  const seen = new Set();
  for (const p of PAGES) {
    current = `4.11 ${p}`;
    await page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    for (const h of await page.evaluate(() =>
      [...document.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "")
    )) {
      if (h.startsWith("/")) seen.add(h);
      else if (h.startsWith(origin)) seen.add(new URL(h).pathname);
    }
  }
  const dead = [...seen].filter((h) => /\/(demo|agent|article|audit|verify|claim|explorer|settle)(\/|$)/.test(h));
  if (dead.length) fail("link to a deleted route", dead.join(", "));
  const bad = [];
  for (const h of seen) {
    const r = await fetch(`${origin}${h}`);
    if (!r.ok) bad.push(`${h} → ${r.status}`);
  }
  if (bad.length) fail("broken internal link", bad.join(", "));
  return `${seen.size} internal links, all resolve`;
});

// ── 5. Interaction edges ────────────────────────────────────────────────────
console.log("\n5. INTERACTION EDGES");

const pressInspect = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => /Read the record/.test(b.textContent))?.click()
  );

await item("5.1", async () => {
  await go("/inspect/");
  let fired = 0;
  const spy = (r) => r.url().includes("/execution/") && fired++;
  page.on("request", spy);
  await page.evaluate(() => {
    const el = document.querySelector("input");
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(el, "!!!");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await pressInspect();
  await page.waitForTimeout(1500);
  page.off("request", spy);
  if (!(await has(/not an execution id|execution id/i))) fail("no message", "a bad id was silently ignored");
  if (fired) fail("request fired", `${fired} request(s) sent for input the client can reject`);
  return "refused locally, no request";
});

await item("5.2", async () => {
  await go("/inspect/");
  let fired = 0;
  const spy = (r) => r.url().includes("/execution/") && fired++;
  page.on("request", spy);
  await pressInspect();
  await page.waitForTimeout(1500);
  page.off("request", spy);
  if (fired) fail("request fired", "an empty id was sent to the authority");
  return "nothing sent";
});

const budget = async () => Number((await text()).match(/\$([\d.]+) \/ \$5\.00/)?.[1] ?? -1);

await item("5.3", async () => {
  await go("/authority/");
  const before = await budget();
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Buy GPU time/.test(x.textContent));
    b.click();
    b.click();
  });
  await page.waitForTimeout(8000);
  const after = await budget();
  // A category refusal must never move the budget, once or twice.
  if (after !== before) fail("budget moved on a refusal", `${before} → ${after}`);
  const verdicts = await page.evaluate(() => document.querySelectorAll(".verdict").length);
  if (verdicts > 2) fail("two decisions", `${verdicts} verdict elements after a double click`);
  return `one decision, budget held at $${after}`;
});

await item("5.4", async () => {
  const before = await budget();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  const after = await budget();
  if (after < before) fail("budget went backwards", `${before} → ${after}`);
  if (!(await has(/Spend it down/))) fail("page broken after reload", "");
  return `recovered, budget $${after}`;
});

await item("5.5", async () => {
  await page.goBack({ waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.goForward({ waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(3500);
  if (!(await has(/Spend it down/))) fail("page broken after back/forward", (await text()).slice(0, 100));
  return "still working";
});

/**
 * A fresh context, so a fresh agent, holding one escalation it raised itself.
 *
 * The approval code exists only in the component's state — it is returned once
 * at creation and only its sha256 is stored — so the only way to get a
 * releasable row is to raise it through the UI. Both items below need that.
 */
async function heldInFreshBrowser() {
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await c.newPage();
  watch(p);
  await p.goto(`${BASE}/authority/`, { waitUntil: "networkidle", timeout: 90000 });
  await p.waitForTimeout(3500);
  await p.locator("button", { hasText: "Pay someone new" }).first().click();
  await p
    .locator("button", { hasText: "Release it" })
    .first()
    .waitFor({ state: "visible", timeout: 120000 });
  return { c, p };
}

await item("5.6", async () => {
  /*
   * Press Release the instant it appears, with no settling wait.
   *
   * The bug this guards is a shared in-flight ref: the optimistic update
   * renders the button while the reconciling refetch still holds the lock, so
   * the first click is swallowed and the user presses a live button that does
   * nothing.
   */
  const { c, p } = await heldInFreshBrowser();
  try {
    let sent = 0;
    const spy = (r) => r.url().includes("/resolve") && sent++;
    p.on("request", spy);
    await p.locator("button", { hasText: "Release it" }).first().click();
    await p.waitForTimeout(5000);
    p.off("request", spy);
    if (sent === 0) fail("click swallowed", "pressing Release the instant it appeared sent nothing");
    return `release sent on the first click (${sent} request)`;
  } finally {
    await c.close();
  }
});

await item("5.7", async () => {
  /*
   * The same held spend after a reload. The code was in memory and is now gone,
   * so the row must explain that rather than render a button that cannot work.
   */
  const { c, p } = await heldInFreshBrowser();
  try {
    await p.reload({ waitUntil: "networkidle" });
    await p.waitForTimeout(6000);
    const t = await p.evaluate(() => document.body.innerText);
    if (!/Waiting on you/i.test(t)) fail("held spend invisible", "the row does not survive a reload");
    const releasable = await p.locator("button", { hasText: "Release it" }).count();
    if (releasable > 0) fail("dead button", "a row with no code still offers Release");
    if (!/earlier session/i.test(t)) fail("no explanation", "the row does not say why it cannot be released");
    return "shown, unreleasable, and says why";
  } finally {
    await c.close();
  }
});

// ── done ────────────────────────────────────────────────────────────────────
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log("\n" + "=".repeat(64));
console.log(`${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.log("\nFAILED:");
  for (const f of failed) console.log(`  ${f.id}  ${f.note}`);
}
process.exit(failed.length === 0 ? 0 : 1);
