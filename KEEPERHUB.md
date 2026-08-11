# KeeperHub in this project — an honest audit

Written 2026-08-11 by tracing every reference, then running the flows and
watching the traffic. Nothing here is inferred from a package name.

## What KeeperHub actually exposes

Enumerated live against `https://app.keeperhub.com/mcp` with our key, not read
from docs.

| Surface | What is there |
|---|---|
| **MCP** | 44 tools: workflow CRUD, execution, direct execution, marketplace list/unlist/price, protocol actions, Tempo hold/release/cancel, validation, analytics, spending limits |
| **REST** | `/api/execute/transfer`, `/api/execute/contract-call`, `/api/execute/check-and-execute`, `/api/execute/{id}/status`, `/api/mcp/workflows`, `/api/mcp/workflows/{slug}/call`, `/api/analytics/runs` |
| **Actions** | **442**, across Aave, Morpho, Compound, Spark, Sky, Yearn, Ethena, Pendle, Uniswap, Curve, CoW, Aerodrome, Lido, Rocket Pool, Frax, Superfluid, Chainlink CCIP, Chronicle, Ajna, Hyperliquid, Safe, Blockscout, Tempo, plus web3 primitives, Discord/Slack/Telegram/SendGrid/webhook, and `code/run-code` |
| **Triggers** | Manual, Schedule, Webhook, **Event**, **Block**, **Transfer** |
| **Chains** | Ethereum, Sepolia, Arbitrum, Base, Polygon Amoy, Solana devnet, Tempo (4217 / 42431) |
| **Execution** | Turnkey smart accounts, **gas sponsorship on testnets too**, pre-send simulation, per-attempt idempotency, adaptive gas, RPC failover |
| **Monetization** | Marketplace listing with a USDC price; callers pay over x402 (EIP-3009, Base mainnet) straight to the creator |

---

## Status: genuinely used, and load-bearing

Not a checkbox import. KeeperHub is the only thing that can move money in this
system, and removing it does not degrade the product — it stops it.

### GENUINELY USED

**1. Every approved spend is a KeeperHub transfer.**
`packages/sdk/src/authority.ts` → `executeIfAuthorised` → `transferAndConfirm`
→ `POST /api/execute/transfer`, then polls `/api/execute/{id}/status`.

Traced live today, end to end:

```
button press → APPROVED → tx 0x66aca854c83a918e…0597019a
on chain     from 0xA17cb6adb5…  → to 0x5aF5194B4b…   status 1
deployer     0x7A2E11B3EC…       signed it?  false
KeeperHub    {"status":"completed","type":"transfer","sponsored":true}
```

The deployer key is in `.env` and **did not sign**. KeeperHub's relayer did,
through a Turnkey smart account, with gas sponsored. This is the claim the whole
product rests on — the agent cannot route around a refusal because it holds no
key — and it is true because of KeeperHub specifically.

**2. Policy anchoring and every kill-switch flip.**
`apps/gateway/src/anchor-policy.ts` → `executeAndConfirm` →
`/api/execute/contract-call`. `registerPolicy`, `updatePolicy`, `pausePolicy`,
`resumePolicy` all go through KeeperHub, so `PolicyRegistry` records KeeperHub's
wallet as owner — which is what makes "the agent cannot edit its own policy"
enforceable rather than aspirational.

**3. Receipt batch anchoring.**
`packages/receipts/src/anchorer.ts` → `executeAndConfirm` →
`MandateReceipts.anchorReceiptBatch`. 15 batches anchored; `anchoredBy` reads as
KeeperHub's relayer, not the deployer.

**4. The execution record, proxied and public.**
`apps/gateway/src/server.ts:445` `/execution/:id` → `client.getStatus`. Surfaced
at `/inspect`. Verified identical through our proxy and straight from
KeeperHub's REST API.

**5. The marketplace, as a publisher.**
`scripts/relist-marketplace.mjs` uses `create_workflow`, `update_workflow`,
`execute_workflow`, `get_execution`, `update_workflow_listing`, `list_workflow`,
`unlist_workflow`, `get_workflow_listing`. Live listing `mandate-policy-status`
at $0.02/call, returning a valid x402 v2 challenge.

### IMPORTED BUT UNUSED

