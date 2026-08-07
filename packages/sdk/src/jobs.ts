/**
 * The job board.
 *
 * An intent commits to its task by hash and never stores the string, which is
 * what makes two agents given the same job collide on chain. The cost is that
 * the agent needs the preimage from somewhere, and a job it cannot reconstruct
 * is one it cannot prove it did -- so it declines rather than guessing.
 *
 * That makes where this lives a correctness question, not a convenience one. On
 * a container the file store is wiped by every redeploy, and the agent then
 * declines perfectly good open intents forever because the task strings are
 * gone. That is observable: the deployed agent was declining older intents for
 * exactly this reason.
 */

import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** What a job asks for. `intentId` is keccak(task|payee). */
export type Job = { intentId: string; task: string; deliverTo: string };

export type JobStore = {
  post(job: Job): Promise<void>;
  /** Every job this store knows, keyed by lowercased intent id. */
  all(): Promise<Map<string, Job>>;
  close?(): Promise<void>;
};

export function fileJobs(path: string): JobStore {
  return {
    async post(job) {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(job)}\n`);
    },
    async all() {
      const m = new Map<string, Job>();
      if (!existsSync(path)) return m;
      for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
        try {
          const j = JSON.parse(line) as Job;
          m.set(j.intentId.toLowerCase(), j);
        } catch {
          // A torn final line costs one job, not the board.
        }
      }
      return m;
    },
  };
}

export function memoryJobs(): JobStore {
  const m = new Map<string, Job>();
  return {
    async post(job) {
      m.set(job.intentId.toLowerCase(), job);
    },
    async all() {
      return new Map(m);
    },
  };
}

/**
 * Persisted, so a redeploy does not strand open intents.
 *
 * Upserted on the intent id: posting the same job twice is the same job, and a
 * duplicate row would only make `all()` ambiguous about which task string an
 * intent committed to.
 */
export async function mongoJobs(opts: {
  uri: string;
  db?: string;
  collection?: string;
}): Promise<JobStore> {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(opts.uri, { serverSelectionTimeoutMS: 15_000 });
  await client.connect();

  const col = client.db(opts.db ?? "outcome").collection<Job>(opts.collection ?? "jobs");
  await col.createIndex({ intentId: 1 }, { unique: true });

  return {
    async post(job) {
      await col.updateOne(
        { intentId: job.intentId.toLowerCase() },
        { $set: { ...job, intentId: job.intentId.toLowerCase() } },
        { upsert: true }
      );
    },
    async all() {
      const docs = await col.find({}, { projection: { _id: 0 } }).toArray();
      return new Map(docs.map((j) => [j.intentId.toLowerCase(), j as Job]));
    },
    async close() {
      await client.close();
    },
  };
}

/** Mongo when configured, disk otherwise. Same reasoning as the audit store. */
export async function jobsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fallbackPath = ".outcome/jobs.jsonl"
): Promise<JobStore> {
  if (env.MONGODB_URI) {
    return mongoJobs({
      uri: env.MONGODB_URI,
      db: env.OUTCOME_AUDIT_DB ?? "outcome",
      collection: env.OUTCOME_JOBS_COLLECTION ?? "jobs",
    });
  }
  return fileJobs(env.OUTCOME_JOBS ?? fallbackPath);
}
