/**
 * The decision record.
 *
 * Every verdict this system reaches gets written here: what was checked, what
 * was decided, and why. That is not bookkeeping, it is the product. A service
 * that decides whether an agent gets paid owes it an account of why, and
 * KeeperHub does not provide one -- its agent-action trail has no
 * agent-reachable read at all, both routes being session-cookie only with no
 * MCP tool touching it.
 *
 * Two stores, and the difference matters.
 *
 * `fileAudit` appends JSON lines to disk. Fine for a laptop, wrong for a
 * server: container filesystems are ephemeral, so on a redeploy the entire
 * record of why anyone was or was not paid disappears. An audit log that
 * empties on restart is a debug buffer.
 *
 * `mongoAudit` persists properly and is readable by anyone. That second part is
 * the point -- a record only the party doing the deciding can read is not
 * accountability, it is a private note.
 *
 * Both are append-only. There is no update path and no delete path, because a
 * decision record you can edit is not one.
 */

import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** One decision, as recorded. */
export type AuditEntry = {
  at: string;
  tool: string;
  intentId?: string;
  outcome: string;
  detail: string;
};

export type AuditStore = {
  append(entry: AuditEntry): Promise<void>;
  /** Newest last, so a reader sees the record in the order it happened. */
  recent(limit: number): Promise<AuditEntry[]>;
  /** Total decisions on record. */
  count(): Promise<number>;
  close?(): Promise<void>;
};

/**
 * Append-only JSON lines on disk.
 *
 * One write per decision and no rewrite path, so a crash mid-append costs the
 * torn entry rather than the file.
 */
export function fileAudit(path: string): AuditStore {
  const read = (): AuditEntry[] => {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as AuditEntry];
        } catch {
          // A half-written final line survives a crash. Skipping it loses one
          // decision; throwing would lose every earlier one.
          return [];
        }
      });
  };

  return {
    async append(entry) {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(entry)}\n`);
    },
    async recent(limit) {
      return read().slice(-limit);
    },
    async count() {
      return read().length;
    },
  };
}

/** Keeps decisions only for the life of the process. Tests use this. */
export function memoryAudit(): AuditStore {
  const entries: AuditEntry[] = [];
  return {
    async append(entry) {
      entries.push(entry);
    },
    async recent(limit) {
      return entries.slice(-limit);
    },
    async count() {
      return entries.length;
    },
  };
}

/**
 * Persisted, and readable by anyone.
 *
 * `mongodb` is imported dynamically so that requiring this module does not drag
 * a database driver into a process that only wants the file store -- which is
 * most of them, including every test.
 */
export async function mongoAudit(opts: {
  uri: string;
  db?: string;
  collection?: string;
}): Promise<AuditStore> {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(opts.uri, { serverSelectionTimeoutMS: 15_000 });
  await client.connect();

  const col = client.db(opts.db ?? "outcome").collection<AuditEntry>(opts.collection ?? "audit");

  /*
   * Indexed on `at` because every read is "the most recent N", and on intentId
   * because the useful question about a specific payment is "what was decided
   * about this one, and when".
   */
  await col.createIndex({ at: -1 });
  await col.createIndex({ intentId: 1 });

  return {
    async append(entry) {
      await col.insertOne({ ...entry });
    },
    async recent(limit) {
      const docs = await col.find({}, { projection: { _id: 0 } }).sort({ at: -1 }).limit(limit).toArray();
      // Query descending for the index, hand back ascending so the caller reads
      // the record in the order it happened.
      return docs.reverse() as AuditEntry[];
    },
    async count() {
      return col.countDocuments();
    },
    async close() {
      await client.close();
    },
  };
}

/**
 * Pick a store from the environment.
 *
 * Mongo when a URI is configured, disk otherwise. Deliberately silent about the
 * fallback rather than throwing: a laptop with no database should still record
 * its decisions, and refusing to run would trade a working local setup for a
 * purity that helps nobody.
 */
export async function auditFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<AuditStore> {
  if (env.OUTCOME_AUDIT_LOG === "-") return memoryAudit();

  const path = env.OUTCOME_AUDIT_LOG ?? ".outcome/audit.jsonl";
  if (!env.MONGODB_URI) return fileAudit(path);

  try {
    return await mongoAudit({
      uri: env.MONGODB_URI,
      db: env.OUTCOME_AUDIT_DB ?? "outcome",
      collection: env.OUTCOME_AUDIT_COLLECTION ?? "audit",
    });
  } catch (err: unknown) {
    /*
     * An unreachable database degrades the record; it must not take the service
     * down with it. A settlement rail that stops settling because its audit
     * store is unreachable has made the log more important than the payment,
     * which is the wrong way round.
     *
     * Loud on stderr rather than silent, because the difference between "no
     * database configured" and "the database refused us" matters to whoever is
     * operating this -- the second one usually means an IP allowlist.
     */
    console.error(
      "[outcome] audit database unreachable, falling back to file store:",
      err instanceof Error ? err.message.split("\n")[0] : err
    );
    return fileAudit(path);
  }
}
