/**
 * Phase D. The animated intro and outro.
 *
 * Built as HTML and captured frame-accurately in a headless browser, rather
 * than as an ffmpeg crossfade — a zoom on a title card is not an animation, and
 * the one thing a judge sees before anything else should not look like a
 * placeholder.
 *
 * Frames are driven by an explicit clock rather than by wall time: the page
 * exposes `render(t)`, the recorder steps t forward one frame at a time and
 * screenshots. Recording an animation in real time drops frames whenever the
 * machine is busy, and a dropped frame in a four-second title is visible.
 *
 *   node scripts/bookends.mjs
 */

import { chromium } from "playwright";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = process.env.DEMO_ROOT
  ? process.env.DEMO_ROOT.replace(/\/?$/, "/")
  : fileURLToPath(new URL("../", import.meta.url));
const OUT = `${ROOT}recording`;
const W = 1440;
const H = 900;
const FPS = 30;

/**
 * The page. One `render(t)` function, no timers, no requestAnimationFrame —
 * the recorder owns the clock.
 *
 * The motion is deliberately typographic: the product's whole argument is a
 * sentence, and a sentence assembling itself reads as the point rather than as
 * decoration. Rules march in and one of them strikes out, which is the
 * mechanism the rest of the video shows in the real UI.
 */
