/**
 * Cut the terminal take into the finished film.
 *
 * The driver wrote a cast and a beat log. This puts a marker into the cast at
 * every beat, has `agg` render each beat as its own clip, fits each clip to the
 * length of its narration line, and concatenates the result behind the animated
 * intro.
 *
 * Cutting on markers rather than on seconds is the point: `agg` compresses idle
 * time, so a position measured in cast-seconds is not the same position in the
 * rendered video. Markers are resolved by `agg` on its own output timeline, so
 * a beat lands where the beat actually is however the idle time is treated.
 *
 * Nothing is re-enacted here. Clips are only sped up or held — the frames are
 * whatever the terminal did.
 *
 *   node scripts/edit-tui.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = process.env.DEMO_ROOT
  ? process.env.DEMO_ROOT.replace(/\/?$/, "/")
  : fileURLToPath(new URL("../", import.meta.url));
const OUT = `${ROOT}recording`;
const WORK = `${OUT}/cut-tui`;
mkdirSync(WORK, { recursive: true });

const AUDIO = `${OUT}/audio-tui`;

const durations = JSON.parse(readFileSync(`${AUDIO}/durations.json`, "utf8"));
const script = JSON.parse(readFileSync(`${ROOT}scripts/narration-tui.json`, "utf8"));
const textOf = Object.fromEntries(script.lines.map((l) => [l.id, l.text]));

/*
 * Three casts: the two shell acts, and the conversation between them. The
 * conversation is one continuous session. The shell acts are shot separately
 * because a command is done when the prompt returns, and that is exact —
 * whereas the conversation can only be waited on by stillness, which cannot
 * tell a command that has printed nothing yet from one that has finished.
 * Same terminal, same commands, real output throughout.
 */
const SOURCES = Object.fromEntries(
  ["act1", "main", "act3"].map((name) => {
    const stem = name === "main" ? "tui" : `tui-${name}`;
    return [name, { cast: `${OUT}/${stem}.cast`, beats: JSON.parse(readFileSync(`${OUT}/${stem}-beats.json`, "utf8")) }];
  })
);

/*
 * Each beat runs to the next *mark*, not to the next narrated beat. The take
 * marks the moment the agent is exited, which is a boundary rather than a beat:
 * ending `held` there keeps the slash-command menu — and this machine's private
 * list of skills — out of the film entirely.
 */
const PLAN = [
  ["policy-file", "act1", "anchor"],
  ["anchor", "act1", "end"],
  ["open-claude", "main", "ask-policy"],
  ["ask-policy", "main", "allowed-spend"],
  ["allowed-spend", "main", "duplicate"],
  ["duplicate", "main", "injection"],
  ["injection", "main", "held"],
  ["held", "main", "leave-claude"],
  ["public-log", "act3", "verify"],
  ["verify", "act3", "end"],
];

const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
const probe = (f) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).trim());

/* Every planned beat must have a mark in its source and a rendered line. */
for (const [id, src, end] of PLAN) {
  const ids = new Set(SOURCES[src].beats.marks.map((m) => m.id));
  if (!ids.has(id)) throw new Error(`${src} was never marked "${id}"`);
  if (!ids.has(end)) throw new Error(`${src} was never marked "${end}" (the end of ${id})`);
  if (!textOf[id]) throw new Error(`no narration line for ${id}`);
  if (!existsSync(`${AUDIO}/${id}.wav`)) throw new Error(`no audio for ${id}`);
}

// ---------------------------------------------------------------------------
// 1. Put markers in each cast.

for (const [name, src] of Object.entries(SOURCES)) {
  const lines = readFileSync(src.cast, "utf8").split("\n").filter(Boolean);
  const events = lines.slice(1).map((l) => JSON.parse(l));
  const markers = src.beats.marks.map((m) => [m.at / 1000, "m", m.id]);
  /*
   * Stable sort with markers ahead of output at the same instant, so a marker
   * placed at the moment a beat starts is not rendered one frame into it.
   */
  const merged = [...markers, ...events].sort((a, b) => a[0] - b[0] || (a[1] === "m" ? -1 : 1));
  src.marked = `${WORK}/${name}.cast`;
  writeFileSync(src.marked, [lines[0], ...merged.map((e) => JSON.stringify(e))].join("\n") + "\n");
  console.log(`${name}: ${events.length} events + ${markers.length} markers`);
}
console.log();

// ---------------------------------------------------------------------------
// 2. Render each beat, then fit it to its line.

/*
 * How long a beat may keep running after its line ends. Generous, because the
 * footage under these beats is an agent working and the answers are worth
 * reading — but bounded, so no single beat runs away with the film.
 */
const MIN_TAIL = 1.6;
const MAX_TAIL = 16.0;
/* However long the terminal took, no beat runs more than this multiple of its
 * own narration. This is what keeps a fifty-second spend watchable. */
