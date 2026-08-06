/**
 * The ABIs in this package are hand-written strings, and a wrong one does not
 * throw -- it decodes.
 *
 * This is not hypothetical. `beneficiary` was added to `Intent` as a third
 * field; three files kept the five-field declaration. `intents()` still
 * returned six words, ethers still decoded them positionally, and
 * `outcome_get_intent` read `refundableAt` as `state`. Every open intent looked
 * settled, the agent silently found no work, and nothing anywhere errored. The
 * only symptom was an agent that did nothing.
 *
 * So the declarations are checked against the compiled artifact rather than
 * against each other. Comparing them to one another only proves they drifted
 * together.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Interface, type JsonFragment } from "ethers";
import { join } from "node:path";

const ARTIFACT = join(
  import.meta.dirname,
  "../../contracts/artifacts/contracts/OutcomeEscrow.sol/OutcomeEscrow.json"
);
const SRC = join(import.meta.dirname, "../src");

/** Canonical `name(type,type)` form, so formatting differences do not matter. */
function signature(f: { name?: string; inputs?: readonly { type: string }[] }): string {
  return `${f.name}(${(f.inputs ?? []).map((i) => i.type).join(",")})`;
}

/** How a fragment's outputs decode: the ordered types plus their names. */
function shape(f: { outputs?: readonly { name: string; type: string }[] }): string {
  return (f.outputs ?? []).map((o) => `${o.type} ${o.name}`).join(", ");
}

const artifact = new Interface(
  (JSON.parse(readFileSync(ARTIFACT, "utf8")).abi as JsonFragment[])
);

/** Every quoted ABI string in src/, with the file it came from. */
function declaredFragments(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const name of readdirSync(SRC).filter((f) => f.endsWith(".ts"))) {
    const body = readFileSync(join(SRC, name), "utf8");
    for (const m of body.matchAll(/"((?:function|event)\s+[^"]+)"/g)) {
      out.push({ file: name, text: m[1] });
    }
  }
  return out;
}

test("every ABI declaration in src/ matches the compiled contract", () => {
  const declared = declaredFragments();

  // A test that finds nothing passes for the wrong reason.
  assert.ok(declared.length >= 4, `found only ${declared.length} ABI strings; the scan is broken`);

  const checked: string[] = [];
  for (const { file, text } of declared) {
    const frag = text.startsWith("function")
      ? Interface.from([text]).getFunction(text.match(/function\s+(\w+)/)![1])
      : Interface.from([text]).getEvent(text.match(/event\s+(\w+)/)![1]);
    if (!frag) continue;

    // ERC-20 and other foreign ABIs live here too; only judge our own.
    const real = frag.type === "function"
      ? artifact.fragments.find((f) => f.type === "function" && signature(f as never) === signature(frag as never))
      : artifact.fragments.find((f) => f.type === "event" && signature(f as never) === signature(frag as never));
    if (!real) continue;

    assert.equal(
      shape(frag as never),
      shape(real as never),
      `${file} declares ${signature(frag as never)} returning (${shape(frag as never)}), ` +
        `but the contract returns (${shape(real as never)}). ` +
        `A positional mismatch decodes silently -- it does not throw.`
    );
    checked.push(`${file}:${signature(frag as never)}`);
  }

  // If the matcher stopped matching, the assertions above become vacuous.
  assert.ok(checked.length >= 3, `matched only ${checked.length} contract fragments: ${checked.join(", ")}`);
});

test("the artifact still has the beneficiary field this all turned on", () => {
  // The regression itself: a fourth file adding the old five-field form would
  // fail the test above, but only while the contract keeps this shape.
  assert.equal(
    shape(artifact.getFunction("intents") as never),
    "address payer, address payee, address beneficiary, uint256 amount, uint64 refundableAt, uint8 state"
  );
});
