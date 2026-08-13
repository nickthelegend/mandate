/**
 * Cut the whole film: the browser take, three terminal acts, and the
 * conversation, laid against one narration.
 *
 * Five sources, two kinds. The browser beats come from a Playwright video and
 * are cut with ffmpeg; the terminal beats come from asciinema casts and are
 * rendered per-beat by `agg`, cut on markers injected from each take's beat
 * log. Markers rather than seconds, because `agg` compresses idle time — a
 * position measured in cast-seconds is not the same position in the rendered
 * video, but a marker is resolved by `agg` on its own output timeline.
 *
 * Every clip is only sped up, slowed, or held. No frame is re-enacted and
 * nothing on screen was produced by this script.
 *
 *   node scripts/edit-full.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = process.env.DEMO_ROOT
  ? process.env.DEMO_ROOT.replace(/\/?$/, "/")
  : fileURLToPath(new URL("../", import.meta.url));
const OUT = `${ROOT}recording`;
const WORK = `${OUT}/cut-full`;
mkdirSync(WORK, { recursive: true });

const AUDIO = `${OUT}/audio-full`;
const durations = JSON.parse(readFileSync(`${AUDIO}/durations.json`, "utf8"));
const script = JSON.parse(readFileSync(`${ROOT}scripts/narration-full.json`, "utf8"));
const textOf = Object.fromEntries(script.lines.map((l) => [l.id, l.text]));

const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
const probe = (f) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).trim());

/* readdir, not a glob — the repo lives under a path with a space in it. */
const browserTake = readdirSync(`${OUT}/browser`).filter((f) => f.endsWith(".webm"))[0];
if (!browserTake) throw new Error("no browser take in recording/browser");

const SOURCES = {
  browser: { kind: "video", file: `${OUT}/browser/${browserTake}`, beats: JSON.parse(readFileSync(`${OUT}/browser-beats.json`, "utf8")) },
  act1: { kind: "cast", file: `${OUT}/tui-act1.cast`, beats: JSON.parse(readFileSync(`${OUT}/tui-act1-beats.json`, "utf8")) },
  main: { kind: "cast", file: `${OUT}/tui.cast`, beats: JSON.parse(readFileSync(`${OUT}/tui-beats.json`, "utf8")) },
  sdk: { kind: "cast", file: `${OUT}/tui-sdk.cast`, beats: JSON.parse(readFileSync(`${OUT}/tui-sdk-beats.json`, "utf8")) },
  act3: { kind: "cast", file: `${OUT}/tui-act3.cast`, beats: JSON.parse(readFileSync(`${OUT}/tui-act3-beats.json`, "utf8")) },
  /*
   * The outro, narrated rather than silent. It used to be appended as a mute
   * bookend, which meant the film simply stopped — no closing line, no thank
   * you. Treating it as a clip like any other lets the same pacing lay the
   * final line over it.
   */
  outro: { kind: "whole", file: `${OUT}/cut/outro.mp4` },
};

/*
 * The film, in order. Each entry is [narration id, source, the mark the beat
 * ends at] — the end is the next *mark*, not the next narrated beat, so a take
 * can mark a boundary it never talks over. `held` ending at `leave-claude` is
 * what keeps the slash-command menu, and this machine's private list of skills,
 * out of the film entirely.
 */
const PLAN = [
  ["problem", "browser", "try-it"],
  ["try-it", "browser", "policy-build"],
  ["policy-build", "browser", "deploy"],
  ["deploy", "browser", "explorer-anchor"],
  ["policy-file", "act1", "anchor"],
  ["anchor", "act1", "end"],
  ["explorer-anchor", "browser", "connect"],
  ["connect", "browser", "explorer-spend"],
  ["open-claude", "main", "ask-policy"],
  ["ask-policy", "main", "allowed-spend"],
  ["allowed-spend", "main", "duplicate"],
  ["duplicate", "main", "injection"],
  ["injection", "main", "held"],
  ["held", "main", "leave-claude"],
  ["explorer-spend", "browser", "sdk"],
  ["sdk", "browser", "end"],
  ["sdk-run", "sdk", "end"],
  ["public-log", "act3", "verify"],
  ["verify", "act3", "end"],
  ["thanks", "outro", null],
];

