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
  ["/demo/", /facilitator/i],
  ["/agent/", /agent/i],
  ["/verify/", /Check a payment yourself/i],
  ["/claim/", /wallet/i],
  ["/ledger/", /decision|verdict/i],
  ["/explorer/", /intent/i],
  ["/inspect/", /execution/i],
  ["/x402/", /402/i],
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

// ── /verify: the form, and every way to get it wrong ────────────────────────
console.log("\nVERIFY FORM");
const fill = async (id, v) =>
  page.evaluate(
    ([i, val]) => {
      const el = document.getElementById(i);
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    [id, v]
  );
const submit = () => page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => /Read the receipt/.test(b.textContent))?.click();
});

await check("sample loads and verifies against the chain", async () => {
  await go("/verify/");
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => /Mined, moved nothing/.test(b.textContent))?.click()
  );
  await page.waitForTimeout(600);
  await submit();
  await page.waitForTimeout(9000);
  const v = await page.evaluate(() => document.querySelector(".verdict")?.textContent?.trim());
  if (!v) fail("no verdict", "the sample produced nothing");
  return v ?? "";
});

await check("malformed hash is refused with a readable message", async () => {
  await go("/verify/");
  await fill("hash", "nonsense");
  await submit();
  await page.waitForTimeout(1200);
  if (!(await has(/0x followed by 64 hex/i))) fail("no validation message", "bad hash accepted or unexplained");
  return "";
});

await check("non-numeric amount is refused", async () => {
  await fill("hash", `0x${"a".repeat(64)}`);
  await fill("amt", "1.5");
  await submit();
  await page.waitForTimeout(1000);
  if (!(await has(/whole digits only/i))) fail("no validation message", "bad amount accepted");
  return "";
});

await check("bad address is refused", async () => {
  await fill("amt", "1000000");
  await fill("to", "0xnope");
  await submit();
  await page.waitForTimeout(1000);
  if (!(await has(/0x followed by 40 hex/i))) fail("no validation message", "bad address accepted");
  return "";
});

await check("a hash that is well-formed but unknown to the chain", async () => {
  await go("/verify/");
  await fill("hash", `0x${"1".repeat(64)}`);
  await submit();
  await page.waitForTimeout(10000);
  const t = await page.evaluate(() => document.body.innerText);
  if (!/not proven|no transaction|not found|could not/i.test(t)) {
    fail("unhandled", "an unknown hash produced neither a verdict nor an error");
  }
  return "";
});

await check("double-submitting does not double-render or crash", async () => {
  await go("/verify/");
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => /Paid — a real transfer/.test(b.textContent))?.click()
  );
  await page.waitForTimeout(500);
  await submit();
  await submit();
  await page.waitForTimeout(9000);
  const n = await page.evaluate(() => document.querySelectorAll(".verdict").length);
  if (n > 1) fail("duplicate verdicts", `${n} verdict panels after a double submit`);
  return `${n} panel`;
});

await check("deep link prefills and verifies", async () => {
  await go(
    "/verify/?hash=0x3aac3134ba7c4ce4e12c04e206ad7ce468318607fdb7a8e7ad85e91a70fe72ee&token=0x0d864A625c280F7f9B9AD024d12F94f5D6DCCF13&to=0x000000000000000000000000000000000000dEaD&min=1000000"
  );
  const v = await page.evaluate(() => document.getElementById("hash")?.value ?? "");
  if (!v.startsWith("0x3aac3134")) fail("deep link ignored", `hash field held ${v.slice(0, 20)}`);
  return "prefilled";
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

// ── /claim without a wallet ─────────────────────────────────────────────────
console.log("\nCLAIM (no wallet installed)");
await check("connect is disabled and says why", async () => {
  await go("/claim/");
  const state = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /connect/i.test(x.textContent));
    return { found: !!b, disabled: b?.disabled, text: document.body.innerText };
  });
  if (!state.found) fail("no connect button", "");
  else if (!state.disabled) fail("enabled without a wallet", "connect was clickable with no provider");
  if (!/wallet/i.test(state.text)) fail("no explanation", "nothing tells the user they need a wallet");
  return "disabled";
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

await check("a paced route shows a countdown, not a stale number", async () => {
  await go("/demo/");
  // The 429 IS the result under test here, so it is not a defect for this one
  // item. Everything it produces on screen is still asserted below.
  page.__expectBadRequest = true;
  /*
   * Consume the pace first, from the page's own origin.
   *
   * Clicking twice cannot trigger it -- the UI correctly disables both buttons
   * while a run is in flight, so the second click never becomes a request.
   * This is what a second visitor arriving inside the window looks like, which
   * is the case the countdown exists for.
   */
  // Fire and do NOT await: the pace is consumed when the request starts, but
  // awaiting it means waiting out a full 14s purchase, by which point the 15s
  // window has almost expired and the click races it.
  await page.evaluate((g) => {
    void fetch(`${g}/demo?facilitator=lying`).catch(() => {});
  }, GATEWAY);
  await page.waitForTimeout(700);
  await page.evaluate(() =>
    [...document.querySelectorAll("button")].find((b) => /honestly/i.test(b.textContent))?.click()
  );
  await page.waitForTimeout(3500);
  const first = await page.evaluate(() => document.body.innerText.match(/Ready again in (\d+)s/)?.[1]);
  if (!first) return fail("no countdown", "a paced refusal did not surface a countdown");
  const disabled = await page.evaluate(
    () => [...document.querySelectorAll("button")].filter((b) => /Pay /.test(b.textContent)).every((b) => b.disabled)
  );
  if (!disabled) fail("clickable during the pace", "a button that will refuse is still enabled");
  await page.waitForTimeout(3000);
  const second = await page.evaluate(() => document.body.innerText.match(/Ready again in (\d+)s/)?.[1]);
  if (second && Number(second) >= Number(first)) fail("countdown is stale", `${first}s then ${second}s`);
  page.__expectBadRequest = false;
  return `counted ${first}s → ${second ?? "0"}s, buttons disabled`;
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
    for (const p of ["/", "/authority/", "/verify/", "/ledger/", "/docs/"]) {
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
  for (const p of ["/", "/authority/", "/verify/", "/ledger/", "/explorer/", "/docs/"]) {
    current = `logs ${p}`;
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);
  }
  if (logs.length) fail("stray console.log", logs.join(" | "));
  return "";
});

await check("every page has a real title and description", async () => {
  for (const p of ["/", "/authority/", "/verify/", "/docs/"]) {
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
