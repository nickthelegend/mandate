/**
 * Full-page screenshots of every route, desktop and mobile.
 *
 * Design iteration needs to look at the rendered thing, not at the source that
 * was supposed to produce it. Run: node shots.mjs [baseURL]
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:4180";
const OUT = process.argv[3] ?? ".shots";
mkdirSync(OUT, { recursive: true });

const ROUTES = ["/", "/demo", "/agent", "/ledger", "/explorer", "/verify", "/inspect", "/claim", "/x402", "/docs"];

const browser = await chromium.launch();

for (const [tag, viewport] of [["d", { width: 1440, height: 900 }], ["m", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  for (const route of ROUTES) {
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + (route === "/" ? "/" : route + "/"), { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3200);
      const name = route === "/" ? "home" : route.slice(1);
      await page.screenshot({ path: `${OUT}/${tag}-${name}.png`, fullPage: tag === "d" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      if (overflow > 2) console.log(`  ! ${tag} ${route} overflows ${overflow}px`);
    } catch (e) {
      console.log(`  x ${tag} ${route}: ${e.message.slice(0, 80)}`);
    }
    await page.close();
  }
  await ctx.close();
}

await browser.close();
console.log(`shots in ${OUT}`);
