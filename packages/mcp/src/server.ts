/**
 * The Mandate MCP server: the spending authority, as tools an agent can call.
 *
 * A thin transport over `authority-client`. The handlers hold the logic and the
 * client holds the boundary, so this file stays boring on purpose — if it ever
 * needs a test of its own, something has leaked into the wrong layer.
 *
 * The tool descriptions are part of the product. A model choosing between these
 * has only the description to go on, and the two things it must understand are
 * that `mandate_can_spend` changes nothing and `mandate_spend` is binding —
 * there is no third state where a refusal can be argued with.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { createAuthorityClient, AuthorityError } from "./authority-client.ts";
import { createTools } from "./tools.ts";
import { loadConfig, type Config } from "./config.ts";

export const VERSION = "0.2.0";

const AGENT = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{2,63}$/i, "3-64 chars: letters, digits, dash or underscore")
  .describe("Which agent under the policy is asking. Each has its own budget and duplicate window.");

const AMOUNT = z.number().positive().describe("Amount in USDT display units, e.g. 0.4 for forty cents.");
const CATEGORY = z.string().optional().describe("What is being bought, e.g. market-data. Checked against the policy's allow list.");
const ENDPOINT = z.string().optional().describe("The service being paid for. Part of the duplicate key.");
const RECIPIENT = z.string().optional().describe("The payee address. Scored by the bureau before anything moves.");

/** Every handler returns text; a thrown authority error becomes a readable refusal. */
const say = async (fn: () => Promise<string>) => {
  try {
    return { content: [{ type: "text" as const, text: await fn() }] };
  } catch (e) {
    const msg =
      e instanceof AuthorityError
        ? `The authority refused this request: ${e.message}`
        : `Could not reach the authority: ${e instanceof Error ? e.message : String(e)}`;
    // isError so a model treats it as a failed call rather than a result.
    return { content: [{ type: "text" as const, text: msg }], isError: true };
  }
};

export function createServer(config: Config = loadConfig()): McpServer {
  const tools = createTools(createAuthorityClient(config.authorityUrl));
  const server = new McpServer({ name: "mandate", version: VERSION });

  server.registerTool(
    "mandate_can_spend",
    {
      description:
        "Ask whether a spend WOULD be allowed, before attempting it. Judges the request against " +
        "the policy anchored on chain and the agent's persisted ledger, and writes nothing — no " +
        "budget consumed, no duplicate recorded, no money moved. Returns the verdict, the rule " +
        "that would refuse it, and the numbers it compared. Call this first: a refusal you can " +
        "read is one you can act on, and attempting a payment is a worse way to discover a limit.",
      inputSchema: { agent: AGENT, amount: AMOUNT, category: CATEGORY, endpoint: ENDPOINT, recipient: RECIPIENT },
    },
    async (a) => say(() => tools.canSpend(a))
  );

  server.registerTool(
    "mandate_spend",
    {
      description:
        "Ask to spend. The answer is binding: if the policy refuses, no payment happens and there " +
        "is nothing to route around it — the agent holds no key, KeeperHub does. On approval the " +
        "money actually moves on chain and you get the transaction hash. A spend may also be HELD " +
        "for a human rather than approved or refused; if it is, do not retry, because retrying " +
        "raises a second escalation. Requires the operator's credential.",
      inputSchema: { agent: AGENT, amount: AMOUNT, category: CATEGORY, endpoint: ENDPOINT, recipient: RECIPIENT },
    },
    async (a) => say(() => tools.spend(a))
  );

  server.registerTool(
    "mandate_budget",
    {
      description:
        "What this agent has spent today and what is left, read from the persisted ledger rather " +
        "than from anything the agent tracks itself. Also reports the per-call cap, the hourly " +
        "rate limit, and whether the policy is still live on chain.",
      inputSchema: { agent: AGENT },
    },
    async ({ agent }) => say(() => tools.budget(agent))
  );

  server.registerTool(
    "mandate_policy",
    {
      description:
        "The rules this authority enforces and their status in the on-chain registry. An agent " +
        "can read its own limits but cannot change them — the document is hashed and the hash is " +
        "anchored, so an edited policy is refused until it is re-anchored, which is a transaction.",
      inputSchema: {},
    },
    async () => say(() => tools.policy())
  );

  server.registerTool(
    "mandate_score",
    {
      description:
        "What the reliability bureau makes of a payee: the raw score, the uncertainty, and the " +
        "lower-confidence bound that enforcement actually compares against a floor. A payee with " +
        "a good score and thin evidence carries a wide sigma and a low bound, so missing evidence " +
        "tightens the limit rather than flattering it.",
      inputSchema: { payee: z.string().describe("The payout address to score.") },
    },
    async ({ payee }) => say(() => tools.score(payee))
  );

  server.registerTool(
    "mandate_decisions",
    {
      description:
        "The decision record: what was asked for, what was decided, and which rule decided it. " +
        "Refusals are kept as well as approvals, because a record of only the approvals cannot " +
        "answer the question an audit asks. Read-only and needs no credential.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(10),
        agent: AGENT.optional(),
      },
    },
    async ({ limit, agent }) => say(() => tools.decisions(limit ?? 10, agent))
  );

  server.registerTool(
    "mandate_escalations",
    {
      description:
        "Spends the policy would neither approve nor refuse, waiting on a human. Nothing is " +
        "charged and nothing has moved while one is open. Only a bound operator holding the " +
        "single-use code can release one, so an agent cannot answer its own escalation.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(10),
        agent: AGENT.optional(),
      },
    },
    async ({ limit, agent }) => say(() => tools.escalations(limit ?? 10, agent))
  );

  return server;
}

export async function serve(config?: Config): Promise<void> {
  await createServer(config).connect(new StdioServerTransport());
}
