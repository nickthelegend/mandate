#!/usr/bin/env node
/**
 * An x402 resource server that checks it was actually paid.
 *
 * The protocol flow is unchanged and fully standard:
 *
 *   GET /article                 -> 402 + PaymentRequirements
 *   GET /article  X-PAYMENT: ..  -> facilitator settles -> 200 + resource
 *
 * One step is added between settling and serving. x402 ends at "the facilitator
 * said success"; this reads the transaction the facilitator named and confirms
 * the money reached `payTo` before the resource is released. If it did not, the
 * request gets another 402 carrying the actual reason.
 *
 * Run it against `?facilitator=lying` to watch the difference. That mode
 * settles by submitting an `approve` -- which mines, emits a log, and pays
 * nobody -- and reports success. A stock x402 server serves the article. This
 * one does not, and says why.
 */

import { createServer } from "node:http";
import { JsonRpcProvider, Wallet } from "ethers";

import { OutcomeClient } from "outcome-sdk";
import { KeeperHubClient, auditFromEnv, jobsFromEnv, type AuditStore, type JobStore } from "outcome-sdk/node";
import {
  paymentRequired,
  decodePaymentHeader,
  encodeSettlementHeader,
  verifySettlement,
  type PaymentRequirements,
} from "outcome-sdk/x402";

import { createFacilitator, type FacilitatorMode } from "./facilitator.ts";
import { runPurchase } from "./flow.ts";
import { runAgentCycle } from "./agent-run.ts";
import { createAuthority, POLICY_ID, type Authority } from "./authority.ts";

const PORT = Number(process.env.PORT ?? 4402);
/** Where this server is reachable, for the self-call the demo endpoint makes. */
const PUBLIC_URL = process.env.PUBLIC_URL ?? `http://localhost:${PORT}`;
const NETWORK = "sepolia";
const CHAIN_ID = 11155111;

const RPC = process.env.OUTCOME_RPC_URL ?? process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const ASSET = process.env.X402_ASSET ?? "0x0d864A625c280F7f9B9AD024d12F94f5D6DCCF13";
const ESCROW = process.env.OUTCOME_ESCROW ?? "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B";
const PRICE = process.env.X402_PRICE ?? "1000000"; // 1.00 USDCx

/*
 * The merchant is deliberately not the facilitator. They are different roles in
 * x402 and collapsing them into one address would make the demo a self-transfer
 * -- which verifies, but proves nothing, since the party checking the payment
 * would also be the party receiving it.
 */
const PAY_TO = process.env.X402_PAY_TO ?? "0x000000000000000000000000000000000000dEaD";

const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key) {
  console.error("DEPLOYER_PRIVATE_KEY is required: the facilitator submits real transactions.");
  process.exit(1);
}

const provider = new JsonRpcProvider(RPC, CHAIN_ID);
const wallet = new Wallet(key, provider);

/*
 * With a KeeperHub key the honest facilitator settles through KeeperHub and the
 * merchant never needs gas. Without one it falls back to the local wallet, so
 * the demo still runs for anyone who clones this without an account.
 */
const kh = process.env.KEEPERHUB_API_KEY
  ? new KeeperHubClient({ apiKey: process.env.KEEPERHUB_API_KEY })
  : undefined;
const outcome = new OutcomeClient({ provider, escrow: ESCROW, token: ASSET, chainId: CHAIN_ID });

/*
 * Persisted stores, resolved once at boot.
 *
 * Both were files before, and on a container a file is wiped by every redeploy.
 * For the job board that is a correctness bug -- the agent loses the task
 * strings and then declines perfectly good open intents forever. For the
 * decision record it is worse: the account of why anyone was or was not paid
 * disappears, which is the one thing this service exists to keep.
 */
const auditReady: Promise<AuditStore> = auditFromEnv();
const jobsReady: Promise<JobStore> = jobsFromEnv();

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
    mongoDb: process.env.OUTCOME_AUDIT_DB ?? "outcome",
  }).catch((e) => {
    // Do not cache a failed connection: the next request should try again.
    authorityReady = null;
    throw e;
  });
  return authorityReady;
}

/** The article, which is the thing being sold. */
const ARTICLE = {
  title: "A status byte is not evidence",
  body:
    "status: 0x1 means the EVM did not revert. It does not mean value moved. " +
    "A transaction can mine, emit no Transfer, pay nobody, and satisfy every " +
    "check x402 performs. You are reading this because the settlement that " +
    "bought it was checked against the chain, not against a facilitator's word.",
};

function requirements(resource: string): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    maxAmountRequired: PRICE,
    asset: ASSET,
    payTo: PAY_TO,
    resource,
    description: ARTICLE.title,
    mimeType: "application/json",
    maxTimeoutSeconds: 120,
    // EIP-712 domain the payer must sign under. x402 carries this in `extra`.
    extra: { name: "USD Coin (x402 test)", version: "2" },
  };
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

