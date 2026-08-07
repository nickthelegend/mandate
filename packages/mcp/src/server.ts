/**
 * The Outcome MCP server: the settlement loop, as tools an agent can call.
 *
 * A thin transport over the SDK. The handlers hold the logic and are tested
 * directly, so this file stays boring on purpose -- if it ever needs a test of
 * its own, something has leaked into the wrong layer.
 *
 * The tool descriptions are part of the product. A model choosing between these
 * has only the description to go on, and the single most important thing it
 * must not do is treat `outcome_settle` as "mark this done". Each one says what
 * evidence it reads and what it will refuse.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { JsonRpcProvider } from "ethers";
import { createTools, KeeperHubClient, auditFromEnv, type AuditStore } from "outcome-sdk/node";

import { loadConfig, type Config } from "./config.ts";

export const VERSION = "0.1.0";

/**
 * A KeeperHub client for the case where there is no key.
 *
 * `new KeeperHubClient({ apiKey: "" })` throws, which would take the whole
 * server down at boot and make the read-only tools -- the ones that need no
 * credential and are the reason this thing is useful to a stranger --
 * unreachable. So the credential-free path gets an object that is fine to hold
 * and fails only if something actually tries to settle through it.
 *
 * Nothing should ever reach it: `outcome_settle` checks for a key first. It
 * throws rather than returning a fake success precisely because a settlement
 * that silently does nothing is the bug this project exists to expose.
 */
function unconfiguredKeeperHub(): KeeperHubClient {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(
          "settlement requires KEEPERHUB_API_KEY. Reading and verification do not."
        );
      },
    }
  ) as KeeperHubClient;
}

export function createServer(config: Config = loadConfig(), audit?: AuditStore): McpServer {
  const tools = createTools(
    {
      provider: new JsonRpcProvider(config.rpcUrl, config.chainId),
      kh: config.keeperHubApiKey
        ? new KeeperHubClient({ apiKey: config.keeperHubApiKey })
        : unconfiguredKeeperHub(),
      escrow: config.escrow,
      token: config.token,
      chainId: config.chainId,
    },
    audit ? { audit } : { auditPath: config.auditPath }
  );

  const server = new McpServer({ name: "outcome", version: VERSION });
  const json = (v: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }],
  });

  server.tool(
    "outcome_intent_id",
    "Derive the intent id for a piece of work. Two agents given the same task and payee get the same id, so a duplicate claim is refused on chain rather than paid for twice. Call this before starting work to check whether someone is already on it.",
    { task: z.string(), payee: z.string() },
    async (a) => json(tools.outcome_intent_id(a))
  );

  server.tool(
    "outcome_get_intent",
    "Read an intent's current state: none, open, released or refunded. Also returns the beneficiary, which is the address the work actually has to reach.",
    { intentId: z.string() },
    async (a) => json(await tools.outcome_get_intent(a))
  );

  server.tool(
    "outcome_verify",
    "Ask whether a transaction actually moved value. Reads the receipt and looks for a real ERC-20 Transfer to the recipient. A status of 0x1 only means the EVM did not revert -- a transaction can mine successfully, emit no logs, transfer nothing, and still look like a payment. Read-only: this never moves money.",
    { transactionHash: z.string(), recipient: z.string(), minAmount: z.string() },
    async (a) => json(await tools.outcome_verify(a))
  );

  server.tool(
    "outcome_settle",
    "Settle an intent from evidence. Pass the hash of the transaction that did the work; this reads the receipt itself and decides, releasing to the payee if the transfer is proven and refunding the payer if it is not. It does not accept a verdict, a 'done' flag, or a description of the work -- only a transaction hash. If the work is not on chain yet, do not call this.",
    { intentId: z.string(), workTransactionHash: z.string() },
    async (a) => {
      if (!config.keeperHubApiKey) {
        return json({
          settled: false,
          reason:
            "settlement is disabled: no KEEPERHUB_API_KEY is configured. Reading and verification work without one; only moving money needs a key.",
        });
      }
      return json(await tools.outcome_settle(a));
    }
  );

  server.tool(
    "outcome_diagnose",
    "Explain why an execution failed and whether resending can fix it. Distinguishes an unknown outcome (in flight -- never resend, the first attempt may still land) from a fixable one (gas, nonce) and an unfixable one (revert, insufficient funds).",
    { reason: z.string().optional(), status: z.string().optional() },
    async (a) => json(tools.outcome_diagnose(a))
  );

  server.tool(
    "outcome_audit",
    "Read this service's decision record: what was verified, what was settled, and why. Newest last. A service that decides whether you get paid owes you an account of why.",
    { limit: z.number().optional() },
    async (a) => json(await tools.outcome_audit(a))
  );

  return server;
}

export async function serve(config?: Config): Promise<void> {
  /*
   * Resolved here rather than inside createServer because picking a store can
   * mean opening a database connection, and a constructor that quietly does
   * network I/O is a constructor nobody can test.
   */
  const audit = await auditFromEnv();
  await createServer(config, audit).connect(new StdioServerTransport());
}
