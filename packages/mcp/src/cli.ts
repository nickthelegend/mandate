#!/usr/bin/env node
/**
 * `npx mandate-mcp`
 *
 * Anything printed on stdout would corrupt the JSON-RPC stream, so every human
 * message here goes to stderr. That is not a style preference -- a single stray
 * console.log is enough to make an MCP client report the server as broken with
 * no useful error, and it is the most common way one of these fails.
 */

import { loadConfig, type Config } from "./config.ts";
import { serve, VERSION } from "./server.ts";

/** What this process is pointed at, on stderr, so a misconfiguration is visible. */
function describe(c: Config): string {
  return [
    `  authority  ${c.authorityUrl}`,
    "  reads      no credential required",
    "  spending   authorised by the authority, which holds the key",
  ].join("\n");
}

const argv = process.argv.slice(2);

if (argv.includes("--version") || argv.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    `mandate-mcp ${VERSION} -- give an agent a budget it cannot exceed.

  npx mandate-mcp            start the MCP server on stdio

Works with no configuration: the default points at the live authority, and
every read-only tool runs without a credential. Only mandate_spend moves money,
and the credential for that lives on the authority rather than here -- this
package never holds a key, which is the same property that makes a refusal
binding.

  MANDATE_AUTHORITY_URL  where the authority is (default: the live deployment)

Tools: mandate_can_spend, mandate_spend, mandate_budget, mandate_policy,
       mandate_score, mandate_decisions, mandate_escalations`
  );
  process.exit(0);
}

const config = loadConfig();

// stderr: stdout belongs to the protocol.
console.error(`mandate-mcp ${VERSION}\n${describe(config)}`);

serve(config).catch((err: unknown) => {
  console.error("mandate-mcp failed to start:", err instanceof Error ? err.message : err);
  process.exit(1);
});