const PAGE = (kind) => `<!doctype html><html><head><meta charset="utf-8"><style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;background:#faf9f7;overflow:hidden;
    font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;
    -webkit-font-smoothing:antialiased}
  #stage{position:relative;width:100%;height:100%;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:26px}
  .mark{display:flex;align-items:center;gap:12px}
  .dot{width:13px;height:13px;border-radius:99px;background:#ef4d23}
  .word{font-size:26px;font-weight:600;letter-spacing:-.03em;color:#111}
  h1{font-size:76px;font-weight:700;letter-spacing:-.045em;color:#111;text-align:center;line-height:1.02}
  h1 em{font-style:normal;color:#ef4d23}
  .sub{font-size:20px;color:#6b6560;letter-spacing:-.01em;text-align:center;max-width:720px;line-height:1.5}
  .rules{display:flex;flex-wrap:wrap;gap:7px;justify-content:center;max-width:900px}
  .chip{font-size:12px;padding:5px 11px;border-radius:99px;background:#f3ede9;color:#8a7f77;
    font-family:ui-monospace,SFMono-Regular,monospace}
  .chip.pass{background:#fdefe9;color:#c2410c}
  .chip.fail{background:#fdefed;color:#dc2626;box-shadow:inset 0 0 0 1px #f2c0ba;font-weight:600}
  .foot{font-size:14px;color:#8a7f77;letter-spacing:-.01em}
  .bar{height:2px;background:#ef4d23;border-radius:2px}
</style></head><body><div id="stage"></div>
<script>
const W=${W}, KIND=${JSON.stringify(kind)};
const RULES=["policy.active","duplicate","cooldown","replay","recipient","agent.worker","category",
 "vendor.lcbFloor","intent.max","hardCap","perCall.cap","budget.daily","rate.limit","proof.tier","escalate"];
const stage=document.getElementById("stage");

/* Eases. Everything enters on a cubic out and leaves on a cubic in — motion
   that decelerates into place reads as arriving; linear reads as sliding. */
const outC=t=>1-Math.pow(1-t,3);
const inC=t=>t*t*t;
const clamp=(t,a,b)=>Math.max(0,Math.min(1,(t-a)/(b-a)));

function intro(t){
  const markIn=outC(clamp(t,0.0,0.7));
  const titleIn=outC(clamp(t,0.45,1.5));
  const subIn=outC(clamp(t,1.5,2.2));
  // Rules land one after another, then the eleventh strikes.
  const chips=RULES.map((r,i)=>{
    const at=2.1+i*0.055;
    const a=outC(clamp(t,at,at+0.34));
    const failed = i===10 && t>3.35;
    const cls = failed ? "fail" : (t>at+0.2 && i<10 ? "pass" : "");
    return \`<span class="chip \${cls}" style="opacity:\${a};transform:translateY(\${(1-a)*7}px)">\${r}</span>\`;
  }).join("");
  const outA = t>5.0 ? 1-inC(clamp(t,5.0,5.9)) : 1;
  const lift = t>5.0 ? inC(clamp(t,5.0,5.9))*-26 : 0;
  stage.innerHTML=\`<div style="opacity:\${outA};transform:translateY(\${lift}px);display:flex;flex-direction:column;align-items:center;gap:26px">
    <div class="mark" style="opacity:\${markIn};transform:translateY(\${(1-markIn)*10}px)">
      <span class="dot" style="transform:scale(\${markIn})"></span><span class="word">Mandate</span></div>
    <h1 style="opacity:\${titleIn};transform:translateY(\${(1-titleIn)*16}px)">Give an agent a budget<br>it <em>cannot exceed</em>.</h1>
    <div class="sub" style="opacity:\${subIn}">Fifteen rules, anchored on Sepolia. Every write executed through KeeperHub.</div>
    <div class="rules" style="margin-top:10px">\${chips}</div>
    <div class="bar" style="width:\${outC(clamp(t,2.0,4.6))*420}px;margin-top:6px"></div>
  </div>\`;
}

function outro(t){
  const a=outC(clamp(t,0.1,0.9));
  const lines=[
    ["A limit the agent cannot argue with.",0.5],
    ["Evidence anybody can check.",1.0],
    ["Every transaction through KeeperHub.",1.5],
  ].map(([s,at])=>{
    const o=outC(clamp(t,at,at+0.7));
    return \`<div style="opacity:\${o};transform:translateX(\${(1-o)*-14}px);font-size:23px;color:#4a4440;letter-spacing:-.015em">\${s}</div>\`;
  }).join("");
  const thanksIn=outC(clamp(t,2.9,3.8));
  const outA = t>6.0 ? 1-inC(clamp(t,6.0,7.0)) : 1;
  const scale = 1 - (t>6.0 ? inC(clamp(t,6.0,7.0))*0.03 : 0);
  stage.innerHTML=\`<div style="opacity:\${outA};transform:scale(\${scale});display:flex;flex-direction:column;align-items:center;gap:30px">
    <div class="mark" style="opacity:\${a};transform:translateY(\${(1-a)*10}px)">
      <span class="dot"></span><span class="word">Mandate</span></div>
    <div style="display:flex;flex-direction:column;gap:13px;align-items:flex-start">\${lines}</div>
    <h1 style="opacity:\${thanksIn};transform:translateY(\${(1-thanksIn)*14}px);font-size:52px;margin-top:8px">Thanks for <em>watching</em>.</h1>
    <div class="foot" style="opacity:\${outC(clamp(t,3.8,4.6))}">Agents Onchain 2026 · Sepolia</div>
  </div>\`;
}

window.render=(t)=>{ KIND==="intro"?intro(t):outro(t); };
window.render(0);
</script></body></html>`;

async function capture(kind, seconds) {
  const dir = `${OUT}/frames-${kind}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage();
  await page.setContent(PAGE(kind), { waitUntil: "networkidle" });
  await page.waitForTimeout(700); // let the webfont land before frame zero

  const total = Math.round(seconds * FPS);
  for (let f = 0; f < total; f++) {
    await page.evaluate((t) => window.render(t), f / FPS);
    await page.screenshot({ path: `${dir}/${String(f).padStart(4, "0")}.png` });
  }
  await browser.close();

  const mp4 = `${OUT}/cut/${kind}.mp4`;
  // Silent, but with a real audio track — concat demuxer drops a stream that
  // is missing from one input, and a bookend without audio takes the whole
  // film's sound with it.
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error",
    "-framerate", String(FPS), "-i", `${dir}/%04d.png`,
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-shortest",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-y", mp4], { stdio: "inherit" });
  rmSync(dir, { recursive: true, force: true });
  console.log(`  ${kind}: ${seconds}s → ${mp4}`);
  return mp4;
}

console.log("rendering bookends");
await capture("intro", 6.2);
await capture("outro", 7.2);