for (const [id, src, end] of PLAN) {
  if (!textOf[id]) throw new Error(`no narration line for ${id}`);
  if (!existsSync(`${AUDIO}/${id}.wav`)) throw new Error(`no audio for ${id}`);
  if (SOURCES[src].kind === "whole") continue; // no marks to check — it is the whole file
  const ids = new Set(SOURCES[src].beats.marks.map((m) => m.id));
  if (!ids.has(id)) throw new Error(`${src} never marked "${id}"`);
  if (!ids.has(end)) throw new Error(`${src} never marked "${end}" (the end of ${id})`);
}

// ── markers into the casts ──────────────────────────────────────────────────

for (const [name, src] of Object.entries(SOURCES)) {
  if (src.kind !== "cast") continue;
  const lines = readFileSync(src.file, "utf8").split("\n").filter(Boolean);
  const events = lines.slice(1).map((l) => JSON.parse(l));
  const markers = src.beats.marks.map((m) => [m.at / 1000, "m", m.id]);
  /* Markers ahead of output at the same instant, so a marker placed where a
   * beat starts is not rendered one frame into it. */
  const merged = [...markers, ...events].sort((a, b) => a[0] - b[0] || (a[1] === "m" ? -1 : 1));
  src.marked = `${WORK}/${name}.cast`;
  writeFileSync(src.marked, [lines[0], ...merged.map((e) => JSON.stringify(e))].join("\n") + "\n");
  console.log(`${name.padEnd(8)} ${events.length} events + ${markers.length} markers`);
}
console.log();

// ── pacing ──────────────────────────────────────────────────────────────────

/* How long a beat may keep running past its line. Tight: the film has to land
 * under five minutes without dropping a single beat, so the budget goes to the
 * narration and what is trimmed is the silence after it. */
const MIN_TAIL = 1.2;
const MAX_TAIL = 2.8;
/* However long it took, no beat runs more than this multiple of its narration. */
const MAX_STRETCH = 2.0;

/*
 * Beats that are mostly waiting.
 *
 * A chain confirmation, a scroll down an explorer, a log printing — all real,
 * all worth showing, none worth watching at their own pace. These get almost no
 * tail and a hard ceiling, so the footage ramps rather than the film stalling.
 * Nothing is cut; it just runs faster.
 */
const RUSH = new Set([
  "anchor",
  "allowed-spend",
  "ask-policy",
  "explorer-anchor",
  "explorer-spend",
  "public-log",
  "verify",
]);
const RUSH_TAIL = 0.6;
const RUSH_STRETCH = 1.22;
/* Short footage is slowed rather than frozen, up to here. A terminal at half
 * speed still reads as a terminal; a still frame held for twenty seconds reads
 * as a crash. */
const MAX_SLOWDOWN = 1.9;

const W = 1440;
const H = 900;
const FONT = "JetBrains Mono,Menlo,DejaVu Sans Mono";
const clips = [];

