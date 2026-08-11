/**
 * Phase B–E. Cut the take from the beat log, not by eye.
 *
 * Each line's audio plays over the footage between its own mark and the next.
 * Where the footage is longer than the line it is sped up; where it is shorter
 * the last frame holds. Both decisions come from measured numbers — the marks
 * and the rendered audio durations — so nothing drifts.
 *
 * The signing beats are the exception and they are treated as "thinking"
 * spans: a real Sepolia confirmation takes twenty to forty seconds, which is
 * honest and unwatchable. The narration for those beats is real and plays in
 * full; what gets compressed is the silent remainder after the line ends, so
 * the wait is represented rather than endured. Nothing is cut that carries
 * information — the overlay counts itself out and shows the hash.
 *
 *   node scripts/edit-demo.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = process.env.DEMO_ROOT
  ? process.env.DEMO_ROOT.replace(/\/?$/, "/")
  : fileURLToPath(new URL("../", import.meta.url));
const OUT = `${ROOT}recording`;
const WORK = `${OUT}/cut`;
mkdirSync(WORK, { recursive: true });

const beats = JSON.parse(readFileSync(`${OUT}/beats.json`, "utf8"));
const durations = JSON.parse(readFileSync(`${OUT}/audio/durations.json`, "utf8"));
/* readdir, not a glob: the repo lives under a path with a space in it. */
const { readdirSync } = await import("node:fs");
const found = readdirSync(`${OUT}/video`).filter((f) => f.endsWith(".webm"));
const video = found.length ? `${OUT}/video/${found[0]}` : "";
if (!video) throw new Error("no raw take in recording/video");

const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
const probe = (f) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).trim());

/*
 * How long a silent tail may run after a line finishes.
 *
 * The signing beats sit at ~30s of real chain wait against a ~14s line. Left
 * alone that is fifteen seconds of a viewer wondering whether the demo froze.
 * Capped, the wait is still shown and still real — just not endured in full.
 */
const MAX_SILENT_TAIL = 2.5;
const SIGNING_TAIL = 4.0;

const raw = probe(video);
console.log(`raw take ${raw.toFixed(1)}s, ${beats.marks.length} beats\n`);

const clips = [];
for (let i = 0; i < beats.marks.length; i++) {
  const m = beats.marks[i];
  const from = m.at / 1000;
  const to = (beats.marks[i + 1]?.at ?? beats.tookMs) / 1000;
  const span = to - from;
  const line = durations[m.id];
  const audio = `${OUT}/audio/${m.id}.wav`;
  if (!existsSync(audio)) throw new Error(`no audio for ${m.id}`);

  /*
   * The target length for this beat: the line, plus a short tail so the shot
   * settles before the next one starts. A signing beat gets a slightly longer
   * tail because the overlay's counter is the thing being shown.
   */
  const tail = m.signing ? SIGNING_TAIL : Math.min(MAX_SILENT_TAIL, Math.max(0, span - line));
  const target = line + tail;

  const seg = `${WORK}/${String(i).padStart(2, "0")}-${m.id}.mp4`;
  const vf = [];

  if (span > target + 0.05) {
    // Longer footage than we want: ramp it. setpts divides, so >1 is faster.
    const speed = span / target;
    vf.push(`setpts=PTS/${speed.toFixed(6)}`);
  } else if (target > span + 0.05) {
    // Shorter footage: hold the last frame. Clamped — pacing can land a
    // millisecond negative and ffmpeg rejects a negative pad outright.
    const pad = Math.max(0, target - span);
    vf.push(`tpad=stop_mode=clone:stop_duration=${pad.toFixed(3)}`);
  }
  vf.push("fps=30", "format=yuv420p");

  ff([
    "-ss", from.toFixed(3), "-t", span.toFixed(3), "-i", video,
    "-i", audio,
    "-filter:v", vf.join(","),
    // apad BEFORE -shortest: without it a clip whose audio is shorter than its
    // video ends at the audio and truncates the shot.
    "-af", "apad",
    "-shortest",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-y", seg,
  ]);

  const got = probe(seg);
  clips.push({ id: m.id, seg, span, line, target, got, signing: Boolean(m.signing) });
  const how = span > target ? `ramp ×${(span / target).toFixed(2)}` : target > span ? `hold +${(target - span).toFixed(1)}s` : "as shot";
  console.log(`  ${m.id.padEnd(14)} ${span.toFixed(1)}s → ${got.toFixed(1)}s  ${how}${m.signing ? "  [signing]" : ""}`);
}

const body = clips.reduce((s, c) => s + c.got, 0);
console.log(`\nbody ${(body / 60).toFixed(1)} min`);

writeFileSync(`${WORK}/segments.txt`, clips.map((c) => `file '${c.seg}'`).join("\n") + "\n");

/* Subtitles from the measured lines, so nothing is burned into the picture. */
const srtTime = (s) => {
  const ms = Math.round(s * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const sec = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, "0")}`;
};
const script = JSON.parse(readFileSync(`${ROOT}scripts/narration.json`, "utf8"));
const textOf = Object.fromEntries(script.lines.map((l) => [l.id, l.text]));
let at = 0;
const srt = clips
  .map((c, i) => {
    const start = at;
    at += c.got;
    return `${i + 1}\n${srtTime(start)} --> ${srtTime(start + c.line)}\n${textOf[c.id]}\n`;
  })
  .join("\n");
writeFileSync(`${OUT}/mandate-demo.srt`, srt);

console.log(`segments → ${WORK}/segments.txt`);
console.log(`subtitles → ${OUT}/mandate-demo.srt`);