const MAX_STRETCH = 2.5;
/*
 * When a beat's footage is shorter than its line, slow it down rather than
 * freeze it — up to this factor. A terminal at half speed still reads as a
 * terminal; a still frame held for twenty seconds reads as a crash. Whatever
 * slowing cannot cover is held on the last frame.
 */
const MAX_SLOWDOWN = 2.0;

const FONT = "JetBrains Mono,Menlo,DejaVu Sans Mono";
const clips = [];

for (let i = 0; i < PLAN.length; i++) {
  const [id, srcName, next] = PLAN[i];
  const MARKED = SOURCES[srcName].marked;
  const line = durations[id];
  const gif = `${WORK}/${String(i).padStart(2, "0")}-${id}.gif`;
  const seg = `${WORK}/${String(i).padStart(2, "0")}-${id}.mp4`;

  execFileSync(
    "agg",
    [
      "--select", `marker:${id}..marker:${next}`,
      "--theme", "asciinema",
      "--font-family", FONT,
      "--font-size", "16",
      "--fps-cap", "30",
      // Generous, because the waits here are the product working — a policy
      // being registered on chain, a payment being signed. Only genuinely dead
      // air gets trimmed; the pacing below does the rest.
      "--idle-time-limit", "10",
      "--last-frame-duration", "0",
      MARKED,
      gif,
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );

  const span = probe(gif);
  /*
   * The clip is worth as much time as its line needs, plus a tail — but a beat
   * whose footage genuinely runs long (an anchor, a signed transfer) is allowed
   * to keep some of that length rather than being crushed to fit the voice.
   */
  const want = line + Math.min(MAX_TAIL, Math.max(MIN_TAIL, span - line));
  const target = Math.min(want, line * MAX_STRETCH);

  const vf = [];
  let how;
  if (span > target + 0.05) {
    // Longer footage than the beat is worth: ramp it. setpts divides, so the
    // divisor is the speed-up.
    vf.push(`setpts=PTS/${(span / target).toFixed(6)}`);
    how = `ramp x${(span / target).toFixed(2)}`;
  } else if (target > span + 0.05) {
    // Shorter: slow it as far as it will bear, then hold what is left over.
    const slowed = Math.min(target, span * MAX_SLOWDOWN);
    if (slowed > span + 0.05) vf.push(`setpts=PTS*${(slowed / span).toFixed(6)}`);
    const pad = target - slowed;
    if (pad > 0.05) vf.push(`tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}`);
    how = `slow x${(slowed / span).toFixed(2)}${pad > 0.05 ? ` + hold ${pad.toFixed(1)}s` : ""}`;
  } else {
    how = "as shot";
  }
  vf.push("fps=30", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "format=yuv420p");

  ff([
    "-i", gif,
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
  console.log(`  ${id.padEnd(15)} shot ${span.toFixed(1).padStart(5)}s  line ${line.toFixed(1).padStart(5)}s  → ${got.toFixed(1).padStart(5)}s  ${how}`);
  rmSync(gif, { force: true });
}

const body = clips.reduce((s, c) => s + c.got, 0);
console.log(`\nbody ${Math.floor(body / 60)}m ${Math.round(body % 60)}s`);

// ---------------------------------------------------------------------------
// 3. Bookends, subtitles, and the join.

const bookends = ["intro", "outro"].map((k) => `${OUT}/cut/${k}.mp4`).filter(existsSync);
const order = [
  ...(existsSync(`${OUT}/cut/intro.mp4`) ? [`${OUT}/cut/intro.mp4`] : []),
  ...clips.map((c) => c.seg),
  ...(existsSync(`${OUT}/cut/outro.mp4`) ? [`${OUT}/cut/outro.mp4`] : []),
];
if (bookends.length < 2) console.log("(no bookends rendered — run scripts/bookends.mjs first)");

/*
 * The bookends were rendered at 1440x900 and the terminal clips are whatever
 * agg produced, so everything is padded onto one canvas before the join. The
 * concat demuxer needs identical streams; scale+pad rather than crop, so no
 * part of the terminal is cut off.
 */
const W = 1440;
const H = 900;
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

const FINAL = `${OUT}/mandate-terminal-demo.mp4`;
ff(["-f", "concat", "-safe", "0", "-i", `${WORK}/segments.txt`, "-c", "copy", "-y", FINAL]);

/* Subtitles from the measured lines, so nothing is burned into the picture. */
const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
};
let at = existsSync(`${OUT}/cut/intro.mp4`) ? probe(`${OUT}/cut/intro.mp4`) : 0;
const srt = clips
  .map((c, i) => {
    const start = at;
    at += c.got;
    return `${i + 1}\n${srtTime(start)} --> ${srtTime(start + c.line)}\n${textOf[c.id]}\n`;
  })
  .join("\n");
writeFileSync(`${OUT}/mandate-terminal-demo.srt`, srt);

const total = probe(FINAL);
console.log(`\n${FINAL}`);
console.log(`${Math.floor(total / 60)}m ${Math.round(total % 60)}s`);
console.log(`subtitles → ${OUT}/mandate-terminal-demo.srt`);