| Capability | Where | Reality |
|---|---|---|
| `simulateContractCall` / `assertWouldSucceed` | `keeperhub/client.ts:205,226` | Exported, tested, **zero live callers.** The sharpest miss: the product's thesis is "decide before you act", and this is exactly that at the execution layer. |
| `checkAndExecute` | `keeperhub/client.ts:306` | `/api/execute/check-and-execute` is never called from anywhere. |
| `discover()` | `sdk/marketplace.ts:201` | Called only by `qa-infra.mjs`. The app never discovers a listing. |
| `payAndCall()` | `sdk/marketplace.ts:278` | Appears **only as a code sample** on `/docs`. Nothing executes it. |
| `auditFromEnv` / `fileAudit` / `memoryAudit` / `mongoAudit` | `sdk/audit.ts` | Re-exported from `node.ts`, no live caller. |

### FAKED

**None.** With no key the gateway answers `501 no KeeperHub key configured`
rather than inventing a result (`server.ts:457`). The four hardcoded hashes on
`/` are real, verified transactions (test 1.8) presented as history, not as a
live call.

### MISSING — the honest list

- **All five notification channels.** `list_integrations` returns one web3
  wallet and nothing else. **A held spend notifies nobody.** The escalation
  service already models `{channel, senderHandle}` and `channelLog` — the
  abstraction is built and wired to zero channels.
- **`get_spending_limits`** returns `dailyCapWei: null`. We ship a spending
  authority on top of a platform whose own spending cap is unset.
- **`list_executions`** — gas, duration, error taxonomy, per-step counts. The
  bureau scores settlement consistency from Mongo and the chain and never asks
  KeeperHub what *it* thinks went wrong.
- **Five of six trigger types.** Only Manual. No Schedule, Webhook, Event,
  Block or Transfer trigger anywhere.
- **442 protocol actions: zero used.**
- Tempo/MPP, Safe, Solana, Blockscout, Chronicle, CCIP.
- `validate_workflow`, `prepare_test_pin_data`, `validate_cron`,
  `test_notification`, `ai_generate_workflow`, templates.

---

## Where deeper integration genuinely fits

Three surfaces where KeeperHub belongs and is currently absent. Everything else
in the ranked list below is honest opportunity; these three are holes.

1. **The escalation has no way to reach a person.** This is a design hole, not a
   missing feature. `ESCALATED` claims a human decides, and no human is told.
2. **Policy says "allowed"; nothing asks whether it would succeed.** A spend
   that passes fifteen rules and then reverts is approved, executed and failed.
   KeeperHub simulates before it signs — we already ship the wrapper.
3. **The kill switch has a race.** We read `isUsable()`, then separately ask
   KeeperHub to transfer. `check-and-execute` collapses those into one call.

### Where it would be forced — said plainly

Aave/Morpho/Compound/Uniswap/Curve/Pendle/Yearn positions, Hyperliquid, Ajna,
Superfluid streaming: bolting DeFi actions onto a spending authority would be a
different product wearing this one's name. They appear low in the ranking with
that caveat rather than dressed up. Likewise `ai_generate_workflow` and the
template gallery — real capabilities, but this app has one policy, not a
workflow-authoring surface.

---

## 50 features, ranked by how load-bearing KeeperHub is

**Tier 1 — cannot exist without KeeperHub.** Remove it and the feature is gone,
not degraded.

