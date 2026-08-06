import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTools, type AuditEntry } from "../src/tools.ts";

/*
 * Exercises the handlers directly. The chain and KeeperHub are represented by
 * the smallest objects that answer what the handlers actually call -- these
 * tests are about the tool contract (what an agent may and may not assert),
 * not about the RPC.
 */
const TOKEN = "0x49C86277a91002c4943837bf20F6ED41976Db09F";
const PAYEE = "0x000000000000000000000000000000000000dEaD";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const pad = (a: string) => "0x" + "00".repeat(12) + a.slice(2).toLowerCase();
const hex = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");

function env(receipt: any) {
  return {
    provider: { send: async () => receipt } as any,
    kh: {} as any,
    escrow: "0x8Cd5537d9A8E55294f4939e8DBB939828BdAc89A",
    token: TOKEN,
    chainId: 11155111,
  };
}

describe("agent-facing tools", () => {
  let dir: string;
  let AUDIT: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "outcome-"));
    AUDIT = join(dir, "audit.jsonl");
  });

  it("derives the same intent id for the same work, from any caller", () => {
    // If two agents given the same job derived different ids, the on-chain
    // duplicate guard would have nothing to catch.
    const a = createTools(env(null), { auditPath: AUDIT });
    const b = createTools(env(null), { auditPath: null });
    const one = a.outcome_intent_id({ task: "summarise block 11427313", payee: PAYEE });
    const two = b.outcome_intent_id({ task: "summarise block 11427313", payee: PAYEE.toUpperCase() });
    assert.equal(one.intentId, two.intentId, "case in the address must not change the id");
    assert.notEqual(
      one.intentId,
      a.outcome_intent_id({ task: "summarise block 11427314", payee: PAYEE }).intentId
    );
  });

  it("verifies from a receipt and records the reason either way", async () => {
    const good = createTools(
      env({ status: "0x1", blockNumber: "0x1", transactionHash: "0x" + "ab".repeat(32),
            logs: [{ address: TOKEN, topics: [TRANSFER, pad(PAYEE), pad(PAYEE)], data: hex(5n) }] }),
      { auditPath: AUDIT }
    );
    const v = await good.outcome_verify({ transactionHash: "0x1", recipient: PAYEE, minAmount: "5" });
    assert.equal(v.proven, true);
    assert.equal(v.logCount, 1);
    assert.equal(good.outcome_audit().entries.at(-1)!.outcome, "proven");
  });

  it("reports a mined-but-empty transaction as not proven", async () => {
    const t = createTools(env({ status: "0x1", blockNumber: "0x1", logs: [] }), { auditPath: AUDIT });
    const v = await t.outcome_verify({ transactionHash: "0x1", recipient: PAYEE, minAmount: "5" });
    assert.equal(v.proven, false);
    assert.match(v.reason, /zero logs/);
    assert.equal(t.outcome_audit().entries.at(-1)!.outcome, "not_proven");
  });

  it("refuses to settle an intent that is not open", async () => {
    // Without this an agent could re-settle a closed intent and drain escrow.
    const t = createTools(env(null), { auditPath: AUDIT });
    t.outcome_get_intent = async () => ({
      intentId: "0x1", state: "released", payer: PAYEE, payee: PAYEE,
      amount: "5", refundableAt: 0,
    }) as any;
    const r = await t.outcome_settle({ intentId: "0x1", workTransactionHash: "0x2" });
    assert.equal(r.settled, false);
    assert.match(r.reason!, /not open/);
    assert.equal(t.outcome_audit().entries.at(-1)!.outcome, "refused");
  });

  it("takes evidence from the agent, never a verdict", () => {
    /*
     * The contract that matters. An agent supplies a transaction hash; the tool
     * reads the receipt and decides. If `outcome_settle` accepted a `proven`
     * flag, an agent could assert its way to a payout and this whole project
     * would be pointless.
     */
    const t = createTools(env(null), { auditPath: AUDIT });
    const params = t.outcome_settle.length;
    assert.equal(params, 1, "one args object");
    const src = t.outcome_settle.toString();
    assert.ok(
      /workTransactionHash/.test(src) && !/args\.(proven|verdict)/.test(src),
      "settle must not read a caller-supplied verdict"
    );
  });

  it("diagnoses without moving money", () => {
    const t = createTools(env(null), { auditPath: AUDIT });
    const d = t.outcome_diagnose({ reason: "already being processed" });
    assert.equal(d.cause, "in_flight");
    assert.equal(d.worthRescuing, false);
  });

  it("gives an agent a readable record of every decision", () => {
    // KeeperHub writes an append-only trail and exposes no agent-reachable read.
    const t = createTools(env(null), { auditPath: AUDIT });
    t.outcome_diagnose({ reason: "out of gas" });
    t.outcome_diagnose({ reason: "execution reverted" });
    const a = t.outcome_audit({ limit: 10 });
    assert.equal(a.total, 2);
    assert.equal(a.entries[0]!.outcome, "out_of_gas");
    assert.ok(a.entries[0]!.at, "every entry is timestamped");
  });

  it("caps the audit read so one call cannot pull everything", () => {
    const t = createTools(env(null), { auditPath: AUDIT });
    for (let i = 0; i < 300; i++) t.outcome_diagnose({ reason: "out of gas" });
    assert.equal(t.outcome_audit({ limit: 10_000 }).entries.length, 200);
  });

  it("survives a restart", () => {
    // The requirement an in-memory log silently fails: the first question asked
    // of an audit trail is what happened before the process died.
    const a = createTools(env(null), { auditPath: AUDIT });
    a.outcome_diagnose({ reason: "out of gas" });
    assert.ok(existsSync(AUDIT));

    const b = createTools(env(null), { auditPath: AUDIT });
    assert.equal(b.outcome_audit().total, 1, "a fresh instance reads the record back");
    b.outcome_diagnose({ reason: "nonce too low" });
    assert.equal(createTools(env(null), { auditPath: AUDIT }).outcome_audit().total, 2);
  });

  it("loses one entry to a torn write, not the whole file", () => {
    const a = createTools(env(null), { auditPath: AUDIT });
    a.outcome_diagnose({ reason: "out of gas" });
    appendFileSync(AUDIT, '{"at":"2026-01-01","tool":"trunc');
    assert.equal(createTools(env(null), { auditPath: AUDIT }).outcome_audit().total, 1);
  });
});
