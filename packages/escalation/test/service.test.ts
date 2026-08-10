/**
 * Tests for the escalation lifecycle.
 *
 * Every test here is a way a plausible-looking approval could wrongly release
 * money, or a way a real one could be lost. The store is an in-memory
 * implementation of the same interface Mongo implements — the subject under
 * test is the state machine, and the Mongo version is exercised for real
 * against the live gateway.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { EscalationService, type EscalationStore } from "../src/service.ts";
import { hashCode } from "../src/codes.ts";
import type { ApprovalsConfig, ChannelLogEntry, EscalationRecord, EscalationStatus } from "../src/types.ts";

const OPERATOR = "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67";

const approvals: ApprovalsConfig = {
  operators: [OPERATOR],
  maxApprovalAmount: 10,
  timeoutSeconds: 900,
};

function memoryStore(): EscalationStore & { all(): EscalationRecord[] } {
  const rows = new Map<string, EscalationRecord>();
  return {
    all: () => [...rows.values()],
    async insert(rec) {
      rows.set(rec.id, rec);
    },
    async byId(id) {
      return rows.get(id) ?? null;
    },
    async byCodeHash(hash) {
      return [...rows.values()].find((r) => r.approvalCodeHash === hash) ?? null;
    },
    async update(id, patch, append) {
      const cur = rows.get(id);
      if (!cur) return;
      rows.set(id, {
        ...cur,
        ...patch,
        channelLog: append ? [...cur.channelLog, append as ChannelLogEntry] : cur.channelLog,
      });
    },
    async list(limit, status) {
      return [...rows.values()].filter((r) => !status || r.status === status).slice(0, limit);
    },
    async overdue(nowIso) {
      return [...rows.values()].filter((r) => r.status === "PENDING" && r.expiresAt <= nowIso);
    },
  };
}

const spend = {
  intentHash: `0x${"11".repeat(32)}`,
  policyId: "42",
  decision: "ESCALATED_VENDOR_RISK",
  reason: "vendor LCB below floor",
  failedRule: "vendor.lcbFloor",
  amount: 0.4,
  token: "0x49C86277a91002c4943837bf20F6ED41976Db09F",
  recipient: "0x000000000000000000000000000000000000dEaD",
  heldSpend: { amount: 0.4, category: "market-data" },
};

function svc(over: Partial<ApprovalsConfig> = {}, clock?: () => number) {
  const store = memoryStore();
  return { store, s: new EscalationService(store, { ...approvals, ...over }, clock) };
}

test("creating an escalation stores only the code's hash", async () => {
  const { store, s } = svc();
  const { id, code } = await s.create(spend);
  const rec = await store.byId(id);
  assert.ok(rec);
  // A leaked row must not be usable to forge an approval.
  assert.equal(rec.approvalCodeHash, hashCode(code));
  assert.ok(!JSON.stringify(rec).includes(code), "the plaintext code was persisted");
  assert.equal(rec.status, "PENDING");
});

test("a bound operator with the right code approves, and the held spend survives", async () => {
  const { s } = svc();
  const { id, code } = await s.create(spend);
  const r = await s.respond({
    channel: "http",
    senderHandle: OPERATOR,
    action: "APPROVE",
    code,
    escalationId: id,
    receivedAtMs: Date.now(),
  });
  assert.equal(r.outcome, "APPROVED");
  const rec = await s.get(id);
  assert.equal(rec?.status, "APPROVED");
  // Approving must execute the spend that was asked for, not a re-derivation.
  assert.deepEqual(rec?.heldSpend, spend.heldSpend);
});

test("an unbound sender is ignored and the escalation stays open", async () => {
  const { s } = svc();
  const { id, code } = await s.create(spend);
  const r = await s.respond({
    channel: "http",
    senderHandle: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    action: "APPROVE",
    code,
    escalationId: id,
    receivedAtMs: Date.now(),
  });
  assert.equal(r.outcome, "IGNORED_UNBOUND");
  assert.equal((await s.get(id))?.status, "PENDING", "an unbound approval resolved the escalation");
});

test("a wrong code is ignored even from a bound operator", async () => {
  const { s } = svc();
  const { id } = await s.create(spend);
  const r = await s.respond({
    channel: "http",
    senderHandle: OPERATOR,
    action: "APPROVE",
    code: "00".repeat(12),
    escalationId: id,
    receivedAtMs: Date.now(),
  });
  assert.equal(r.outcome, "IGNORED_BAD_CODE");
  assert.equal((await s.get(id))?.status, "PENDING");
});

test("a code cannot be replayed after it has resolved", async () => {
  const { s } = svc();
  const { id, code } = await s.create(spend);
  const inbound = {
    channel: "http",
    senderHandle: OPERATOR,
    action: "APPROVE" as const,
    code,
    escalationId: id,
    receivedAtMs: Date.now(),
  };
  assert.equal((await s.respond(inbound)).outcome, "APPROVED");
  // A second presentation must be an idempotent acknowledgement, not a second approval.
  assert.equal((await s.respond(inbound)).outcome, "IGNORED_ALREADY_RESOLVED");
});

test("an approval above the operator's cap is refused", async () => {
  const { s } = svc({ maxApprovalAmount: 0.1 });
  const { id, code } = await s.create(spend);
  const r = await s.respond({
    channel: "http",
    senderHandle: OPERATOR,
    action: "APPROVE",
    code,
    escalationId: id,
    receivedAtMs: Date.now(),
  });
  assert.equal(r.outcome, "IGNORED_OVER_CAP");
  assert.equal((await s.get(id))?.status, "PENDING");
});

test("a denial is never blocked by the approval cap", async () => {
  // Refusing to spend is not an exercise of spending authority.
  const { s } = svc({ maxApprovalAmount: 0.1 });
  const { id, code } = await s.create(spend);
  const r = await s.respond({
    channel: "http",
    senderHandle: OPERATOR,
    action: "DENY",
    code,
    escalationId: id,
    receivedAtMs: Date.now(),
  });
  assert.equal(r.outcome, "DENIED");
});

test("silence expires to denied, never to approved", async () => {
  let t = 1_800_000_000_000;
  const { s } = svc({ timeoutSeconds: 60 }, () => t);
  const { id } = await s.create(spend);
  t += 61_000;
  const { expired } = await s.sweep();
  assert.deepEqual(expired, [id]);
  assert.equal((await s.get(id))?.status, "EXPIRED");
});

test("a response after expiry is rejected and expires the escalation", async () => {
  let t = 1_800_000_000_000;
  const { s } = svc({ timeoutSeconds: 60 }, () => t);
  const { id, code } = await s.create(spend);
  t += 61_000;
  const r = await s.respond({
    channel: "http",
    senderHandle: OPERATOR,
    action: "APPROVE",
    code,
    escalationId: id,
    receivedAtMs: t,
  });
  assert.equal(r.outcome, "IGNORED_EXPIRED");
  assert.equal((await s.get(id))?.status, "EXPIRED");
});

test("an unknown id or code matches nothing", async () => {
  const { s } = svc();
  const r = await s.respond({
    channel: "http",
    senderHandle: OPERATOR,
    action: "APPROVE",
    code: "ab".repeat(12),
    receivedAtMs: Date.now(),
  });
  assert.equal(r.outcome, "IGNORED_NOT_FOUND");
  assert.equal(r.escalationId, null);
});

test("every rejection is on the trail, not dropped", async () => {
  const { s } = svc();
  const { id, code } = await s.create(spend);
  await s.respond({ channel: "http", senderHandle: "0xnope", action: "APPROVE", code, escalationId: id, receivedAtMs: Date.now() });
  await s.respond({ channel: "http", senderHandle: OPERATOR, action: "APPROVE", code: "11".repeat(12), escalationId: id, receivedAtMs: Date.now() });
  const rec = await s.get(id);
  const outcomes = (rec?.channelLog ?? []).map((e) => e.outcome).filter(Boolean);
  // A control that silently discards what it rejects cannot be audited.
  assert.deepEqual(outcomes, ["IGNORED_UNBOUND", "IGNORED_BAD_CODE"]);
});

test("widening the cap later does not authorise an escalation already pending", async () => {
  const store = memoryStore();
  const strict = new EscalationService(store, { ...approvals, maxApprovalAmount: 0.1 });
  const { id, code } = await strict.create(spend);
  // A new service with a laxer config must not be able to resolve the old one.
  const lax = new EscalationService(store, { ...approvals, maxApprovalAmount: 1000 });
  const r = await lax.respond({
    channel: "http",
    senderHandle: OPERATOR,
    action: "APPROVE",
    code,
    escalationId: id,
    receivedAtMs: Date.now(),
  });
  assert.equal(r.outcome, "IGNORED_OVER_CAP", "the snapshot was not honoured");
});
