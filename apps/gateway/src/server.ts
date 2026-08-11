#!/usr/bin/env node
/**
 * The spending authority, as a service.
 *
 * One job: decide whether an agent may spend, and if so make the spend happen
 * through KeeperHub. Nothing here serves content, sells anything, or takes a
 * payment -- an earlier version of this file was an x402 resource server that
 * proved a facilitator can report success and pay nobody, which was true and
 * was a different product. That surface is gone; what is left is the authority
 * and the evidence it produces.
 *
 *   GET  /authority                          the policy, its on-chain status, the budget
 *   POST /authority/spend                    ask to spend; the answer is binding
 *   GET  /authority/log                      every decision, approved and refused
 *   GET  /authority/score/<payee>            what the bureau says about a payee
 *   GET  /authority/escalations              spends held for a person
 *   POST /authority/escalation/<id>/resolve  a bound operator's answer
 *   GET  /execution/<id>                     KeeperHub's own account of an execution
 *   GET  /health
 */

import { createServer } from "node:http";
import { JsonRpcProvider } from "ethers";

import { KeeperHubClient } from "mandate-sdk/node";
import { readCosts, type Costs } from "./costs.ts";
import {
  createAuthority,
  POLICY_ID,
  REGISTRY,
  AGENT_ID,
  DEFAULT_AGENT,
  type Authority,
} from "./authority.ts";

/**
 * Which agent a request speaks for.
 *
 * Every agent under this policy gets its own budget and its own duplicate
 * window, so a caller that does not name one falls back to the shared agent
 * rather than silently borrowing somebody else's headroom.
 */
function agentOf(url: URL, body?: Record<string, unknown>): string | null {
  const raw = String(body?.agent ?? url.searchParams.get("agent") ?? DEFAULT_AGENT);
  return AGENT_ID.test(raw) ? raw : null;
}

const PORT = Number(process.env.PORT ?? 4402);
/** Where this server is reachable, for the self-call the demo endpoint makes. */
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;
const CHAIN_ID = 11155111;

const RPC = process.env.MANDATE_RPC_URL ?? process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
/** Resolved once, so /health and the authority cannot disagree about it. */
const MONGO_DB = process.env.MANDATE_AUDIT_DB ?? "mandate";


const provider = new JsonRpcProvider(RPC, CHAIN_ID);

/*
 * With a KeeperHub key the honest facilitator settles through KeeperHub and the
 * merchant never needs gas. Without one it falls back to the local wallet, so
 * the demo still runs for anyone who clones this without an account.
 */
const kh = process.env.KEEPERHUB_API_KEY
  ? new KeeperHubClient({ apiKey: process.env.KEEPERHUB_API_KEY })
  : undefined;


/*
 * The spending authority.
 *
 * Resolved lazily and cached, rather than at boot, because it needs Mongo and
 * a chain read and this server must still start and serve /health when neither
 * is reachable. A gateway that refuses to boot because one route's dependency
 * is down takes every other route with it.
 */
let authorityReady: Promise<Authority> | null = null;
function getAuthority(): Promise<Authority> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return Promise.reject(new Error("MONGODB_URI is not configured on this gateway"));
  if (!POLICY_ID) return Promise.reject(new Error("POLICY_ID is not configured on this gateway"));
  authorityReady ??= createAuthority({
    provider,
    kh: kh ?? null,
    mongoUri: uri,
    mongoDb: MONGO_DB,
  }).catch((e) => {
    // Do not cache a failed connection: the next request should try again.
    authorityReady = null;
    throw e;
  });
  return authorityReady;
}



const json = (res: import("node:http").ServerResponse, code: number, body: unknown, headers: Record<string, string> = {}) => {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(code, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "x-payment-response",
    ...headers,
  });
  res.end(payload);
};


/**
 * Read a request body, with a cap.
 *
 * The cap is not politeness: without one, an unauthenticated POST route lets
 * anyone hold this process's memory open for as long as they keep sending.
 */
async function readBody(req: import("node:http").IncomingMessage, limit = 16_384): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function clientIp(req: import("node:http").IncomingMessage): string {
  return (
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    "unknown"
  );
}

/** Brief cache for the third-party analytics read; see the /authority/costs route. */
let costCache: { at: number; body: Costs } | null = null;

