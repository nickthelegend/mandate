/**
 * The in-flight idempotency key must not be read as a failure.
 *
 * THE INCIDENT
 *
 * On 2026-08-10 the live authority approved a $0.50 spend, called
 * `transferAndConfirm`, and reported: "A request with this Idempotency-Key is
 * already being processed." The caller recorded an execution error. On chain,
 * 0.50 tUSDC had reached the recipient at
 * 0xe022db608b70fb33df3ccfada0f4b4bf391051c4c3d82b3c27820839478e5b64.
 *
 * The money moved and the caller was told it had not.
 *
 * That is this project's own thesis turned around. x402 reports success on a
 * payment that moved nothing; this reported failure on a payment that moved.
 * The second is worse in one specific way: a caller that believes a payment
 * failed retries it, and a retry under a fresh key is a second payment.
 *
 * THE CAUSE
 *
 * 409 `idempotency_in_progress` was already classified correctly as
 * `in_flight` and marked retryable, so the transport's generic ladder retried
 * it -- 1s, 2s, 4s, then gave up. A KeeperHub execution takes twenty to thirty
 * seconds. The ladder was tuned for a flaky socket, not for waiting out a
 * transaction, so it always ran out first.
 *
 * These tests pin the fixed behaviour: keep polling the key against the
 * CALLER's timeout budget, and surface the original execution once it appears.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { KeeperHubClient } from "../src/keeperhub/client.ts";

const IN_FLIGHT = {
  status: 409,
  body: { error: "A request with this Idempotency-Key is already being processed.", code: "idempotency_in_progress" },
};

/**
 * A fetch that answers 409 in-flight `n` times, then returns the execution --
 * exactly what KeeperHub does once the original attempt finishes registering.
 */
function fetchThatSettlesAfter(n: number, log: string[] = []) {
  let posts = 0;
  return {
    log,
    fetch: async (url: string, init?: { method?: string }): Promise<Response> => {
      const path = new URL(url).pathname;
      log.push(`${init?.method ?? "GET"} ${path}`);

      if (init?.method === "POST") {
        posts += 1;
        if (posts <= n) {
          return new Response(JSON.stringify(IN_FLIGHT.body), {
            status: 409,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ executionId: "exec_recovered" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      // Status poll: terminal immediately, so the test measures the accept path.
      return new Response(
        JSON.stringify({
          executionId: "exec_recovered",
          status: "completed",
          transactionHash: "0xe022db608b70fb33df3ccfada0f4b4bf391051c4c3d82b3c27820839478e5b64",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    },
  };
}

function client(fetchImpl: typeof fetch, over: Record<string, unknown> = {}) {
  return new KeeperHubClient({
    apiKey: "kh_test",
    fetchImpl: fetchImpl as never,
    maxRetries: 0,
    statusPollMs: 10,
    statusTimeoutMs: 5_000,
    ...over,
  } as never);
}

test("an in-flight key resolves to the original execution rather than throwing", async () => {
  // Three 409s is longer than the old 1s/2s/4s ladder would have survived.
  const f = fetchThatSettlesAfter(3);
  const kh = client(f.fetch as never);

  const status = await kh.transferAndConfirm(
    {
      chainId: 11155111,
      recipientAddress: "0x000000000000000000000000000000000000dEaD",
      amount: "0.500000",
      tokenAddress: "0x49C86277a91002c4943837bf20F6ED41976Db09F",
    },
    { idempotencyKey: "0xdeadbeef", timeoutMs: 5_000 }
  );

  assert.equal(status.status, "completed");
  assert.equal(
    status.transactionHash,
    "0xe022db608b70fb33df3ccfada0f4b4bf391051c4c3d82b3c27820839478e5b64",
    "the transaction the original attempt landed was not surfaced"
  );

  // Four POSTs: three refused as in-flight, the fourth returning the original.
  assert.equal(f.log.filter((l) => l.startsWith("POST")).length, 4);
});

test("the same recovery applies to a contract call", async () => {
  const f = fetchThatSettlesAfter(2);
  const kh = client(f.fetch as never);

  const status = await kh.executeAndConfirm(
    {
      contractAddress: "0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304",
      chainId: 11155111,
      functionName: "pausePolicy",
      abi: "[]",
      functionArgs: "[]",
    },
    { idempotencyKey: "0xfeedface", timeoutMs: 5_000 }
  );

  assert.equal(status.status, "completed");
});

test("a key that never resolves still fails, inside the caller's budget", async () => {
  // Not "retry forever": an authority that hangs is its own outage.
  const f = fetchThatSettlesAfter(Number.MAX_SAFE_INTEGER);
  const kh = client(f.fetch as never);

  const started = Date.now();
  await assert.rejects(
    kh.transferAndConfirm(
      {
        chainId: 11155111,
        recipientAddress: "0x000000000000000000000000000000000000dEaD",
        amount: "0.500000",
      },
      { idempotencyKey: "0xstuck", timeoutMs: 300 }
    ),
    /already being processed/
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3_000, `waited ${elapsed}ms, well past the 300ms budget`);
});

test("an error that is not in-flight is not waited out", async () => {
  // A 400 is terminal. Polling it would turn a bad request into a slow one.
  let posts = 0;
  const kh = client((async (_u: string, init?: { method?: string }) => {
    if (init?.method === "POST") {
      posts += 1;
      return new Response(JSON.stringify({ error: "amount must be positive" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 200 });
  }) as never);

  await assert.rejects(
    kh.transferAndConfirm(
      { chainId: 11155111, recipientAddress: "0x000000000000000000000000000000000000dEaD", amount: "-1" },
      { idempotencyKey: "0xbad", timeoutMs: 5_000 }
    ),
    /amount must be positive/
  );
  assert.equal(posts, 1, "a terminal validation error was retried");
});
