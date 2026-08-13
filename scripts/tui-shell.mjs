/**
 * Record the shell acts — the parts of the demo that are commands rather than
 * conversation.
 *
 *   node scripts/tui-shell.mjs act1     the policy, hashed and put on chain
 *   node scripts/tui-shell.mjs act3     the public record, and an outside check
 *
 * The conversation in between is one continuous session recorded by
 * `tui-session.mjs`. These bookend it, and are shot separately for one reason:
 * a command is finished when the shell prompt comes back, and waiting on the
 * prompt is exact. The conversation has no prompt to wait on — the TUI repaints
 * a spinner — so that take waits on stillness instead, which cannot tell a
 * command that has printed nothing yet from one that has finished. It cost the
 * verifier's output the first time.
 *
 * Every command is real and every byte on screen is what came back.
 */

import pty from "/private/tmp/ptydrv/node_modules/node-pty/lib/index.js";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = process.env.DEMO_ROOT
  ? process.env.DEMO_ROOT.replace(/\/?$/, "/")
  : fileURLToPath(new URL("../", import.meta.url));
const OUT = `${ROOT}recording`;
mkdirSync(OUT, { recursive: true });

const COLS = 118;
const ROWS = 32;

/*
 * `apps/gateway/policy.json`, not one of the samples — this is the document the
 * authority actually enforces, so the hash printed here is the hash the agent
 * quotes later when asked what governs it. Anchoring a different file would
 * have made the two halves of the film disagree.
 */
const ACTS = {
  act1: [
    ["policy-file", "cat apps/gateway/policy.json", { hold: 4000 }],
    ["anchor", "node scripts/new-policy.mjs apps/gateway/policy.json", { hold: 4500, timeout: 300000 }],
  ],
  /*
   * The SDK, for somebody writing the agent rather than running one. The file
   * is shown before it is run because the point of the beat is the shape of it:
   * five steps, every import a package on npm, and the policy read off the
   * chain rather than off the request. Then it is given a spend that breaks the
   * cap, so what is on screen is a real refusal naming a real rule.
   */
  sdk: [
    // The file itself is walked on the connect page, in an editor with line
    // numbers and the five steps marked — `head` in a terminal cannot be
    // pointed at line 34. What is left here is the part a terminal is for:
    // running it, against a spend that breaks the cap.
    ["sdk-run", "node examples/capped-agent.mjs 5.00", { hold: 5000, timeout: 240000 }],
  ],
  act3: [
    [
      "public-log",
      `curl -s 'https://gateway-production-944e.up.railway.app/authority/log?limit=6' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const e of JSON.parse(s).entries)console.log("  "+e.decision.padEnd(24)+(e.failedRule??"-"))})'`,
      { hold: 4000 },
    ],
    ["verify", "node scripts/verify-a-receipt.mjs", { hold: 4500 }],
  ],
};

const act = process.argv[2];
if (!ACTS[act]) {
  console.error(`usage: node scripts/tui-shell.mjs <${Object.keys(ACTS).join("|")}>`);
  process.exit(1);
}

const CAST = `${OUT}/tui-${act}.cast`;

/*
 * A sentinel prompt, so waiting on it cannot match a character that also
 * appears in command output. It is swapped back to the demo's glyph in the
 * recorded bytes before the cast is written, so this act looks like the same
 * terminal as the rest of the film.
 */
const SENTINEL = "¤ ";
const GLYPH = "❯ ";
const SETUP = [`PROMPT='%F{208}${SENTINEL}%f'`, "setopt NO_NOMATCH", "unsetopt PROMPT_SP", "clear"].join("; ");

const CLEAN_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith("CLAUDE_CODE") && k !== "CLAUDECODE")
);

/*
 * `.env` is loaded into the child rather than sourced on camera.
 *
 * The SDK example needs a Mongo URI, a KeeperHub key and a policy id, and
 * watching somebody source a credentials file teaches nothing while filling the
 * screen with the words that must never be in a recording. This is environment
 * configuration, in the same category as the shell prompt set before the take —
 * it changes what the commands can reach, never what they print.
 */
for (const raw of readFileSync(`${ROOT}.env`, "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const at = line.indexOf("=");
  CLEAN_ENV[line.slice(0, at).trim()] ||= line.slice(at + 1).trim();
}

const started = Date.now();
const events = [];
const marks = [];
let buffer = "";
let recordFrom = 0;
let lastAt = 0;

const term = pty.spawn("/bin/zsh", ["-d", "-f"], {
  name: "xterm-256color",
  cols: COLS,
  rows: ROWS,
  cwd: ROOT,
  env: { ...CLEAN_ENV, TERM: "xterm-256color", COLORTERM: "truecolor", COLUMNS: String(COLS), LINES: String(ROWS) },
});

term.onData((d) => {
  const t = (Date.now() - started) / 1000;
  events.push([Number(t.toFixed(6)), "o", d]);
  buffer += d;
  lastAt = t;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mark = (id) => {
  marks.push({ id, at: Date.now() - started - Math.round(recordFrom * 1000) });
  console.log(`  ${((Date.now() - started) / 1000).toFixed(1).padStart(6)}s  ${id}`);
};

/** Type like a person: about twenty characters a second, slower after punctuation. */
async function type(text, { cps = 21 } = {}) {
  const base = 1000 / cps;
  for (const ch of text) {
    term.write(ch);
    await sleep(base * (0.6 + Math.random() * 0.9) + (",.?:".includes(ch) ? 150 : 0));
  }
}

/** Run a command and wait for the prompt to come back — not for silence. */
async function run(cmd, { timeout = 180000, hold = 3000 } = {}) {
  await type(cmd);
  const before = buffer.length;
  await sleep(450);
  term.write("\r");
  const start = Date.now();
  for (;;) {
    // The echoed command line carries the prompt too, so only what arrives
    // after the first newline counts as the command having returned.
    const since = buffer.slice(before);
    const nl = since.indexOf("\n");
    if (nl >= 0 && since.slice(nl).includes(SENTINEL)) break;
    if (Date.now() - start > timeout) {
      console.log(`  ! ${cmd.slice(0, 44)} never returned to the prompt`);
      break;
    }
    await sleep(150);
  }
  await sleep(hold);
}

console.log(`${act}\n`);
await sleep(1200);
term.write(SETUP + "\r");
await sleep(1800);
recordFrom = (Date.now() - started) / 1000;
await sleep(800);

for (const [id, cmd, opts] of ACTS[act]) {
  mark(id);
  await run(cmd, opts);
}

await sleep(1200);
mark("end");

term.write("\x04");
await sleep(700);
try {
  term.kill();
} catch {
  /* already gone */
}

const kept = events
  .filter(([t]) => t >= recordFrom)
  .map(([t, k, d]) => [Number((t - recordFrom).toFixed(6)), k, d.replaceAll("¤", "❯")]);
const header = {
  version: 2,
  width: COLS,
  height: ROWS,
  timestamp: Math.floor(started / 1000),
  env: { TERM: "xterm-256color", SHELL: "/bin/zsh" },
};
writeFileSync(CAST, [JSON.stringify(header), ...kept.map((e) => JSON.stringify(e))].join("\n") + "\n");
writeFileSync(
  `${OUT}/tui-${act}-beats.json`,
  JSON.stringify({ tookMs: Date.now() - started - Math.round(recordFrom * 1000), marks }, null, 2)
);
console.log(`\n${kept.length} events, ${(lastAt - recordFrom).toFixed(1)}s → ${CAST}`);
