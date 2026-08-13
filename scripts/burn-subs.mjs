/**
 * Burn the subtitles into the picture.
 *
 *   node scripts/burn-subs.mjs
 *
 * Three things happen: the cues are re-chunked, rendered, and composited.
 *
 * CHUNKING
 *
 * The editor writes one cue per narration line, because that is the unit it
 * cuts on. As a subtitle that is unreadable — a single cue runs to three
 * hundred characters, which is five stacked lines covering a third of the
 * screen for fifteen seconds. Each cue is split at sentence boundaries into
 * pieces that fit two lines, and each piece gets a share of the cue's time
 * proportional to its length. Speech rate is near enough constant for character
 * count to be a fair proxy, and the alternative — timing every clause by hand
 * across twenty beats — is not something anybody would keep up to date.
 *
 * RENDERING
 *
 * Not `subtitles=`/`drawtext`: this machine's ffmpeg is built without libass or
 * libfreetype, so both filters are simply absent. Rather than change what is
 * installed on somebody's machine to make a video, each cue is drawn in the
 * headless browser this project already uses and composited with `overlay`,
 * which every build has. It also means the styling is CSS — so what is burned
 * in matches the rest of the film's typography instead of approximating it
 * through ASS style codes.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = process.env.DEMO_ROOT
  ? process.env.DEMO_ROOT.replace(/\/?$/, "/")
  : fileURLToPath(new URL("../", import.meta.url));
const OUT = `${ROOT}recording`;

const SRC = `${OUT}/mandate-demo-full.mp4`;
const SRT = `${OUT}/mandate-demo-full.srt`;
const DST = `${OUT}/mandate-demo-subtitled.mp4`;
const CUES = `${OUT}/mandate-demo-subtitled.srt`;
const FRAMES = `${OUT}/subs`;

const W = 1440;
const H = 900;
/** Longest line that still fits comfortably at this size. */
const MAX_LINE = 62;
/** Two lines, so the box never grows past a couple of rows. */
const MAX_CHUNK = MAX_LINE * 2;

const t2s = (t) => {
  const [h, m, rest] = t.split(":");
  const [s, ms] = rest.split(",");
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
};
const s2t = (v) => {
  const ms = Math.round(v * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(
    Math.floor((ms % 60000) / 1000)
  )},${p(ms % 1000, 3)}`;
};

/** Split into sentences, then pack them into chunks that fit two lines. */
function chunk(text) {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const out = [];
  let cur = "";
  const flushLong = () => {
    while (cur.length > MAX_CHUNK) {
      const comma = cur.lastIndexOf(", ", MAX_CHUNK);
      const dash = cur.lastIndexOf(" — ", MAX_CHUNK);
      const clause = Math.max(comma, dash);
      const at = clause > MAX_CHUNK * 0.4 ? clause + 1 : cur.lastIndexOf(" ", MAX_CHUNK);
      if (at <= 0) break;
      out.push(cur.slice(0, at).trim());
      cur = cur.slice(at).trim();
    }
  };
  for (const s of sentences) {
    const piece = s.trim();
    if (!piece) continue;
    if (cur && (cur + " " + piece).length > MAX_CHUNK) {
      out.push(cur);
      cur = piece;
    } else {
      cur = cur ? `${cur} ${piece}` : piece;
    }
    flushLong();
  }
  if (cur) out.push(cur);
  return out;
}

/** Wrap onto at most two lines, balanced near the middle. */
function wrap(text) {
  if (text.length <= MAX_LINE) return [text];
  const at = text.lastIndexOf(" ", Math.ceil(text.length / 2) + 8);
  return at > 0 ? [text.slice(0, at), text.slice(at + 1)] : [text];
}

// ── 1. re-chunk ─────────────────────────────────────────────────────────────

const blocks = readFileSync(SRT, "utf8").trim().split(/\n\s*\n/);
const cues = [];
for (const b of blocks) {
  const lines = b.split("\n");
  if (!lines[1]?.includes("-->")) continue;
  const [from, to] = lines[1].split("-->").map((x) => t2s(x.trim()));
  const pieces = chunk(lines.slice(2).join(" ").trim());
  const total = pieces.reduce((n, p) => n + p.length, 0);
  let at = from;
  pieces.forEach((p, i) => {
    // The last piece absorbs rounding, so a cue ends exactly where its
    // narration line does and nothing drifts across twenty beats.
    const end = i === pieces.length - 1 ? to : at + ((to - from) * p.length) / total;
    cues.push({ from: at, to: end, lines: wrap(p) });
    at = end;
  });
}
writeFileSync(
  CUES,
  cues.map((c, i) => `${i + 1}\n${s2t(c.from)} --> ${s2t(c.to)}\n${c.lines.join("\n")}\n`).join("\n")
);
console.log(`${blocks.length} narration cues → ${cues.length} subtitle cues`);

// ── 2. render each cue ──────────────────────────────────────────────────────

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;background:transparent;overflow:hidden}
  #stage{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center;padding-bottom:34px}
  /* One box per line rather than one box around both, so a short second line
     does not sit inside a full-width black bar. */
  #cue{display:flex;flex-direction:column;align-items:center;gap:2px;max-width:${W - 160}px}
  .row{background:#000;color:#fff;font-family:"Helvetica Neue",Inter,system-ui,-apple-system,sans-serif;
    font-size:19px;line-height:1.42;letter-spacing:.005em;padding:3px 10px;white-space:pre;
    -webkit-font-smoothing:antialiased}
</style></head><body><div id="stage"><div id="cue"></div></div>
<script>window.setCue=(rows)=>{
  document.getElementById("cue").innerHTML = rows.map(r=>'<div class="row"></div>').join("");
  document.querySelectorAll(".row").forEach((el,i)=>{ el.textContent = rows[i]; });
};</script></body></html>`;

const browser = await chromium.launch();
const page = await (
  await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
).newPage();
await page.setContent(PAGE, { waitUntil: "load" });
await page.waitForTimeout(300);

for (const [i, c] of cues.entries()) {
  await page.evaluate((rows) => window.setCue(rows), c.lines);
  c.png = `${FRAMES}/${String(i).padStart(3, "0")}.png`;
  await page.screenshot({ path: c.png, omitBackground: true });
}
await browser.close();
console.log(`rendered ${cues.length} cue images`);

// ── 3. composite ────────────────────────────────────────────────────────────

/*
 * One subtitle track, then one overlay.
 *
 * The obvious construction — an overlay per cue, each gated by `enable` — does
 * not work: a still image is a single-frame input, so it exists at t=0 and
 * nowhere else, and every cue silently composited nothing. Looping sixty-three
 * image inputs to fix that means decoding sixty-three streams for the whole
 * film. Instead the cues and the gaps between them are concatenated, by
 * duration, into one RGBA track that is exactly as long as the video, and that
 * gets overlaid once.
 */
const duration = Number(
  execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", SRC], {
    encoding: "utf8",
  }).trim()
);

