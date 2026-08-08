/**
 * Tests for the decision record.
 *
 * The properties worth pinning are the ones that make it a record rather than a
 * log: it survives the process, it reads back in the order things happened, and
 * a torn write costs one entry instead of the file.
 *
 * The Mongo store is exercised against a real database when MONGODB_URI is set
 * and skipped otherwise, rather than mocked. A mocked database proves the mock
 * works; the whole reason this store exists is that the file one does not
 * survive a redeploy, and only a real connection can show that it does.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fileAudit, memoryAudit, mongoAudit, auditFromEnv, type AuditEntry } from "../src/audit.ts";

const entry = (n: number): AuditEntry => ({
  at: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
  tool: "outcome_verify",
  intentId: `0x${String(n).padStart(64, "0")}`,
  outcome: n % 2 === 0 ? "proven" : "not_proven",
  detail: `decision ${n}`,
});

function tmpPath(): string {
  return join(mkdtempSync(join(tmpdir(), "outcome-audit-")), "audit.jsonl");
}

test("the file store survives a new instance reading the same path", async () => {
  // The minimum bar for a record: close the process, open it again, still there.
  const path = tmpPath();
  const a = fileAudit(path);
  await a.append(entry(1));
  await a.append(entry(2));

  const b = fileAudit(path);
  assert.equal(await b.count(), 2);
  assert.equal((await b.recent(10))[1]!.detail, "decision 2");
});

test("a torn final line costs one entry, not the file", async () => {
  /*
   * A crash mid-append leaves half a line. Throwing there would lose every
   * earlier decision to protect the one that was never finished.
   */
  const path = tmpPath();
  const a = fileAudit(path);
  await a.append(entry(1));
  await a.append(entry(2));
  appendFileSync(path, '{"at":"2026-01-01T00:00:03.000Z","tool":"outcome_ver');

  assert.equal(await a.count(), 2);
  assert.equal((await a.recent(10)).length, 2);
});

test("an unreadable file reads as empty rather than throwing", async () => {
  const path = tmpPath();
  writeFileSync(path, "not json at all\nnor this\n");
  assert.deepEqual(await fileAudit(path).recent(10), []);
});

test("recent hands back the oldest first, capped", async () => {
  const store = memoryAudit();
  for (let n = 1; n <= 5; n++) await store.append(entry(n));

  const last3 = await store.recent(3);
  assert.deepEqual(
    last3.map((e) => e.detail),
    ["decision 3", "decision 4", "decision 5"],
    "newest last, so the record reads in the order it happened"
  );
  assert.equal(await store.count(), 5);
});

test("auditFromEnv opts out of persistence only when asked", async () => {
  const store = await auditFromEnv({ OUTCOME_AUDIT_LOG: "-" } as NodeJS.ProcessEnv);
  await store.append(entry(1));
  assert.equal(await store.count(), 1);

  const path = tmpPath();
  const onDisk = await auditFromEnv({ OUTCOME_AUDIT_LOG: path } as NodeJS.ProcessEnv);
  await onDisk.append(entry(1));
  assert.equal(await fileAudit(path).count(), 1, "wrote to the path it was given");
});

const MONGO = process.env.MONGODB_URI;

test(
  "the mongo store persists across connections and reads back in order",
  { skip: MONGO ? false : "MONGODB_URI not set" },
  async (t) => {
    // A throwaway collection per run, so a failing test cannot poison the real
    // record and two runs cannot see each other's entries.
    const collection = `audit_test_${Date.now()}`;
    const open = () => mongoAudit({ uri: MONGO!, db: "outcome", collection });

    const a = await open();
    t.after(async () => {
      /*
       * Drop it, do not just disconnect. An earlier version only closed the
       * connection and left a collection behind on every run, which turns a
       * shared cluster into a junkyard -- and this suite runs against the same
       * database the deployed service writes to.
       */
      const { MongoClient } = await import("mongodb");
      const client = new MongoClient(MONGO!, { serverSelectionTimeoutMS: 15_000 });
      await client.connect();
      await client.db("outcome").collection(collection).drop().catch(() => {});
      await client.close();
      await a.close?.();
    });

    for (let n = 1; n <= 3; n++) await a.append(entry(n));
    await a.close?.();

    // A different connection entirely: this is the property the file store
    // cannot offer on a container.
    const b = await open();
    assert.equal(await b.count(), 3);
    assert.deepEqual(
      (await b.recent(10)).map((e) => e.detail),
      ["decision 1", "decision 2", "decision 3"]
    );
    assert.equal((await b.recent(2))[0]!.detail, "decision 2", "capped from the newest end");
    await b.close?.();
  }
);

test("an unreachable database degrades to the file store instead of throwing", async () => {
  /*
   * The gateway died at boot on exactly this: Atlas refused the connection and
   * auditFromEnv threw, so a settlement rail stopped settling because its
   * *log* was unreachable. That is the wrong way round -- the record matters,
   * but not more than the payment it records.
   */
  const path = tmpPath();
  const store = await auditFromEnv({
    // A routable address that will not answer as MongoDB, with the driver's own
    // timeout doing the work rather than a fake.
    MONGODB_URI: "mongodb://127.0.0.1:1/outcome?serverSelectionTimeoutMS=1500",
    OUTCOME_AUDIT_LOG: path,
  } as NodeJS.ProcessEnv);

  await store.append(entry(1));
  assert.equal(await store.count(), 1, "still recording, just not to the database");
  assert.equal(await fileAudit(path).count(), 1, "and it landed on disk");
});