| # | Feature | Capability | Depth | Why a judge notices |
|---|---|---|---|---|
| 1 | **Tell the operator a spend is held** — on `ESCALATED`, fire `discord/send-message` (or Slack/Telegram) with amount, payee, LCB vs floor, and the single-use code | `discord/send-message`, `list_integrations`, `test_notification` | Core | Closes the one hole in the three-answer design. "Held for a human" currently reaches no human |
| 2 | **Answer the escalation from the chat reply** — a KeeperHub Webhook trigger receives the operator's message and calls `/authority/escalation/:id/resolve` | Webhook trigger + `webhook/send-webhook` | Core | `resolvedBy: {channel, handle}` already exists in the schema and has only ever held `"http"`. Filling it is the design completing itself |
| 3 | **Simulate before approving** — `assertWouldSucceed` between rule 15 and execution; a spend that would revert is refused with the decoded reason, not approved and then failed | `/api/execute/contract-call` dry-run | Core | The product's own thesis applied one layer down. Only KeeperHub can simulate against its signer, nonce and sponsorship |
| 4 | **Mirror the daily cap into KeeperHub's own limit** — set `dailyCapWei` to the policy's `budgets.daily`; re-assert on every re-anchor | `get_spending_limits` | Core | Defence in depth a judge can verify: even a compromised gateway cannot exceed the platform cap |
| 5 | **Atomic kill-switch check** — `check-and-execute` reads `isUsable(policyId)` and transfers in one call, closing the TOCTOU window between our read and our send | `/api/execute/check-and-execute` | Core | Removes a real race. Nothing else can make the read and the spend the same operation |
| 6 | **Anchor receipts on a schedule** — a Schedule trigger calls `tick()` so a quiet day still anchors, instead of anchoring only when someone loads the page | Schedule trigger + `validate_cron` | Core | Today evidence depends on traffic. That is a defect, and their scheduler is the fix |
| 7 | **Watch the anchor by block** — a Block trigger re-reads `getPolicy().policyHash` every N blocks and alerts if it moved without a re-anchor from us | Block trigger | Core | Detects an anchor changed out from under the authority. Requires their block-level scheduling |
| 8 | **React to `PolicyPaused` on chain** — an Event trigger on the registry notifies every operator and marks the console the instant a pause lands | Event trigger | Core | The kill switch becomes push, not poll. Their event indexer, our contract |
| 9 | **Auto-receipt on money landing** — a Transfer trigger on the payout address enqueues a receipt when funds actually arrive, independent of what the gateway believed | Transfer trigger | Core | Evidence that does not depend on the authority's own account of itself |
| 10 | **Rent the authority** — publish `mandate-can-spend` as a paid listing so any agent can ask *"would this spend be allowed"* for $0.001 | `list_workflow`, x402 monetization | Core | Turns the product into infrastructure other agents pay for. KeeperHub *is* the billing rail |
| 11 | **Bureau reads KeeperHub's failure taxonomy** — `list_executions` gives `errorCategory`, `errorType`, gas and duration per payee, feeding `settlementConsistency` | `list_executions` | Core | Their execution history is a reputation signal nobody else holds. Turns a prior into a real observed feature |
| 12 | **Sponsorship as rule 16** — refuse when gas sponsorship for the chain is exhausted, rather than approving and failing mid-execution | Sponsorship metadata + `get_spending_limits` | Core | A refusal for a reason only the execution layer knows |
| 13 | **Tempo hold-and-release as the escalation primitive** — `tempo_sign_and_hold` signs the payment at decision time and holds it with an on-chain deadline; approve → `tempo_release_hold`, deny → `tempo_cancel_hold` | `tempo_sign_and_hold` / `release` / `cancel` | Core | Our escalation, native to the chain. Nobody else has sign-now-broadcast-later. *(Blocked on Tempo funding; the code path is real)* |
| 14 | **The intent hash in the payment itself** — `tempo/transfer-with-memo` puts the 32-byte `intentHash` on chain, so the transfer carries the decision that authorised it | `tempo/transfer-with-memo` | Core | A payment self-describing its authorisation. Protocol-native to Tempo and to nothing else |
| 15 | **Release several held spends atomically** — `tempo/batch-payout` so an operator clearing a queue cannot half-succeed | `tempo/batch-payout` | Core | Removes partial-failure from the operator's most consequential action |
| 16 | **Sponsored-gas proof on every approval** — surface `sponsored: true` and the gas KeeperHub paid, next to the hash | `/api/execute/{id}/status` | Core | Makes "the agent holds no ETH" visible rather than asserted |
| 17 | **Idempotency across a gateway restart** — reuse KeeperHub's per-attempt idempotency key so a redeployed gateway re-attaches to an in-flight transfer instead of re-sending | Execute-API idempotency (`Idempotency-Key`) | Core | The exact 409 semantics this project already filed fixes against upstream |
| 18 | **Refuse on a stale nonce** — read the smart account's pending state before approving a burst | Wallet integration + execute status | Core | A refusal that only the signer's own view can justify |
| 19 | **Per-agent KeeperHub sub-execution tagging** — tag every execution with the agent id so `list_executions` becomes a per-agent spend history | `execute_*` metadata + `list_executions` | Core | Per-agent accounting inside the executor, not just in our Mongo |
| 20 | **Publish the escalation queue as a read listing** — an operator's own tooling can poll held spends over x402 | `list_workflow` read workflow | Core | The queue becomes machine-callable without exposing our gateway |

**Tier 2 — KeeperHub does the real work; a determined team could substitute
something else at cost.**

