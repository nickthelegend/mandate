/**
 * Drive the server the way an MCP client does: spawn the built binary and speak
 * JSON-RPC over stdio.
 *
 * The handlers are unit-tested in the SDK, so what is under test here is the
 * things only the transport can get wrong -- a stray console.log corrupting the
 * stream, a tool that fails to register, a schema the client cannot parse, or a
 * binary that is not executable. Those produce "the server is broken" with no
 * useful error in a real client, which is the worst possible failure mode for
 * something a judge is going to run once.
 *
 * Deliberately runs `dist/cli.js`, not the source: what ships is what is tested.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";

const CLI = join(import.meta.dirname, "../dist/cli.js");

type Rpc = { id: number; result?: unknown; error?: { message: string } };

/** A client that speaks just enough MCP to exercise the server. */
class Client {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = "";
  private pending = new Map<number, (r: Rpc) => void>();
  private nextId = 1;
  /** Everything the server wrote to stdout that was not valid JSON-RPC. */
  readonly junk: string[] = [];

  constructor(env: NodeJS.ProcessEnv = {}) {
    this.proc = spawn(process.execPath, [CLI], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as Rpc;
          this.pending.get(msg.id)?.(msg);
          this.pending.delete(msg.id);
        } catch {
          this.junk.push(line);
        }
      }
    });
  }

  send(method: string, params: unknown = {}): Promise<Rpc> {
    const id = this.nextId++;
    return new Promise<Rpc>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), 20_000);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method: string, params: unknown = {}): void {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async handshake(): Promise<Rpc> {
    const r = await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "outcome-stdio-test", version: "0" },
    });
    this.notify("notifications/initialized");
    return r;
  }

  async close(): Promise<void> {
    // A process that already exited will never emit "close" again, and awaiting
    // it hangs the whole run with no output -- which is what a crash at boot
    // looked like from here before the server learned to start without a key.
    if (this.proc.exitCode !== null || this.proc.signalCode !== null) return;
    this.proc.stdin.end();
    this.proc.kill();
    await once(this.proc, "close").catch(() => {});
  }
}

/** The text payload of a tools/call result, parsed. */
function payload(r: Rpc): Record<string, unknown> {
  const content = (r.result as { content?: { type: string; text: string }[] } | undefined)?.content;
  assert.ok(content?.length, `no content in result: ${JSON.stringify(r)}`);
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

test("the built binary exists and is the thing being tested", () => {
  assert.ok(existsSync(CLI), `${CLI} is missing -- run npm run build first`);
});

test("handshakes, lists all six tools, and keeps stdout clean", async (t) => {
  const c = new Client();
  t.after(() => c.close());

  const init = await c.handshake();
  assert.equal((init.result as { serverInfo: { name: string } }).serverInfo.name, "outcome");

  const listed = await c.send("tools/list");
  const names = (listed.result as { tools: { name: string; description: string }[] }).tools
    .map((x) => x.name)
    .sort();

  assert.deepEqual(names, [
    "outcome_audit",
    "outcome_diagnose",
    "outcome_get_intent",
    "outcome_intent_id",
    "outcome_settle",
    "outcome_verify",
  ]);

  // The banner goes to stderr. Anything on stdout that is not JSON-RPC breaks
  // real clients in a way that is very hard to diagnose from the other side.
  assert.deepEqual(c.junk, []);
});

test("derives an intent id deterministically, with no configuration", async (t) => {
  const c = new Client();
  t.after(() => c.close());
  await c.handshake();

  const args = { task: "deliver 1 tUSDC to treasury", payee: "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67" };
  const first = payload(await c.send("tools/call", { name: "outcome_intent_id", arguments: args }));
  const second = payload(await c.send("tools/call", { name: "outcome_intent_id", arguments: args }));

  assert.match(String(first.intentId), /^0x[0-9a-f]{64}$/);
  assert.equal(first.intentId, second.intentId);
});

test("diagnoses an in-flight execution as not worth resending", async (t) => {
  // The single most costly wrong answer this server can give: resending a
  // transaction that may already have landed pays twice.
  const c = new Client();
  t.after(() => c.close());
  await c.handshake();

  const d = payload(
    await c.send("tools/call", {
      name: "outcome_diagnose",
      arguments: { reason: "timeout waiting for confirmation", status: "pending" },
    })
  );

  assert.equal(d.cause, "in_flight");
  assert.equal(d.worthRescuing, false);
});

test("refuses to settle when no credential is configured, and says why", async (t) => {
  /*
   * Read-only tools work with no key at all -- that is the point. Settlement is
   * the one thing that moves money, so its refusal has to be an explicit,
   * legible answer rather than a crash or, far worse, a silent success.
   */
  const c = new Client({ KEEPERHUB_API_KEY: "" });
  t.after(() => c.close());
  await c.handshake();

  const r = payload(
    await c.send("tools/call", {
      name: "outcome_settle",
      arguments: { intentId: `0x${"11".repeat(32)}`, workTransactionHash: `0x${"22".repeat(32)}` },
    })
  );

  assert.equal(r.settled, false);
  assert.match(String(r.reason), /KEEPERHUB_API_KEY/);
});

test("outcome_settle exposes no way to assert a verdict", async (t) => {
  /*
   * The boundary that is the whole product. If a schema change ever adds a
   * `proven`, `done`, or `result` field here, an agent could talk its way to a
   * payout and this project would have become the thing it replaces.
   */
  const c = new Client();
  t.after(() => c.close());
  await c.handshake();

  const listed = await c.send("tools/list");
  const settle = (listed.result as { tools: { name: string; inputSchema: { properties?: object } }[] }).tools.find(
    (x) => x.name === "outcome_settle"
  );

  assert.ok(settle, "outcome_settle is not registered");
  assert.deepEqual(Object.keys(settle.inputSchema.properties ?? {}).sort(), [
    "intentId",
    "workTransactionHash",
  ]);
});
