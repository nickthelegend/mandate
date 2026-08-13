# Mandate

**Give an agent a budget it cannot exceed.** Not a limit it agrees to respect — one it has no key to break.

---

## The problem

An AI agent that can spend money today has an API key in an environment variable and a system prompt that says *"please stay under budget."*

That is not a limit. It is a suggestion, made to something that can be talked into anything. Every guardrail lives inside the same context window an attacker is writing to. If you can convince the model, you have convinced the spender — because the model *is* the spender.

The failure modes are not exotic. An agent retries a timed-out call and pays twice. A prompt-injected agent is told a large purchase was pre-approved. An agent pays a vendor nobody has ever paid, because nothing was watching for that.

## What Mandate does

It moves the limit out of the conversation and onto the chain, and takes the key away from the agent entirely.

An operator writes a spending policy — a daily budget, a cap on any single call, which category may be bought, which payees are allowed, what happens when a payee has no history. That document is canonicalised with **RFC 8785**, hashed with **keccak256**, and the hash is registered in a `PolicyRegistry` contract on Sepolia.

The transaction that registers it is executed **through KeeperHub**, so the registry records *KeeperHub's* wallet as the policy's owner. Not ours. Not the agent's.

From then on:

- The agent holds **no signing key at any point.** It asks the authority; fifteen rules run in a fixed order; only an approval ever reaches KeeperHub, which signs and broadcasts the payment.
- Edit one character of the policy file and its hash no longer matches the anchor. Every spend is refused with `PolicyAnchorMismatch` until a human re-anchors it — which is itself a transaction the agent cannot send.
- **Prompt injection works on the agent, not on the authority.** Convincing a model that a $5,000 spend was pre-approved changes nothing, because the tool that spends the money is the same tool that enforces the cap.

## The fifteen rules

They run in order and the first to fail decides, so a refusal is never just *"denied"* — it names the rule and says how far the chain got:

```
BLOCKED_DUPLICATE at duplicate.taskHash_endpoint_paramsHash
  — same task, endpoint and params as payment pi_24a32a2d
  — stopped at rule 2 of 15; the remaining 13 were never consulted
  — budget unchanged: $0.40 of $5.00 used. No money moved.
```

```
ESCALATED_VENDOR_RISK — held, not refused outright
  — vendor.lcbFloor, at rule 8 of 15
  — vendor score: LCB 17.20 against a floor of 20 — short by 2.8 points
```

That second one is the design worth pointing at. Vendor reputation is compared as a **lower confidence bound**, never a raw score — so a payee with a good average and thin evidence does not clear the floor. A vendor with no history scores low *by construction* and the spend goes to a person instead of to a guess.

## How KeeperHub is used

| Surface | What runs on it |
|---|---|
| **Execute API** | Every on-chain write: anchoring a policy, every authorised transfer, the kill-switch pause |
| **MCP server** | Our own `mandate-mcp` (7 tools) — and KeeperHub's MCP to publish the marketplace listing |
| **CLI** | `kh execute contract-call` anchored a policy |
| **Workflow builder** | `mandate-policy-status` — published and live, priced via x402 |
| **x402** | Spec-exact adapter and an autonomous payer in `mandate-sdk` |
| **Audit trail** | KeeperHub's execution record, alongside our own decision ledger |

KeeperHub's relayer `0xA17cb6adb58277E5b4A44B8c1ECB449BB6614E87` is the `From` on every transaction. That is the architecture in one line: **we decide, KeeperHub signs, and the two are different parties.**

## What you can check right now

The authority is live and has judged **472 spends** — 114 approved, 190 refused, 168 held for a human.

| | |
|---|---|
| Live site | https://mandate-keeperhub.vercel.app |
| PolicyRegistry | `0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304` |
| MandateReceipts | `0x64AE971Fda589E4C878F66452b8CE0533032f60d` |
| Active policy | id `1096875157…736629`, hash `0x81575c62…f095a`, **ACTIVE v3** |
| Policy anchored | [`0xb314c15c…6e0e0d`](https://sepolia.etherscan.io/tx/0xb314c15cd7053e8f8a714043fe8562f2af1e84b83b67051c40f377a4486e0e0d) |
| Agent's payment | [`0x33e133b2…907994`](https://sepolia.etherscan.io/tx/0x33e133b2d3b9defb4ec665acc483003ef35a2c6728e46d372af8d83b34907994) |

Three things are verifiable without trusting us at all:

1. **[/policy](https://mandate-keeperhub.vercel.app/policy/)** — change the daily budget and watch keccak256 recompute *in your own browser*. The badge flips from `ANCHORED ON SEPOLIA` to `NOT ANCHORED` on a single keystroke, because that is exactly what the gateway would do to a spend judged against the edited document.
2. **[/authority](https://mandate-keeperhub.vercel.app/authority/)** — spend the budget down yourself and watch it refuse. The decision engine runs client-side, with no server in the path.
3. **`node scripts/verify-a-receipt.mjs`** — recomputes the Merkle root from a receipt and compares it against the root anchored on chain. Zero dependencies; it hand-rolls keccak256 rather than importing ours. If we had lied about a single decision, it fails.

## Try it in one line

Our MCP server is published on npm. Anything that speaks MCP gets the same seven tools:

```bash
claude --mcp-config mandate.mcp.json --strict-mcp-config --allowedTools mcp__mandate
```

```json
{
  "mcpServers": {
    "mandate": {
      "command": "npx",
      "args": ["-y", "mandate-mcp"],
      "env": { "MANDATE_GATEWAY_URL": "https://gateway-production-944e.up.railway.app" }
    }
  }
}
```

`mandate_can_spend` · `mandate_spend` · `mandate_budget` · `mandate_policy` · `mandate_score` · `mandate_decisions` · `mandate_escalations`

Every read-only tool works **without a credential**, because the party being asked to trust a payment is the one who most needs to check it.

If you are writing the agent rather than running one, it is the same authority in five steps — see **[/connect](https://mandate-keeperhub.vercel.app/connect/)**, or `examples/capped-agent.mjs` (40 lines, every import a package on npm).

## On npm

| Package | | |
|---|---|---|
| [`mandate-sdk`](https://www.npmjs.com/package/mandate-sdk) | `0.6.0` | anchoring, the durable ledger, the gate before execution |
| [`mandate-mcp`](https://www.npmjs.com/package/mandate-mcp) | `0.1.2` | 7 MCP tools; read-only ones need no credential |
| [`mandate-policy`](https://www.npmjs.com/package/mandate-policy) | `0.1.0` | the 15-rule engine and the RFC 8785 canonicaliser |

## No model in the money path

The rules are deterministic and the chain is the arbiter. Nothing here asks a language model whether a payment should happen — the model only ever asks, and is told.

---

*Built for KeeperHub Agents Onchain 2026. Sepolia testnet.*