| # | Feature | Capability | Depth | Why a judge notices |
|---|---|---|---|---|
| 21 | Enforce the same policy on Base, Arbitrum and Polygon through one execute API | Multi-chain execute | Deep | One anchored policy, four chains, no per-chain signer |
| 22 | Solana spend path — the same fifteen rules, `transfer-spl-token` at the end | `web3/transfer-spl-token` | Deep | Policy that is not EVM-shaped |
| 23 | Bind operators to a **Safe** — `safe/get-owners` and `get-threshold` become the escalation's operator set, so releasing follows a real multisig | `safe/get-owners`, `safe/get-threshold` | Deep | Replaces a hardcoded operator address with an auditable org |
| 24 | Require *threshold* approvals on a held spend, read from the Safe | `safe/get-threshold` | Deep | Escalation with real quorum |
| 25 | Surface `safe/get-pending-transactions` as a second escalation source | `safe/get-pending-transactions` | Deep | The authority reviews what the multisig has not signed yet |
| 26 | **Price the cap in USD** — `chronicle/usdc-usd-read-with-age` converts a dollar policy to token units at decision time, and a stale oracle escalates | `chronicle/*-read-with-age` | Deep | The `staleScoreMaxAgeH` idea applied to price. Age-aware reads are Chronicle's whole point |
| 27 | Refuse when the treasury cannot cover the spend — `web3/check-token-balance` before approval | `web3/check-token-balance` | Deep | A refusal for a reason the ledger alone cannot know |
| 28 | Cross-chain spend under one anchor via CCIP | `chainlink/ccip-send`, `ccip-get-fee` | Deep | Policy anchored on Sepolia governing a Base payout |
| 29 | Include the CCIP fee in the per-call cap | `chainlink/ccip-get-fee` | Deep | The cap covers the true cost, not the face amount |
| 30 | Wallet profile from **Blockscout** — `get-address-info` and `get-address-counters` make `walletOperationalProfile` richer than an RPC balance | `blockscout/get-address-*` | Deep | Turns a thin feature into a real one, narrowing σ honestly |
| 31 | Validate the token in a spend request — `blockscout/get-token-info` catches a payee asking to be paid in something unlisted | `blockscout/get-token-info` | Moderate | A rule that needs an indexer |
| 32 | `validate_workflow` in CI before any workflow we publish goes live | `validate_workflow` | Moderate | The listing that errored on `{{policyId}}` would have been caught by this |
| 33 | `test_notification` when an operator binds a channel, so it is proven before it matters | `test_notification` | Moderate | An escalation channel verified at bind time, not at 3am |
| 34 | `prepare_test_pin_data` to generate valid inputs for our listing's docs | `prepare_test_pin_data` | Moderate | The listing's example input comes from the platform, not from us guessing |
| 35 | Gas-spend analytics per agent on `/ledger` | `/api/analytics/runs` | Moderate | Cost of enforcement, measured |
| 36 | Error-category breakdown of failed executions on `/ledger` | `list_executions` | Moderate | Distinguishes "policy refused" from "execution failed", which the log currently blurs |
| 37 | Live execution progress in the console — poll `get_execution` and show the step, not a spinner | `get_execution` | Moderate | 20–40 seconds of honest state instead of a spinner |
| 38 | Show `completedSteps / totalSteps` for anchoring | `get_execution` | Surface | Same, for the slowest operation |
| 39 | A deployable **template** of the whole authority, so a judge clones it into their own org | `search_templates`, `deploy_template` | Moderate | "Try it in your own account" in one click |
| 40 | Publish the receipt-proof check as a free read listing | `list_workflow` (price 0) | Moderate | Anyone can verify a receipt without our gateway |

**Tier 3 — real, but the sponsor tech is swappable. Included for completeness,
and I would not build most of these to win a track.**

| # | Feature | Capability | Depth | Note |
|---|---|---|---|---|
| 41 | Daily digest of every decision by email | `sendgrid/send-email` | Surface | Any mailer does this |
| 42 | Webhook out to the operator's own system on each refusal | `webhook/send-webhook` | Surface | A `fetch` would do |
| 43 | Discord bot answering `mandate_budget` | `discord/send-message` | Surface | Our MCP server already answers it |
| 44 | Slack command for the decision log | `slack/send-message` | Surface | Swappable |
| 45 | Telegram alert when a payee's LCB band changes | `telegram/send-message` | Surface | Swappable |
| 46 | Organise workflows per policy with projects and tags | `create_project`, `create_tag` | Surface | Housekeeping |
| 47 | A workflow that calls our gateway over HTTP | `HTTP Request` action | Surface | Inverted: the workflow becomes the client |
| 48 | A custom rule expressed as `code/run-code` | `code/run-code` | Surface | Weakens the engine's determinism; noted and not recommended |
| 49 | Budget rollups with `math/aggregate` | `math/aggregate` | Surface | Arithmetic we already do |
| 50 | An agent that supplies idle treasury to Aave within policy | `aave-v3/supply` | Surface | **Forced.** A different product wearing this one's name — listed last for exactly that reason |

---

## If only three get built

**1, 3 and 6.** They are the three holes above, they are each a few hours, and
each one is the kind of thing a judge on this track can trigger and watch work:
a held spend that actually pings a person, a refusal that names a revert reason
no rule engine could know, and evidence that anchors on a schedule rather than
when someone happens to open the page.
