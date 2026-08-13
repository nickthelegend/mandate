/**
 * The submission logo, at the size the form asks for.
 *
 *   node scripts/logo-png.mjs
 *
 * DoraHacks wants a 480x480 JPEG or PNG under 2 MB. The mark is an SVG in the
 * app, so it is drawn here at that exact size rather than exported by hand and
 * left to drift from the one the site actually renders — same geometry, same
 * two colours, one source.
 *
 * Two versions: the mark on the site's paper background, and a dark one, so
 * whichever way the listing renders it there is a version that does not
 * disappear into the page.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = process.env.DEMO_ROOT
  ? process.env.DEMO_ROOT.replace(/\/?$/, "/")
  : fileURLToPath(new URL("../", import.meta.url));
const OUT = `${ROOT}recording/brand`;
mkdirSync(OUT, { recursive: true });

const S = 480;
const BRAND = "#ef4d23";
const DARK = "#0b0f1a";

/*
 * The mark, scaled from the component's 32-unit viewBox. The ring is left open
 * at the top right and the check enters through the gap — the claim is the
 * circle, the proof comes from outside it.
 */
const MARK = (ring, check) => `
  <svg width="300" height="300" viewBox="0 0 32 32" fill="none">
    <path d="M16 3.2a12.8 12.8 0 1 0 11.35 6.9" stroke="${ring}" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M10.4 16.6l4.3 4.3L28.8 6.9" stroke="${check}" stroke-width="3.4"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

const PAGE = (bg, ring, check) => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0}
  html,body{width:${S}px;height:${S}px;background:${bg};overflow:hidden}
  #s{width:${S}px;height:${S}px;display:flex;align-items:center;justify-content:center}
</style></head><body><div id="s">${MARK(ring, check)}</div></body></html>`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: S, height: S }, deviceScaleFactor: 1 });

for (const [name, bg, ring, check] of [
  ["mandate-logo-light", "#faf9f7", BRAND, DARK],
  ["mandate-logo-dark", DARK, BRAND, "#ffffff"],
]) {
  const page = await ctx.newPage();
  await page.setContent(PAGE(bg, ring, check), { waitUntil: "load" });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.close();
  console.log(`  ${OUT}/${name}.png  ${S}x${S}`);
}

await browser.close();
