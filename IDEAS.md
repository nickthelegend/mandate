# Agents Onchain — what to build, researched 2026-08-09

Researched fresh from the hackathon page, KeeperHub's docs, the KeeperHub OSS
source, and the **live** marketplace API. Nothing here is from memory.

## What the judges actually score

> "Evaluation considers use of various KeeperHub surfaces: **MCP server, CLI,
> x402, MPP, workflow builder, and audit trail**."
> Submissions must link "a transaction your agent executed via KeeperHub".
> Deadline **2026-08-13 12:00 UTC+2**. Grand prize + $1,000 onboarding-UX bounty
> (stackable).

Six surfaces. Mandate currently uses two (x402, execute API) and a bit of a
third (its own audit trail, not KeeperHub's). **That is the scoring gap.**

## The discovery that changes the brief

KeeperHub is not just an executor. It is a **marketplace of paid, machine-callable
workflows**:

- `GET /api/mcp/workflows` — **110 listed workflows live right now**, priced
  ($0.01–$0.05/call), published by other teams in the last few days.
- Discovery via `/openapi.json` and `/.well-known/x402`, crawled by x402scan and
  mppscan.
- MCP tools: `create_workflow`, `ai_generate_workflow`, `publish_workflow`,
  `search_workflows`, `call_workflow`, `execute_check_and_execute`,
  `execute_protocol_action`, `get_execution`.
- Paid calls answer **HTTP 402 with a real x402 v2 challenge**: scheme `exact`,
  `eip155:8453` (Base mainnet), asset = real USDC, EIP-3009 domain.

**And the hole:** `call_workflow`'s own description says —

> "this tool **DOES NOT auto-pay**. A paid listing returns HTTP 402 with an x402
> challenge — pay it with @keeperhub/wallet's paymentSigner, agentcash, or the
> marketplace UI, then retry."

There is a live economy of 110 paid agent services and **nothing that can
autonomously buy one**. `paymentSigner` appears nowhere in the OSS repo except
that sentence and a test. The loop is open.

---

## Top 5 — nobody has built these

### 1. The agent that pays its own way ★ building this
An autonomous agent with a **P&L**. It publishes its own workflow to the
marketplace and earns USDC when others call it; it discovers what it needs via
`search_workflows`, hits 402, **signs the EIP-3009 authorization itself**, pays,
retries, and composes the result. Its supply chain is other teams' live
submissions.
*Why it wins:* closes the exact hole KeeperHub documents. Uses all six surfaces.
Demos as "my agent just bought a service from another submission, autonomously —
here is the transaction." Cannot be faked.

### 2. Workflow that writes workflows
An agent that reads a failure, calls `ai_generate_workflow` + `create_workflow`
to author a **new** automation that prevents it, publishes it priced, and earns
from it. Self-extending infrastructure — the agent's output is more agent.
*Nobody has shipped an agent whose artifact is a new listed workflow.*

### 3. Solvency guard for the agent economy
Every listing is a promise with a price and no SLA. A watchdog that calls each
listed workflow, records whether it actually executed onchain, and publishes a
**reliability score per listing** — a credit rating for agent services, itself
sold as a paid workflow.

### 4. Dual-rail arbitrage (x402 vs MPP)
Same service is payable on Base (x402) and Tempo (MPP). An agent that prices both
rails per call — fees, latency, finality — and routes each purchase down the
cheaper one, proving the saving. **MPP is the least-used surface in the rubric.**

### 5. The refund lane
x402 has no chargeback. An agent buys a paid workflow, verifies the delivered
result against the chain, and when the service took payment and delivered
nothing, **files an onchain claim** against an escrow the seller staked. Turns
`priceUsdcPerCall` into a bonded promise.

---

## Top 5 — these exist somewhere; worth knowing

6. **DeFi health-factor defenders.** Already on the marketplace multiple times
   (RiskGuard, Aave V3 Health Check, Retainer Defense, Sentinel Vault). Crowded.
7. **Treasury/threshold alerting.** KeeperHub's own documented use case, plus
   Discord/Slack/Telegram nodes. Solved by the product itself.
8. **Trading agents.** Done to death across BNB, Sui, ETHGlobal. Judges have seen
   dozens; almost impossible to differentiate in 3 days.
9. **Invoice/payment verification.** Kachunk already ships it, listed and priced.
10. **LLM-judge dispute resolution.** Every x402 adjacent project reaches for it.
    Weakest possible answer where the chain already knows.

---

## What happens to Mandate

It is not thrown away — it becomes the settlement conscience *inside* #1. The
agent only books a purchase as complete when the payment is **proven on chain**
(`mandate-sdk` verify), and only releases its own escrow on proof. The escrow,
the idempotent intent id, and `diagnose` all keep earning their place; they stop
being the whole pitch and become the part that makes the agent trustworthy.

## The one real constraint

The live marketplace settles x402 on **Base mainnet with real USDC**. Buying
another team's workflow spends real money and needs USDC on Base. The payer is
built and signs real EIP-3009 authorizations; broadcasting a mainnet purchase is
the one step that waits on an explicit go-ahead and funded Base USDC.
