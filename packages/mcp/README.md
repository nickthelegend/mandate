# mandate-mcp

**An MCP server that lets an agent check it was actually paid.**

```bash
npx mandate-mcp
```

No configuration. The defaults point at a live Sepolia deployment, and every
read-only tool — including verifying any transaction — works without a
credential. Only settlement moves money, and only settlement needs a key.

## Install into a client

```json
{
  "mcpServers": {
    "mandate": {
      "command": "npx",
      "args": ["-y", "mandate-mcp"]
    }
  }
}
```

`.mcp.json` for Claude Code, or `claude_desktop_config.json` for Claude Desktop.

## Why

x402 releases funds when a facilitator returns success, and the buyer is
expected to trust it. `status: 0x1` only means the EVM did not revert — a
transaction can mine, emit no logs, transfer nothing, and still be recorded as a
payment.

Try it the moment the server is up:

```
mandate_verify
  transactionHash  0xf2c4055d08d9b52ca5f4f89fe2cd6c670e2204c2458e4731fd3c0ae0eda5073c
  recipient        0x000000000000000000000000000000000000dEaD
  minAmount        2000000
```

That transaction mined successfully on Sepolia and paid nobody.

## Tools

| Tool | Does |
|---|---|
| `mandate_intent_id` | Derive the id for a piece of work. Two agents given the same task and payee get the same id, so a duplicate is refused on chain rather than paid for twice. |
| `mandate_get_intent` | State, amount, and beneficiary — the address the work actually has to reach. |
| `mandate_verify` | Did this transaction move value? Reads the receipt for a real ERC-20 `Transfer`. Read-only. |
| `mandate_settle` | Release or refund, decided from a transaction hash. |
| `mandate_diagnose` | Why an execution failed and whether resending helps. In-flight is never worth resending. |
| `mandate_audit` | The decision record: what was verified, what was settled, and why. |

**`mandate_settle` accepts a transaction hash and nothing else** — no verdict, no
`done` flag, no description of the work. An agent that could assert its way to a
payout would be the thing this replaces. A test asserts the schema still has
exactly two fields.

## Configuration

| Variable | Meaning | Default |
|---|---|---|
| `MANDATE_RPC_URL` | RPC endpoint | public Sepolia |
| `MANDATE_ESCROW` | `MandateEscrow` address | the live deployment |
| `MANDATE_TOKEN` | ERC-20 address | tUSDC on Sepolia |
| `MANDATE_CHAIN_ID` | chain id | `11155111` |
| `KEEPERHUB_API_KEY` | enables `mandate_settle` | unset — read-only |
| `MANDATE_AUDIT_LOG` | decision trail path, or `-` to disable | `.mandate/audit.jsonl` |

Built on [`mandate-sdk`](https://www.npmjs.com/package/mandate-sdk). Source and
console: [github.com/nickthelegend/mandate](https://github.com/nickthelegend/mandate).

MIT
