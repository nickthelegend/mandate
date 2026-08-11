/**
 * Guard the entry split.
 *
 * `mandate-sdk` claims its main entry runs in a browser. That claim is one
 * stray re-export away from being false, and the failure does not show up until
 * someone else's bundler breaks -- which is exactly how a React import once got
 * into a headless package I shipped. So the built output is walked, not the
 * source: what ships is what is checked.
 *
 * Rules:
 *   .      no `node:` builtins, no react
 *   ./x402 the same, so a buyer can check a settlement in a browser
 *   ./node anything goes, it is the privileged half
 *
 * There used to be a `./react` entry. It went with the escrow console it
 * existed for, and this script kept asserting the built file imported react —
 * which failed CI for two commits while describing a package that no longer
 * has that entry. An assertion about a thing that is gone is not a guard.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const IMPORT_RE = /(?:^|[\s;])(?:import|export)\b[^'"]*?from\s*["']([^"']+)["']/gm;
const BARE_IMPORT_RE = /(?:^|[\s;])import\s*["']([^"']+)["']/gm;

/** Every module `entry` pulls in, following relative edges only. */
function closure(entry) {
  const seen = new Set();
  const external = new Set();
  const queue = [resolve(entry)];

  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);

    const src = readFileSync(file, "utf8");
    for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const spec = m[1];
        if (spec.startsWith(".")) {
          queue.push(resolve(dirname(file), spec));
        } else {
          external.add(spec);
        }
      }
    }
  }
  return { files: seen, external };
}

const failures = [];

function check(name, entry, { forbid, require: required }) {
  const { files, external } = closure(entry);

  /*
   * A scan that reads nothing passes every rule. Each entry names something it
   * must import, so a broken walk fails loudly instead of silently approving.
   */
  for (const spec of required) {
    if (!external.has(spec)) {
      failures.push(`${name}: expected to import "${spec}" and did not -- the scan is broken`);
    }
  }
  for (const spec of external) {
    const root = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    if (forbid.some((f) => (f === "node:" ? spec.startsWith("node:") : root === f))) {
      failures.push(`${name} imports "${spec}", which must not reach this entry`);
    }
  }
  console.log(`  ${name}: ${files.size} modules, external: ${[...external].sort().join(", ") || "none"}`);
}

console.log("checking built entrypoints");
check(".", "dist/esm/index.js", { forbid: ["node:", "react"], require: ["ethers"] });
// The rule that matters here is that a buyer checking whether they were
// charged for nothing can do it in a browser, with no server and no key.
check("./x402", "dist/esm/x402.js", { forbid: ["node:", "react"], require: ["ethers"] });
/*
 * And the privileged half must actually be privileged. If `./node` stops
 * reaching a builtin, the split has collapsed into one entry wearing two names
 * and the browser guarantee above is guarding nothing.
 *
 * `node:fs`, not mongodb: the driver is imported lazily inside `mongoLedger`,
 * so a static walk correctly never sees it.
 */
check("./node", "dist/esm/node.js", { forbid: ["react"], require: ["ethers", "node:fs"] });

if (failures.length) {
  console.error("\nentrypoint check FAILED");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("entrypoint check passed");
