#!/usr/bin/env node
/**
 * MCP server. A thin transport over src/tools.ts -- the handlers hold the
 * logic and are tested directly, so this file stays boring on purpose.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { JsonRpcProvider } from "ethers";
import { KeeperHubClient } from "../vendor-kh/client.ts";
import { createTools } from "./tools.ts";

const CHAIN = 11155111;
const env = {
  provider: new JsonRpcProvider(process.env.SEPOLIA_RPC_URL!, CHAIN),
  kh: new KeeperHubClient({ apiKey: process.env.KEEPERHUB_API_KEY! }),
  escrow: process.env.OUTCOME_ESCROW ?? "0x8Cd5537d9A8E55294f4939e8DBB939828BdAc89A",
  token: process.env.POLARIS_USDC!,
  chainId: CHAIN,
};

const t = createTools(env);
const server = new McpServer({ name: "outcome", version: "0.1.0" });
const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

server.tool(
  "outcome_intent_id",
  "Derive the intent id for a piece of work. Two agents given the same task and payee get the same id, so a duplicate claim is refused on chain rather than paid twice.",
  { task: z.string(), payee: z.string() },
  async (a) => json(t.outcome_intent_id(a))
);

server.tool(
  "outcome_get_intent",
  "Read an intent's current state: none, open, released or refunded.",
  { intentId: z.string() },
  async (a) => json(await t.outcome_get_intent(a))
);

server.tool(
  "outcome_verify",
  "Ask whether a transaction proves a payment actually moved. Reads the receipt and looks for a real ERC-20 Transfer to the recipient. A mined transaction with no logs moved nothing. Read-only.",
  { transactionHash: z.string(), recipient: z.string(), minAmount: z.string() },
  async (a) => json(await t.outcome_verify(a))
);

server.tool(
  "outcome_settle",
  "Settle an intent from evidence. Pass the hash of the transaction that did the work; this reads the receipt and decides. Releases if the transfer is proven, refunds if it is not. It does not accept a verdict -- an agent supplies evidence, not conclusions.",
  { intentId: z.string(), workTransactionHash: z.string() },
  async (a) => json(await t.outcome_settle(a))
);

server.tool(
  "outcome_diagnose",
  "Explain why an execution failed and whether resending can fix it. Distinguishes an unknown outcome (in flight -- never resend) from a fixable one (gas, nonce) and an unfixable one (revert, insufficient funds).",
  { reason: z.string().optional(), status: z.string().optional() },
  async (a) => json(t.outcome_diagnose(a))
);

server.tool(
  "outcome_audit",
  "Read this service's decision record: what was verified, what was settled, and why. Newest last.",
  { limit: z.number().optional() },
  async (a) => json(t.outcome_audit(a))
);

await server.connect(new StdioServerTransport());
