# mandate-mcp

A spending authority an agent cannot argue with, as MCP tools.

```bash
npx mandate-mcp
```

Every read-only tool works with no configuration and no credential. That is the
point: the party most in need of knowing what an agent is allowed to spend is
rarely the party holding the operator's API key, and a tool that demands a key
before it will tell you an agent's limit has made itself useless to exactly the
person who should be asking.

## Why an authority rather than a wallet guard

A budget an agent enforces on itself is a suggestion. This one is not held by
the agent at all.

The rules live in a JSON document; the document is canonicalised (RFC 8785) and
hashed; the hash is anchored in `PolicyRegistry` on Sepolia. The authority reads
that anchor before every decision and refuses if the document it holds does not
match. Editing the policy therefore requires a transaction the agent cannot
send. Pausing it is also a transaction — and a paused policy fails at rule 1 of
15, so nothing downstream gets a chance to be clever about it.

The agent holds no key. KeeperHub does. So a refusal is not advice.

## The tools

| Tool | What it does |
| --- | --- |
| `mandate_can_spend` | Preflight. The same fifteen rules, the same anchored policy, the same persisted ledger — and **nothing written**: no budget consumed, no duplicate recorded, no money moved. |
| `mandate_spend` | The binding one. On approval the money moves on chain and you get the hash. |
| `mandate_budget` | What this agent has spent today and what is left, read from the ledger rather than from anything the agent tracks itself. |
| `mandate_policy` | The rules being enforced, and whether the registry still says they are live. |
| `mandate_score` | What the reliability bureau makes of a payee, and why. |
| `mandate_decisions` | The decision record. Refusals as well as approvals. |
| `mandate_escalations` | Spends held for a human. Nothing is charged while one is open. |

**Call `mandate_can_spend` first.** A refusal you can read is one you can act
on; attempting a payment is a worse way to discover a limit. The engine returns
proposed effects rather than applying them, so a preflight has no path through
which state could change — it is not a dry-run flag on the same code, it is the
same decision with the write step absent.

### Three answers, not two

A spend can be approved, refused, or **held**. A held spend has charged nothing
and moved nothing, and only a bound operator holding a single-use code can
release it. If a tool tells you a spend is held, do not retry — retrying raises
a second escalation for a person to work through.

## Configuration

| Variable | Effect | Default |
| --- | --- | --- |
| `MANDATE_AUTHORITY_URL` | Which authority to ask | the hosted one |

There is no key here. `mandate_spend` moves money, but the credential that does
it lives on the authority — this package never holds one, which is the same
property that makes a refusal binding in the first place.

```json
{
  "mcpServers": {
    "mandate": { "command": "npx", "args": ["-y", "mandate-mcp"] }
  }
}
```

## Why it talks HTTP instead of reading the chain itself

If this package judged spends locally it would be a second implementation of the
same fifteen rules, reading a different ledger, fully capable of disagreeing
with the one that actually governs the money. A client cannot drift from the
thing it is a client of.

MIT.
