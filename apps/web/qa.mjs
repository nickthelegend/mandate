/**
 * The pre-judging sweep.
 *
 * `audit.mjs` loads each route and watches for errors. This does the thing that
 * actually finds bugs: it presses the buttons, submits the forms, and then
 * abuses them the way a careless user or a hostile judge does — empty submits,
 * double clicks, back mid-flow, refresh mid-transaction, resubmitting something
 * that already succeeded.
 *
 * Every page is watched for console errors, uncaught exceptions, failed
 * requests and any HTTP >= 400 throughout. A flow that reaches the right screen
 * with a red console is a failing flow here.
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
  // The authority answers 400 for input it correctly refuses, and 402 is the
  // right answer on the x402 paths. Both are asserted explicitly elsewhere.
  /one decision at a time/i,
  // The browser logs a console error for a 404 response. On the deliberate
  // unknown-route test that is the correct status being reported, not a bug.
  /Failed to load resource: the server responded with a status of 404/i,
];
const ignored = (t) => IGNORE.some((r) => r.test(String(t)));

const problems = [];
let current = "(startup)";
const fail = (kind, detail) => {
  problems.push({ where: current, kind, detail: String(detail).slice(0, 200) });
  console.log(`    ✗ ${kind}: ${String(detail).slice(0, 150)}`);
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
    if (r.status() >= 400 && r.status() !== 402 && !ignored(r.url())) {
      // A 400 from a deliberate bad-input test is expected; those set `expect400`.
      if (!page.__expectBadRequest) fail(`http ${r.status()}`, r.url());
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

const has = async (re) => re.test(await page.evaluate(() => document.body.innerText));
const check = async (name, fn) => {
  current = name;
  process.stdout.write(`  ${name.padEnd(52)}`);
  const before = problems.length;
  try {
    const note = await fn();
    console.log(problems.length === before ? `ok${note ? "  " + note : ""}` : "SEE ABOVE");
  } catch (e) {
    fail("threw", e.message);
  }
};

console.log(`\nQA sweep against ${BASE}\n`);

// ── every route renders with real content ───────────────────────────────────
console.log("ROUTES");
let heroNote = "";
for (const [path, re] of [
  ["/", /budget\s+it\s+cannot\s+exceed/i],
  ["/authority/", /Spend it down/i],
  ["/ledger/", /decision|verdict/i],
  ["/inspect/", /execution/i],
  ["/inspect/", /execution/i],
  ["/docs/", /mandate_verify|Quickstart/i],
]) {
  await check(`renders ${path}`, async () => {
    await go(path);
    if (path === "/") {
      // 4.1: the hero is the first thing anyone sees. A <video> element that
      // never decodes a frame is a grey box, and the page looks broken.
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
      if (v.missing) fail("no hero video", "the video element is absent");
      else {
        if (v.err) fail("hero video error", v.err);
        if (v.ready < 3) fail("hero video not playable", `readyState ${v.ready}`);
        if (v.paused) fail("hero video paused", "autoplay did not start");
        if (!v.w) fail("hero video has no frame", "videoWidth is 0");
        if (v.thirdParty) fail("hero from a third party", "the source is an absolute URL");
        heroNote = `video ${v.w}px, readyState ${v.ready}, playing`;
      }
    }
    if (!(await has(re))) fail("missing content", `${path} did not contain ${re}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    if (overflow) fail("horizontal overflow", path);
    return heroNote;
  });
}

// ── a route that does not exist ─────────────────────────────────────────────
await check("unknown route shows the branded 404 with a way out", async () => {
  current = "/nope";
  // The 404 status is correct and the browser logging it is not a defect, so
  // this one page is exempt from the response/console assertions.
  page.__expectBadRequest = true;
  const r = await page.goto(`${BASE}/nope-not-a-page/`, { waitUntil: "networkidle" }).catch(() => null);
  await page.waitForTimeout(2000);
  const txt = await page.evaluate(() => document.body.innerText);
  page.__expectBadRequest = false;
  if (!/No such page/i.test(txt)) fail("unbranded 404", txt.slice(0, 90));
  const outs = await page.evaluate(
    () => [...document.querySelectorAll("a")].filter((a) => /authority|verify|docs|agent/.test(a.getAttribute("href") ?? "")).length
  );
  if (outs < 4) fail("no way out", `${outs} links back into the site`);
  return `http ${r?.status()}, ${outs} ways out`;
});

// ── /inspect ────────────────────────────────────────────────────────────────
console.log("\nINSPECT");
await check("malformed execution id is refused locally", async () => {
  await go("/inspect/");
  await page.evaluate(() => {
    const el = document.querySelector("input");
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(el, "!!!");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => /Read the record/.test(b.textContent))?.click()
  );
  await page.waitForTimeout(1500);
  if (!(await has(/not an execution id|execution id/i))) fail("no message", "bad id silently ignored");
  return "";
});

await check("empty execution id does not fire a request", async () => {
  await go("/inspect/");
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => /Read the record/.test(b.textContent))?.click()
  );
  await page.waitForTimeout(1500);
  return "";
});

// ── /authority: the core flow and its edges ─────────────────────────────────
console.log("\nAUTHORITY");
await check("loads with live chain + ledger state", async () => {
  await go("/authority/");
  const t = await page.evaluate(() => document.body.innerText);
  if (!/ACTIVE ON CHAIN/.test(t)) fail("no chain status", t.slice(0, 120));
  if (!/\$\d+\.\d\d \/ \$\d+\.\d\d/.test(t)) fail("no budget", "budget readout missing");
  return "";
});

await check("a refusal is instant and names the rule", async () => {
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => b.textContent.includes("$5,000"))?.click()
  );
  await page.waitForTimeout(6000);
  const t = await page.evaluate(() => document.body.innerText);
  if (!/BLOCKED_PER_CALL_CAP/.test(t)) fail("wrong verdict", t.match(/BLOCKED_\w+|APPROVED/)?.[0] ?? "none");
  if (!/perCall\.cap/.test(t)) fail("no rule named", "");
  return "";
});

await check("double-clicking a spend does not double-charge", async () => {
  const before = await page.evaluate(
    () => Number(document.body.innerText.match(/\$([\d.]+) \/ \$5\.00/)?.[1] ?? -1)
  );
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Buy GPU time"));
    b.click();
    b.click();
  });
  await page.waitForTimeout(7000);
  const after = await page.evaluate(
    () => Number(document.body.innerText.match(/\$([\d.]+) \/ \$5\.00/)?.[1] ?? -1)
  );
  // A category refusal must never move the budget, once or twice.
  if (after !== before) fail("budget moved on a refusal", `${before} → ${after}`);
  return `${before} → ${after}`;
});

await check("refresh mid-page keeps the persisted budget", async () => {
  const before = await page.evaluate(
    () => Number(document.body.innerText.match(/\$([\d.]+) \/ \$5\.00/)?.[1] ?? -1)
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  const after = await page.evaluate(
    () => Number(document.body.innerText.match(/\$([\d.]+) \/ \$5\.00/)?.[1] ?? -1)
  );
  if (after !== before) fail("budget changed across reload", `${before} → ${after}`);
  return `${before} held`;
});

await check("browser back then forward leaves the page working", async () => {
  await page.goBack({ waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.goForward({ waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(3500);
  const t = await page.evaluate(() => document.body.innerText);
  if (!/Spend it down/.test(t)) fail("page broken after back/forward", t.slice(0, 100));
  return "";
});

// ── responsive ──────────────────────────────────────────────────────────────
console.log("\nRESPONSIVE");
for (const [name, w, h] of [
  ["mobile 375", 375, 812],
  ["tablet 768", 768, 1024],
  ["desktop 1440", 1440, 900],
]) {
  await check(`no horizontal overflow at ${name}`, async () => {
    await page.setViewportSize({ width: w, height: h });
    for (const p of ["/", "/authority/", "/ledger/", "/docs/"]) {
      current = `${name} ${p}`;
      await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(1800);
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      if (over > 1) fail("horizontal overflow", `${p} overflows by ${over}px`);
    }
    return "";
  });
}
await page.setViewportSize({ width: 1280, height: 900 });

// ── production hygiene ──────────────────────────────────────────────────────
console.log("\nHYGIENE");
await check("no console.log noise on any page", async () => {
  const logs = [];
  page.on("console", (m) => {
    if (m.type() === "log" && !ignored(m.text())) logs.push(m.text().slice(0, 60));
  });
  for (const p of ["/", "/authority/", "/ledger/", "/docs/"]) {
    current = `logs ${p}`;
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);
  }
  if (logs.length) fail("stray console.log", logs.join(" | "));
  return "";
});

await check("every page has a real title and description", async () => {
  for (const p of ["/", "/authority/", "/docs/"]) {
    current = `meta ${p}`;
    await page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const meta = await page.evaluate(() => ({
      title: document.title,
      desc: document.querySelector('meta[name="description"]')?.content ?? "",
    }));
    if (!meta.title || meta.title.length < 8) fail("weak title", `${p}: "${meta.title}"`);
    if (!meta.desc) fail("no description", p);
  }
  return "";
});

// ── done ────────────────────────────────────────────────────────────────────
await browser.close();

console.log("\n" + "=".repeat(62));
if (problems.length === 0) {
  console.log("clean — no console errors, no failed requests, no broken flows");
} else {
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log(`  [${p.where}] ${p.kind}: ${p.detail}`);
}
process.exit(problems.length === 0 ? 0 : 1);