for (let i = 0; i < PLAN.length; i++) {
  const [id, srcName, next] = PLAN[i];
  const src = SOURCES[srcName];
  const line = durations[id];
  const raw = `${WORK}/${String(i).padStart(2, "0")}-${id}-raw.${src.kind === "cast" ? "gif" : "mp4"}`;
  const seg = `${WORK}/${String(i).padStart(2, "0")}-${id}.mp4`;

  if (src.kind === "whole") {
    ff(["-i", src.file, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-y", raw]);
  } else if (src.kind === "cast") {
    execFileSync(
      "agg",
      [
        "--select", `marker:${id}..marker:${next}`,
        "--theme", "asciinema",
        "--font-family", FONT,
        "--font-size", "16",
        "--fps-cap", "30",
        /*
         * Trim the dead air before the ramp, not instead of it.
         *
         * A rushed beat like the signed spend is fifty seconds of which most is
         * a chain confirmation with nothing on screen. Ramping that uniformly
         * blurs the verdict at the end along with the wait. Cutting the idle
         * first leaves mostly content, so the ramp needed to hit the target is
         * gentle and the answer stays readable. Unrushed beats keep the long
         * limit, because there the waiting IS the product working.
         */
        "--idle-time-limit", RUSH.has(id) ? "1.5" : "10",
        "--last-frame-duration", "0",
        src.marked,
        raw,
      ],
      { stdio: ["ignore", "ignore", "inherit"] }
    );
  } else {
    const at = src.beats.marks.find((m) => m.id === id).at / 1000;
    const to = src.beats.marks.find((m) => m.id === next).at / 1000;
    ff(["-ss", at.toFixed(3), "-t", (to - at).toFixed(3), "-i", src.file, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-y", raw]);
  }

  /*
   * Everything is normalised to constant-framerate video before it is paced.
   *
   * `agg` writes GIFs, whose frame delays are irregular by design — one frame
   * can hold for seconds. `trim` and `setpts` on that timebase produced empty
   * output, and `ffprobe` durations were approximate. One re-encode at a fixed
   * 30fps makes every source the same kind of thing, and the ramps below exact.
   */
  const norm = `${WORK}/${String(i).padStart(2, "0")}-norm.mp4`;
  /* Scaled and padded here too: agg writes odd pixel dimensions, and libx264
   * with yuv420p rejects those outright (`Invalid argument`, empty output). */
  ff([
    "-i", raw,
    "-filter:v",
    `fps=30,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x15161B,format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", "-y", norm,
  ]);
  rmSync(raw, { force: true });

  const span = probe(norm);
  const rushed = RUSH.has(id);
  const want = rushed
    ? line + RUSH_TAIL
    : line + Math.min(MAX_TAIL, Math.max(MIN_TAIL, span - line));
  const target = Math.min(want, line * (rushed ? RUSH_STRETCH : MAX_STRETCH));

  /*
   * A rushed beat whose footage dwarfs its line gets an uneven ramp rather than
   * one flat speed.
   *
   * The signed spend is fifty seconds of spinner followed by the verdict and a
   * transaction hash — the whole point of the film. Flattened to a single
   * multiple, the waiting is watchable and the answer is a blur that lasts a
   * second. So the wait is taken very fast and the last quarter, where the
   * result lands, is taken gently. Nothing is dropped: both parts are the same
   * footage, played at different rates.
   */
  let paced = norm;
  let unevenHow = null;
  if (rushed && span / target > 2.5) {
    const tailIn = span * 0.25;
    const headIn = span - tailIn;
    const tailOut = tailIn / 1.5;
    const headOut = Math.max(0.4, target - tailOut);
    const headSpeed = headIn / headOut;
    const head = `${WORK}/${String(i).padStart(2, "0")}-head.mp4`;
    const tail = `${WORK}/${String(i).padStart(2, "0")}-tail.mp4`;
    const list = `${WORK}/${String(i).padStart(2, "0")}-parts.txt`;
    const enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-an"];
    /*
     * `trim` on the source timeline, not `-ss`/`-t` around the input. Those cut
     * the OUTPUT, which for a stream that is being sped up is a different span
     * entirely — and on a GIF they yielded an empty file. `setpts-STARTPTS`
     * rebases each part to zero before the ramp is applied.
     */
    ff(["-i", norm, "-filter:v", `trim=0:${headIn.toFixed(3)},setpts=PTS-STARTPTS,setpts=PTS/${headSpeed.toFixed(6)},fps=30`, ...enc, "-y", head]);
    ff(["-i", norm, "-filter:v", `trim=start=${headIn.toFixed(3)},setpts=PTS-STARTPTS,setpts=PTS/1.5,fps=30`, ...enc, "-y", tail]);
    writeFileSync(list, `file '${head}'\nfile '${tail}'\n`);
    paced = `${WORK}/${String(i).padStart(2, "0")}-paced.mp4`;
    ff(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-y", paced]);
    unevenHow = `rush x${headSpeed.toFixed(1)} then x1.5`;
  }

  const pacedSpan = paced === norm ? span : probe(paced);
  const vf = [];
  let how;
  if (unevenHow) {
    how = unevenHow;
  } else if (span > target + 0.05) {
    vf.push(`setpts=PTS/${(span / target).toFixed(6)}`); // setpts divides: >1 is faster
    how = `ramp x${(span / target).toFixed(2)}`;
  } else if (target > span + 0.05) {
    const slowed = Math.min(target, span * MAX_SLOWDOWN);
    if (slowed > span + 0.05) vf.push(`setpts=PTS*${(slowed / span).toFixed(6)}`);
    const pad = target - slowed;
    if (pad > 0.05) vf.push(`tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}`);
    how = `slow x${(slowed / span).toFixed(2)}${pad > 0.05 ? ` + hold ${pad.toFixed(1)}s` : ""}`;
  } else {
    how = "as shot";
  }
  /* One canvas for everything: the terminal renders at whatever agg produced
   * and the browser at 1440x900, and the concat demuxer needs identical
   * streams. Padded rather than cropped, so no part of either is cut off. */
  vf.push(
    `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x15161B`,
    "fps=30",
    "format=yuv420p"
  );

  ff([
    "-i", paced,
    "-i", `${AUDIO}/${id}.wav`,
    "-filter:v", vf.join(","),
    // apad before -shortest, or a clip whose audio is shorter than its video
    // ends at the audio and truncates the shot.
    "-af", "apad",
    "-shortest",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-y", seg,
  ]);

  const got = probe(seg);
  clips.push({ id, seg, span, line, got });
  console.log(`  ${id.padEnd(16)} ${srcName.padEnd(8)} shot ${span.toFixed(1).padStart(5)}s  line ${line.toFixed(1).padStart(5)}s  → ${got.toFixed(1).padStart(5)}s  ${how}${rushed ? "  [rush]" : ""}`);
  rmSync(norm, { force: true });
  if (paced !== norm) rmSync(paced, { force: true });
}

const body = clips.reduce((s, c) => s + c.got, 0);
console.log(`\nbody ${Math.floor(body / 60)}m ${Math.round(body % 60)}s`);

// ── bookends and the join ───────────────────────────────────────────────────

const intro = `${OUT}/cut/intro.mp4`;
const outro = `${OUT}/cut/outro.mp4`;
if (!existsSync(intro) || !existsSync(outro)) console.log("(no bookends — run scripts/bookends.mjs)");

const order = [...(existsSync(intro) ? [intro] : []), ...clips.map((c) => c.seg)];

const normalised = order.map((src, i) => {
  const dst = `${WORK}/n${String(i).padStart(2, "0")}.mp4`;
  ff([
    "-i", src,
    "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x15161B,fps=30,format=yuv420p`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-y", dst,
  ]);
  return dst;
});

writeFileSync(`${WORK}/segments.txt`, normalised.map((f) => `file '${f}'`).join("\n") + "\n");

const FINAL = `${OUT}/mandate-demo-full.mp4`;
ff(["-f", "concat", "-safe", "0", "-i", `${WORK}/segments.txt`, "-c", "copy", "-y", FINAL]);

/* Subtitles from the measured lines, so nothing is burned into the picture. */
const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
};
let at = existsSync(intro) ? probe(intro) : 0;
const srt = clips
  .map((c, i) => {
    const start = at;
    at += c.got;
    return `${i + 1}\n${srtTime(start)} --> ${srtTime(start + c.line)}\n${textOf[c.id]}\n`;
  })
  .join("\n");
writeFileSync(`${OUT}/mandate-demo-full.srt`, srt);

const total = probe(FINAL);
console.log(`\n${FINAL}`);
console.log(`${Math.floor(total / 60)}m ${Math.round(total % 60)}s`);
console.log(`subtitles → ${OUT}/mandate-demo-full.srt`);