/** The authority's own throttle: lease-fairness only, not a spend limit. */
const SPEND_THROTTLE_MS = 1_500;
const lastSpendAt = new Map<string, number>();

function spendAllowed(ip: string): number {
  const now = Date.now();
  const last = lastSpendAt.get(ip) ?? 0;
  const waitMs = last + SPEND_THROTTLE_MS - now;
  if (waitMs > 0) return waitMs;
  lastSpendAt.set(ip, now);
  return 0;
}


const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", PUBLIC_URL);

  // The console is served from a different origin, so preflight has to answer.
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, x-payment",
      "access-control-allow-methods": "GET, POST, OPTIONS",
    });
    return res.end();
  }

  /*
   * Health, meaning what this can actually reach.
   *
   * The old answer was `ok: true` and a list of what had been configured, which
   * says nothing: a gateway with a Mongo URI it cannot connect to and an RPC
   * that times out reported exactly the same thing as a working one. A health
   * check that cannot go red is decoration.
   *
   * Each dependency is probed with its own short deadline and reported
   * separately, and the aggregate is DOWN only when something the authority
   * genuinely cannot decide without is unreachable. KeeperHub being absent is
   * DEGRADED rather than DOWN — refusals still work without it, and refusing is
   * the half that matters.
   */
  if (url.pathname === "/health") {
    const started = Date.now();
    const probe = async (name: string, fn: () => Promise<string>) => {
      const t0 = Date.now();
      try {
        return { name, up: true, detail: await fn(), ms: Date.now() - t0 };
      } catch (e: unknown) {
        return { name, up: false, detail: e instanceof Error ? e.message.slice(0, 120) : String(e), ms: Date.now() - t0 };
      }
    };
    const deadline = <T,>(p: Promise<T>, ms: number): Promise<T> =>
      Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`no answer in ${ms}ms`)), ms))]);

    const checks = await Promise.all([
      probe("mongo", async () => {
        // A read, not a ping: a connection that is up but cannot serve the
        // ledger is not a working authority. The database NAME is reported
        // because it silently drifted once -- a local copy pointed at the
        // project's former name and every direct-database check read a stale
        // copy with a third of the rows, passing against the wrong system.
        const a = await deadline(getAuthority(), 8000);
        const n = (await a.history(1)).length;
        return `db "${MONGO_DB}" readable, ${n} decision${n === 1 ? "" : "s"} in the last page`;
      }),
      probe("sepolia", async () => {
        const b = await deadline(provider.getBlockNumber(), 8000);
        return `block ${b}`;
      }),
      probe("policy-anchor", async () => {
        const a = await deadline(getAuthority(), 8000);
        const s = await a.state();
        if ("error" in s.onChain) throw new Error(s.onChain.error);
        return `${s.onChain.status}, v${s.onChain.version}`;
      }),
      probe("keeperhub", async () => {
        if (!kh) throw new Error("no API key configured — refusals still work, approvals cannot move money");
        return "credential present";
      }),
    ]);

    const down = checks.filter((c) => !c.up).map((c) => c.name);
    // KeeperHub alone is degraded; anything else the decision depends on is down.
    const fatal = down.filter((n) => n !== "keeperhub");
    const status = fatal.length ? "DOWN" : down.length ? "DEGRADED" : "UP";

    return json(res, fatal.length ? 503 : 200, {
      ok: fatal.length === 0,
      status,
      /* Named so a caller can assert its own config matches production. */
      database: MONGO_DB,
      // Kept for the callers that already read these two.
      keeperhub: Boolean(kh),
      policyId: POLICY_ID || null,
      chainId: CHAIN_ID,
      token: process.env.MANDATE_TOKEN ?? "0x49C86277a91002c4943837bf20F6ED41976Db09F",
      checks,
      tookMs: Date.now() - started,
    });
  }

  /*
   * KeeperHub's execution record, proxied.
   *
   * The console is a static site and must never hold an API key, so it cannot
   * ask KeeperHub anything directly. This hands back the record unmodified:
   * what was simulated, what was sent, whether gas was sponsored, and what it
   * confirmed as.
   *
   * Read-only and unauthenticated on purpose. A settlement record is the thing
   * a resource server is implicitly trusting when it decides to serve, and a
   * record only the trusting party can read is not evidence.
   */
  /*
   * The decision record, in public.
   *
   * KeeperHub keeps an agent-action trail and exposes no agent-reachable read:
   * both routes are session-cookie only and no MCP tool touches it. So an agent
   * cannot audit the service that decides whether it gets paid.
   *
   * This one is readable by anyone, without a credential. A record only the
   * deciding party can read is a private note, not accountability -- and the
   * whole argument here is that you should not have to take a payment decision
   * on trust.
   */
  /*
   * The spending authority, live.
   *
   * GET  /authority        — the policy, its on-chain status, and what the
   *                          persisted ledger currently holds.
   * POST /authority/spend  — ask to spend. Judged against the anchored policy
   *                          and the durable ledger; on approval the money
   *                          actually moves through KeeperHub.
   * GET  /authority/log    — every decision, approved and refused.
   *
   * The budget here is real in the sense that matters: it is in Mongo, so it
   * does not reset when this container restarts and it is not per-replica. Ask
   * for more than remains and the refusal is not a rendering -- it is the
   * `budget.daily` rule reading a number that survived the last deploy.
   */
  if (url.pathname === "/authority") {
    try {
      const agent = agentOf(url);
      if (!agent) return json(res, 400, { error: "bad agent id" });
      return json(res, 200, await (await getAuthority()).state(agent));
    } catch (e: unknown) {
      return json(res, 503, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /*
   * The held spends, and the operator's answer to one.
   *
   * A refusal is final and needs no route. An escalation is the case where the
   * engine declined to decide alone, so there has to be somewhere the person it
   * asked can actually answer -- otherwise ESCALATED is just a refusal with a
   * longer name.
   */
  /*
   * Where a held-spend notice lands, and the record of what landed.
   *
   * The gateway asks KeeperHub to deliver the notice; KeeperHub posts it to the
   * operator's endpoint; by default that endpoint is this one. So the delivery
   * is written down by the receiving end rather than asserted by the sender,
   * and "the operator was notified" becomes a row anyone can read instead of a
   * claim from the party who was supposed to do the notifying.
   *
   * Unauthenticated on purpose, and it stores exactly what arrived with no
   * interpretation. It grants nothing: a notice carries no approval code, and
   * writing to this log cannot release a spend.
   */
  if (url.pathname === "/hook/operator") {
    if (req.method !== "POST") return json(res, 405, { error: "POST only" });
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "body must be JSON" });
    }
    try {
      const from = (req.headers["user-agent"] as string | undefined) ?? null;
      const { id } = await (await getAuthority()).recordDelivery(body, { from });
      return json(res, 200, { received: true, id });
    } catch (e: unknown) {
      return json(res, 503, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /*
   * What enforcement costs, from the executor's own books.
   *
   * Cached briefly: it is a third-party call on a public route, and a judge
   * refreshing the page should not turn into a burst against KeeperHub's
   * analytics API. Ninety seconds is long enough to absorb that and short
   * enough that the figure is still current.
   */
  if (url.pathname === "/authority/costs") {
    if (!kh) return json(res, 501, { error: "no KeeperHub key configured on this gateway" });
    const now = Date.now();
    if (costCache && now - costCache.at < 90_000) return json(res, 200, costCache.body);
    try {
      const body = await readCosts(process.env.KEEPERHUB_API_KEY!);
      costCache = { at: now, body };
      return json(res, 200, body);
    } catch (e: unknown) {
      return json(res, 503, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (url.pathname === "/authority/deliveries") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 100);
    try {
      const authority = await getAuthority();
      return json(res, 200, {
        destination: authority.notifyDestination(),
        entries: await authority.deliveries(limit),
      });
    } catch (e: unknown) {
      return json(res, 503, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (url.pathname === "/authority/escalations") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 25) || 25, 100);
    const status = url.searchParams.get("status") ?? undefined;
    try {
      const authority = await getAuthority();
      // Sweeping on read keeps expiry honest without a scheduler: nothing can
      // be listed as PENDING once its deadline has passed.
      await authority.sweepEscalations();
      const agent = agentOf(url);
      if (!agent) return json(res, 400, { error: "bad agent id" });
      const entries = await authority.escalations(limit, status, agent);
      return json(res, 200, {
        returned: entries.length,
        entries: entries.map((e) => ({
          ...e,
          // Never leave the process, even hashed.
          approvalCodeHash: undefined,
        })),
      });
    } catch (e: unknown) {
      return json(res, 503, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  {
    const m = url.pathname.match(/^\/authority\/escalation\/([A-Za-z0-9_]+)\/resolve$/);
    if (m) {
      if (req.method !== "POST") return json(res, 405, { error: "POST only" });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { error: "body must be JSON" });
      }
      const code = String(body.code ?? "");
      const operator = String(body.operator ?? "");
      const action = String(body.action ?? "").toUpperCase();
      if (action !== "APPROVE" && action !== "DENY") {
        return json(res, 400, { error: "action must be APPROVE or DENY" });
      }
      if (!/^[0-9a-f]{24}$/.test(code)) return json(res, 400, { error: "code is 24 hex characters" });
      if (!/^0x[0-9a-fA-F]{40}$/.test(operator)) {
        return json(res, 400, { error: "operator must be a 20-byte address" });
      }
      try {
        const authority = await getAuthority();
        const out = await authority.resolveEscalation({ id: m[1], code, operator, action });
        /*
         * 200 for every verified mandate, including the ignored ones. They are
         * not transport failures -- the service processed the response and
         * declined to honour it, and the body says which check refused.
         */
        return json(res, 200, out);
      } catch (e: unknown) {
        return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  if (url.pathname.startsWith("/authority/score/")) {
    const payee = url.pathname.slice("/authority/score/".length);
    if (!/^0x[0-9a-fA-F]{40}$/.test(payee)) {
      return json(res, 400, { error: "not a 20-byte address" });
    }
    try {
      return json(res, 200, await (await getAuthority()).score(payee));
    } catch (e: unknown) {
      return json(res, 503, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /*
   * The receipts, and the proof for one.
   *
   * A receipt is durable the instant a decision is made; the anchor arrives
   * afterwards, and `anchored` is only true once the batch is confirmed on
   * chain AND the merkle proof recomputes the root. A holder does not have to
   * take that on trust -- the proof is in the response and the check is a pure
   * function they can run themselves.
   */
  if (url.pathname === "/authority/receipts") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 100);
    try {
      const authority = await getAuthority();
      // Advance the ladder on read: no scheduler, and nothing sits queued
      // indefinitely just because the process is quiet.
      const moved = await authority.tickReceipts();
      const entries = await authority.receipts(limit);
      return json(res, 200, { moved, returned: entries.length, entries });
    } catch (e: unknown) {
      return json(res, 503, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (url.pathname.startsWith("/authority/receipt/")) {
    const id = url.pathname.slice("/authority/receipt/".length);
    if (!/^0x[0-9a-f]{64}$/i.test(id)) return json(res, 400, { error: "not a receipt id" });
    try {
      const authority = await getAuthority();
      const proof = await authority.receiptProof(id);
      if (!proof) return json(res, 404, { error: "no receipt, or it is not batched yet" });
      return json(res, 200, proof);
    } catch (e: unknown) {
      return json(res, 503, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (url.pathname === "/authority/log") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 25) || 25, 100);
    try {
      /*
       * No `agent` means the whole record, not the default partition.
       *
       * This route is the public decision log, and every real decision is
       * written under a per-agent partition — so defaulting to `shared` made
       * the one page whose entire argument is "the record is readable by
       * anyone" show an empty table to everyone. The console passes its own
       * agent and still gets only its own rows.
       */
      const asked = url.searchParams.get("agent");
      if (asked !== null && !AGENT_ID.test(asked)) return json(res, 400, { error: "bad agent id" });
      const agent = asked ?? undefined;
      const entries = await (await getAuthority()).history(limit, agent);
      return json(res, 200, { returned: entries.length, scope: agent ?? "all", entries });
    } catch (e: unknown) {
      return json(res, 503, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /*
   * Preflight: the same decision, nothing written.
   *
   * Not behind the throttle, because it costs a Mongo read and a chain read
   * and moves no money -- an agent that checks before it acts should not be
   * discouraged from checking. It is the same validation as /spend, so a
   * preflight cannot pass on input the real thing would reject.
   */
  if (url.pathname === "/authority/preflight" || url.pathname === "/authority/spend") {
    const isPreflight = url.pathname === "/authority/preflight";
    if (req.method !== "POST") return json(res, 405, { error: "POST only" });

    /*
     * Validated BEFORE the throttle, not after.
     *
     * The throttle used to run first, so a caller sending two malformed
     * requests got 429 for the second and never learned what was wrong with
     * the first. A rate limit is for well-formed traffic; a bad request should
     * be told it is bad immediately, and it costs nothing to say so.
     */
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "body must be JSON" });
    }

    const amount = Number(body.amount);
    const category = String(body.category ?? "market-data");
    const endpoint = String(body.endpoint ?? "https://api.example.com/v1/data");
    const recipient = String(body.recipient ?? "0x000000000000000000000000000000000000dEaD");
    const agent = agentOf(url, body);

    if (!Number.isFinite(amount) || amount <= 0) {
      return json(res, 400, { error: "amount must be a positive number of USDT" });
    }
    if (amount > 1_000_000) return json(res, 400, { error: "amount is implausible" });
    if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
      return json(res, 400, { error: "recipient must be a 20-byte address" });
    }
    if (!/^https?:\/\/[\w.-]+(:\d+)?(\/[\w./~%+-]*)?(\?[\w=&.%+-]*)?$/.test(endpoint) || endpoint.length > 300) {
      return json(res, 400, { error: "endpoint must be a plain http(s) URL" });
    }
    /*
     * The category is constrained here rather than only compared to the allow
     * list, because a refused spend is still RECORDED -- the decision log is
     * append-only and public by design, with no delete path. Anything accepted
     * here is therefore permanent and served to every reader of /authority/log.
     * A payload posted as a category once sat in that ledger for good.
     */
    if (!/^[a-z0-9][a-z0-9 _.-]{0,39}$/i.test(category)) {
      return json(res, 400, {
        error: "category must be 1-40 chars of letters, digits, space, dot, dash or underscore",
      });
    }
    if (!agent) {
      return json(res, 400, { error: "agent must be 3-64 chars of letters, digits, dash or underscore" });
    }

    try {
      const authority = await getAuthority();
      if (isPreflight) {
        return json(res, 200, await authority.preflight({ amount, category, endpoint, recipient, agent }));
      }
    } catch (e: unknown) {
      return json(res, 503, { error: e instanceof Error ? e.message : String(e) });
    }

    /*
     * The throttle is lease-fairness only, not a spend limit. This route
     * already has one, and it is the product: the policy's own budget, per
     * call cap and rate limit, enforced per agent from a persisted ledger.
     */
    const waitMs = spendAllowed(clientIp(req) + ":" + agent);
    if (waitMs > 0) {
      return json(res, 429, {
        error: "one decision at a time per client",
        retryAfterSeconds: Math.ceil(waitMs / 1000),
      });
    }

    try {
      const authority = await getAuthority();
      const mandate = await authority.decide({
        amount,
        category,
        endpoint,
        recipient,
        agent,
        // The nonce is what makes two identical requests distinguishable. Taken
        // from the clock rather than a counter so it survives a restart without
        // colliding with an intent already inside its duplicate window.
        nonce: Date.now(),
      });
      return json(res, 200, mandate);
    } catch (e: unknown) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (url.pathname.startsWith("/execution/")) {
    const id = url.pathname.slice("/execution/".length);
    if (!kh) return json(res, 501, { error: "no KeeperHub key configured on this gateway" });
    if (!/^[a-z0-9]{6,64}$/i.test(id)) return json(res, 400, { error: "not an execution id" });
    try {
      return json(res, 200, await kh.getStatus(id));
    } catch (e: unknown) {
      return json(res, 404, { error: e instanceof Error ? e.message : String(e) });
    }
  }


  return json(res, 404, { error: `no route ${url.pathname}` });
});

server.listen(PORT, () => {
  console.error(`mandate authority on :${PORT}`);
  console.error(`  chain     Sepolia (${CHAIN_ID})`);
  console.error(`  policy    ${POLICY_ID || "NOT CONFIGURED — set POLICY_ID"}`);
  console.error(`  registry  ${REGISTRY}`);
  console.error(`  keeperhub ${kh ? "configured" : "absent — spending is disabled"}`);
  console.error("");
  console.error("  POST /authority/preflight   would this be allowed? writes nothing");
  console.error("  POST /authority/spend       binding; on approval the money moves");
});