const blank = `${FRAMES}/blank.png`;
execFileSync("ffmpeg", [
  "-hide_banner", "-loglevel", "error",
  "-f", "lavfi", "-i", `color=c=black@0.0:s=${W}x${H},format=rgba`,
  "-frames:v", "1", "-y", blank,
]);

const segments = [];
let cursor = 0;
for (const c of cues) {
  if (c.from - cursor > 0.001) segments.push({ png: blank, dur: c.from - cursor });
  segments.push({ png: c.png, dur: c.to - c.from });
  cursor = c.to;
}
if (duration - cursor > 0.001) segments.push({ png: blank, dur: duration - cursor });

/* The concat demuxer applies a `duration` to the file BEFORE it, and drops the
 * final entry's duration — so the last file is listed twice. */
const list = `${FRAMES}/track.txt`;
writeFileSync(
  list,
  "ffconcat version 1.0\n" +
    segments.map((s) => `file '${s.png}'\nduration ${s.dur.toFixed(3)}\n`).join("") +
    `file '${segments.at(-1).png}'\n`
);

const TRACK = `${FRAMES}/track.mov`;
console.log(`building a ${segments.length}-segment subtitle track…`);
execFileSync("ffmpeg", [
  "-hide_banner", "-loglevel", "error",
  "-f", "concat", "-safe", "0", "-i", list,
  "-r", "30", "-c:v", "png", "-pix_fmt", "rgba",
  "-y", TRACK,
]);

console.log("compositing…");
execFileSync(
  "ffmpeg",
  [
    "-hide_banner", "-loglevel", "error",
    "-i", SRC,
    "-i", TRACK,
    "-filter_complex", "[0:v][1:v]overlay=0:0:shortest=1[vout]",
    "-map", "[vout]", "-map", "0:a",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-y", DST,
  ],
  { stdio: "inherit" }
);

rmSync(FRAMES, { recursive: true, force: true });
const dur = Number(
  execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", DST], {
    encoding: "utf8",
  }).trim()
);
console.log(`\n${DST}`);
console.log(`${Math.floor(dur / 60)}m ${Math.round(dur % 60)}s`);
console.log(`cue list → ${CUES}`);
