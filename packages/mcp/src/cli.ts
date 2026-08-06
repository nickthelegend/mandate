#!/usr/bin/env node
/**
 * `npx outcome-mcp`
 *
 * Anything printed on stdout would corrupt the JSON-RPC stream, so every human
 * message here goes to stderr. That is not a style preference -- a single stray
 * console.log is enough to make an MCP client report the server as broken with
 * no useful error, and it is the most common way one of these fails.
 */

import { loadConfig, describe } from "./config.ts";
import { serve, VERSION } from "./server.ts";

const argv = process.argv.slice(2);

if (argv.includes("--version") || argv.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    `outcome-mcp ${VERSION} -- pay agents for verified results, not attempts.

  npx outcome-mcp            start the MCP server on stdio

Works with no configuration: the defaults point at the live Sepolia deployment,
and every read-only tool -- including verifying any transaction -- runs without
a credential. Only settlement moves money, and only settlement needs a key.

  OUTCOME_RPC_URL       RPC endpoint          (default: public Sepolia)
  OUTCOME_ESCROW        OutcomeEscrow address (default: the live deployment)
  OUTCOME_TOKEN         ERC-20 address
  OUTCOME_CHAIN_ID      chain id              (default: 11155111)
  KEEPERHUB_API_KEY     enables outcome_settle
  OUTCOME_AUDIT_LOG     decision trail path, or "-" to disable

Tools: outcome_intent_id, outcome_get_intent, outcome_verify, outcome_settle,
       outcome_diagnose, outcome_audit`
  );
  process.exit(0);
}

const config = loadConfig();

// stderr: stdout belongs to the protocol.
console.error(`outcome-mcp ${VERSION}\n${describe(config)}`);

serve(config).catch((err: unknown) => {
  console.error("outcome-mcp failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
