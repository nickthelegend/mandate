import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobId, loadJobs, postJob } from "../src/agent.ts";

const PAYEE = "0x000000000000000000000000000000000000dEaD";

describe("the agent's job board", () => {
  let dir: string, path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "jobs-"));
    path = join(dir, "jobs.jsonl");
  });

  it("derives the same id the contract was claimed under", () => {
    // The agent has to reconstruct the intent id from the task to know a job is
    // its own. If this drifted from the on-chain derivation the agent would
    // silently see no work at all.
    const a = jobId("deliver 1.00 to treasury", PAYEE);
    const b = jobId("deliver 1.00 to treasury", PAYEE.toUpperCase());
    assert.equal(a, b, "address case must not change the id");
    assert.match(a, /^0x[0-9a-f]{64}$/);
    assert.notEqual(a, jobId("deliver 2.00 to treasury", PAYEE));
  });

  it("survives a restart", () => {
    postJob(path, { intentId: jobId("t1", PAYEE), task: "t1", deliverTo: PAYEE });
    postJob(path, { intentId: jobId("t2", PAYEE), task: "t2", deliverTo: PAYEE });
    assert.equal(loadJobs(path).size, 2);
  });

  it("reads an empty board without throwing", () => {
    assert.equal(loadJobs(join(dir, "nothing.jsonl")).size, 0);
  });

  it("loses one job to a torn write, not the board", () => {
    postJob(path, { intentId: jobId("t1", PAYEE), task: "t1", deliverTo: PAYEE });
    appendFileSync(path, '{"intentId":"0xab","task":"tru');
    assert.equal(loadJobs(path).size, 1);
  });

  it("looks jobs up case-insensitively", () => {
    // Chain events return checksummed ids; the board may hold either form.
    const id = jobId("t1", PAYEE);
    postJob(path, { intentId: id.toUpperCase(), task: "t1", deliverTo: PAYEE });
    assert.ok(loadJobs(path).get(id.toLowerCase()), "an id from chain must match");
  });
});