/*
 * A crude rate limit on /demo.
 *
 * Every call signs a real authorisation, settles a real transaction and burns
 * KeeperHub execution quota. Public and unmetered, one person holding down
 * refresh drains the testnet float and the demo stops working for everyone
 * else -- which is a worse outcome than making them wait a few seconds.
 *
 * In-memory and per-process on purpose: this is one small server, and a shared
 * store would be more machinery than the problem deserves.
 */
const DEMO_COOLDOWN_MS = 15_000;
const lastDemoAt = new Map<string, number>();

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

function demoAllowed(ip: string): number {
  const now = Date.now();
  const last = lastDemoAt.get(ip) ?? 0;
  const waitMs = last + DEMO_COOLDOWN_MS - now;
  if (waitMs > 0) return waitMs;
  lastDemoAt.set(ip, now);
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

  if (url.pathname === "/health") return json(res, 200, { ok: true, asset: ASSET, payTo: PAY_TO, facilitator: wallet.address });

  /*
   * The whole purchase, run server-side, returned as a trace.
   *
   * A browser cannot sign an EIP-3009 authorisation without a key, and putting
   * one in a page would be worse than having no demo. So the server plays the
   * payer -- the same code path the CLI client uses, not a reimplementation --
   * and hands back what happened at each step.
   *
   * Every step is real: a real 402, a real signature, a real Sepolia
   * settlement. Nothing is replayed from a recording.
   */
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
      return json(res, 200, await (await getAuthority()).state());
    } catch (e: unknown) {
      return json(res, 503, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (url.pathname === "/authority/log") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 25) || 25, 100);
    try {
      const entries = await (await getAuthority()).history(limit);
      return json(res, 200, { returned: entries.length, entries });
    } catch (e: unknown) {
      return json(res, 503, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (url.pathname === "/authority/spend") {
    if (req.method !== "POST") return json(res, 405, { error: "POST only" });

    /*
     * Deliberately not behind the /demo cooldown.
     *
     * This route already has a spend limiter, and it is the product: $5 a day,
     * $1 a call, 20 calls an hour, enforced from a persisted ledger against a
     * policy anchored on chain. Bolting an IP cooldown on top would rate-limit
     * the refusals -- which are free, and are the thing a reader most wants to
     * click through -- while adding nothing to the approvals the policy is
     * already bounding. If the daily budget is not sufficient protection for
     * this endpoint, then the whole claim being made here is wrong.
     *
     * The short throttle that remains is only to keep one client from holding
     * the partition lease continuously and starving everyone else.
     */
    const waitMs = spendAllowed(clientIp(req));
    if (waitMs > 0) {
      return json(res, 429, {
        error: "one decision at a time per client",
        retryAfterSeconds: Math.ceil(waitMs / 1000),
      });
    }

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

    // Validated here so a bad request is answered as a bad request, rather than
    // reaching the engine and coming back as a policy refusal it did not earn.
    if (!Number.isFinite(amount) || amount <= 0) {
      return json(res, 400, { error: "amount must be a positive number of USDT" });
    }
    if (amount > 1_000_000) return json(res, 400, { error: "amount is implausible" });
    if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
      return json(res, 400, { error: "recipient must be a 20-byte address" });
    }
    if (!/^https?:\/\//.test(endpoint)) return json(res, 400, { error: "endpoint must be a URL" });

    try {
      const authority = await getAuthority();
      const outcome = await authority.decide({
        amount,
        category,
        endpoint,
        recipient,
        // The nonce is what makes two identical requests distinguishable. Taken
        // from the clock rather than a counter so it survives a restart without
        // colliding with an intent already inside its duplicate window.
        nonce: Date.now(),
      });
      return json(res, 200, outcome);
    } catch (e: unknown) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (url.pathname === "/audit") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
    try {
      const store = await auditReady;
      const [entries, total] = await Promise.all([store.recent(limit), store.count()]);
      return json(res, 200, { total, returned: entries.length, entries });
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

  /*
   * One full agent cycle: a payer posts a job and escrows, then the agent finds
   * it, does the work and settles. Real transactions throughout.
   *
   * Shares the /demo cooldown budget deliberately -- an agent cycle is four
   * on-chain transactions and is the more expensive of the two.
   */
  if (url.pathname === "/agent") {
    const ip = clientIp(req);
    const waitMs = demoAllowed(ip);
    if (waitMs > 0) {
      return json(res, 429, {
        error: "one run at a time, please - each one is several real transactions",
        retryAfterSeconds: Math.ceil(waitMs / 1000),
      });
    }
    if (!kh) return json(res, 501, { error: "no KeeperHub key configured on this gateway" });
    try {
      const [audit, jobs] = await Promise.all([auditReady, jobsReady]);
      return json(res, 200, await runAgentCycle({ provider, wallet, kh, chainId: CHAIN_ID, audit, jobs }));
    } catch (e: unknown) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (url.pathname === "/demo") {
    const waitMs = demoAllowed(clientIp(req));
    if (waitMs > 0) {
      return json(res, 429, {
        error: "one demo run at a time, please - each one is a real transaction",
        retryAfterSeconds: Math.ceil(waitMs / 1000),
      });
    }

    const mode = url.searchParams.get("facilitator") === "lying" ? "lying" : "honest";
    try {
      const result = await runPurchase({
        baseUrl: PUBLIC_URL,
        facilitator: mode,
        payerKey: key,
        rpcUrl: RPC,
        chainId: CHAIN_ID,
      });
      return json(res, 200, result);
    } catch (e: unknown) {
      return json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (url.pathname !== "/article") {
    return json(res, 404, { error: "not found", try: "/article" });
  }

  const resource = `${PUBLIC_URL}/article`;
  const req402 = requirements(resource);
  const header = req.headers["x-payment"];

  // No payment yet: quote the price. This is a plain x402 402.
  if (!header || typeof header !== "string") {
    return json(res, 402, paymentRequired(req402, "payment required"));
  }

  let payment;
  try {
    payment = decodePaymentHeader(header);
  } catch (e: unknown) {
    return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }

  const mode = (url.searchParams.get("facilitator") ?? "honest") as FacilitatorMode;
  const facilitator = createFacilitator({
    mode,
    provider,
    wallet,
    network: NETWORK,
    chainId: CHAIN_ID,
    kh,
  });

  console.log(`[gateway] settling via the ${mode} facilitator, submitted by ${facilitator.submittedVia}…`);
  const settlement = await facilitator.settle(payment, ASSET);
  console.log(`[gateway] facilitator says: success=${settlement.success} tx=${settlement.transaction || "(none)"}`);

  // The step x402 does not have.
  const verdict = await verifySettlement(outcome, { requirements: req402, settlement });
  console.log(`[gateway] chain says: proven=${verdict.proven} — ${verdict.reason}`);

  /*
   * Record it. This is the decision the gateway exists to make -- whether a
   * settlement the facilitator called successful actually paid -- so it is the
   * one most worth being able to read back later, and the one a buyer has most
   * reason to want independently checkable.
   *
   * Fire-and-forget: a resource must not be withheld because the record was
   * slow to write, and it must not be served unrecorded in silence either, so a
   * failed write goes to stderr rather than being swallowed.
   */
  void auditReady
    .then((store) =>
      store.append({
        at: new Date().toISOString(),
        tool: "x402_settlement",
        outcome: verdict.proven ? "proven" : "not_proven",
        detail:
          `${mode} facilitator claimed ${settlement.success}; ` +
          `chain moved ${verdict.observed} to ${req402.payTo}. ${verdict.reason}`,
      })
    )
    .catch((e: unknown) => console.error("[gateway] audit write failed:", e));

  if (!verdict.proven) {
    /*
     * Another 402 rather than a 500. Nothing errored: the request is still
     * unpaid, and saying so in the protocol's own terms is what lets a client
     * retry properly.
     */
    return json(
      res,
      402,
      {
        ...paymentRequired(req402, "settlement did not pay"),
        outcome: {
          facilitatorClaimedSuccess: verdict.facilitatorClaimedSuccess,
          transaction: settlement.transaction || null,
          observed: verdict.observed.toString(),
          reason: verdict.reason,
        },
      },
      settlement.transaction ? { "x-payment-response": encodeSettlementHeader(settlement) } : {}
    );
  }

  return json(
    res,
    200,
    {
      ...ARTICLE,
      paidWith: {
        transaction: settlement.transaction,
        observed: verdict.observed.toString(),
        proof: verdict.proof,
        verifiedAgainst: "the receipt, not the facilitator",
        submittedVia: facilitator.submittedVia,
        executionId: facilitator.lastExecutionId,
      },
    },
    { "x-payment-response": encodeSettlementHeader(settlement) }
  );
});

server.listen(PORT, () => {
  console.log(`x402 gateway on http://localhost:${PORT}`);
  console.log(`  resource  GET /article`);
  console.log(`  price     ${PRICE} of ${ASSET}`);
  console.log(`  payTo     ${PAY_TO} (merchant)`);
  console.log(`  submitter ${kh ? "KeeperHub (gas sponsored, merchant needs no ETH)" : wallet.address + " (local wallet)"}`);
  console.log(`  network   ${NETWORK} (${CHAIN_ID})`);
  console.log(`\n  try ?facilitator=lying to see a settlement that reports success and pays nobody.`);
});
