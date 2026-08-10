# Outcome

**An agent spending authority. The limit is not advisory — the agent has no key to break it with.**

Agents Onchain 2026 · Sepolia · every write executed through KeeperHub.

---

## The problem

Teams are handing autonomous agents private keys and hoping. That is an
unbounded liability with a chat interface. There is no corporate card for an
agent, no expense policy, no approval chain, and no statement anyone could hand
an auditor.

The usual answer is a spend limit inside the agent's own code, which is a
suggestion: the agent holds the key, so anything it decides to sign, it signs.

## What this does

Outcome puts a **deterministic authority** between an agent and its money, and
makes it binding by removing the key.

- The agent holds **no private key**. KeeperHub owns the signer.
- `executeIfAuthorised` is the **only** path from a decision to a transfer.
- So a refusal cannot be routed around. There is nothing to route around it
  with.

That is the difference between a spend limit and a spend *authority*. A limit
asks the agent nicely. An authority is a gate the money has to pass through.

## How a spend is judged

Fifteen rules, in a fixed order, each naming itself when it fires:

```
policy.active → duplicate → cooldown → replay.contextBinding → recipient
→ agent.worker → category → vendor.lcbFloor → intent.maxAmountBound
→ hardCap → perCall.cap → budget.daily → rate.limit → proof.tierRequired
→ escalate.aboveThreshold
```

A decision returns `APPROVED`, a `BLOCKED_*`, or an `ESCALATED_*`, together with
the trace of every rule evaluated and which one refused.

```ts
const decision = evaluateIntent(intent, policy, ledger);
// { decision: "BLOCKED_BUDGET", rules: [... { rule: "budget.daily", result: "FAIL" }] }

await executeIfAuthorised(kh, decision, { chainId: 11155111, to, amount });
// refused → returns before any network call exists. No execution record.
// approved → KeeperHub executes, keyed on the intent hash for idempotency.
```

## The policy lives on chain

A policy in a config file is one the operator can edit afterwards, which makes
every decision citing it unfalsifiable. The canonical hash is anchored in
`PolicyRegistry` on Sepolia, and **the anchor is written through KeeperHub**, so
the registry records KeeperHub's wallet as owner. The rules cannot be rewritten
from anyone's `.env`.

Before any spend is judged, two things must hold:

1. The policy document hashes to exactly what the registry stores. An edited
   file produces a different hash and is refused (`PolicyAnchorMismatch`).
2. The registry still reports the policy usable. Paused or expired means no
   spend is judged at all (`PolicyNotUsable`).

### The kill switch

`pauseAnchoredPolicy` is a transaction KeeperHub signs. From the block it lands
in, every agent reading that registry stops spending. It is not a flag in one
process's memory, and the agent cannot ignore it, because the agent is not the
thing consulting it.

Proven end to end on Sepolia:

| Step | Result | Transaction |
|---|---|---|
| Anchor policy via KeeperHub | owner = KeeperHub wallet | [`0x6f023b48`](https://sepolia.etherscan.io/tx/0x6f023b48e20fb70939a18f8051f800474eae0e0c0f5a89db15dec3ad93a5aad0) |
| Spend under live policy | `APPROVED` | [`0xe9f84233`](https://sepolia.etherscan.io/tx/0xe9f84233c0e06f5eee5f2c709413c86de4b0e733d75b6bf65b99f60a3d3d801d) |
| Tamper the document | `PolicyAnchorMismatch` | — |
| Pause on chain via KeeperHub | `PAUSED`, `usable: false` | [`0x76478512`](https://sepolia.etherscan.io/tx/0x76478512c7a87cd2e5df233e280b897bd6b8eb9990b7cc9f9955fbf9611f70ab) |
| Same spend, after pause | `PolicyNotUsable` | — |

Every one of those writes was sent by KeeperHub's relayer `0xA17cb6ad…`, not by
a local key.

## Deployments

| | |
|---|---|
| `PolicyRegistry` | [`0x13452fcA…C5E304`](https://sepolia.etherscan.io/address/0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304) |
| `OutcomeEscrow` | [`0x0ED9d123…dC3B`](https://sepolia.etherscan.io/address/0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B) |
| `USDCx` (EIP-3009) | [`0x0d864A62…CF13`](https://sepolia.etherscan.io/address/0x0d864A625c280F7f9B9AD024d12F94f5D6DCCF13) |

## KeeperHub surfaces used

| Surface | Where |
|---|---|
| **Execute API** | every policy anchor, every authorised transfer |
| **MCP server** | KeeperHub's, to create and publish a workflow; plus `outcome-mcp`, six tools of our own |
| **x402** | spec-exact adapter, a resource server that verifies settlement, and an autonomous payer |
| **Workflow builder** | [`outcome-escrow-intent-status`](https://app.keeperhub.com), listed at $0.02/call |
| **Audit trail** | KeeperHub's execution record read back; our own decision ledger persisted to MongoDB |
| **CLI** | `kh execute contract-call` anchors a policy — [`0xfecbcf8f`](https://sepolia.etherscan.io/tx/0xfecbcf8f777dcc08b579aa6d176270ab3af4389f536c1a9479625fe106a7c478) |
| **MPP** | **not used** — see Known gaps |

## Buying from the marketplace, autonomously

KeeperHub lists workflows other agents publish, priced per call. Its own tool
says: *"this tool DOES NOT auto-pay. A paid listing returns HTTP 402 … pay it
with paymentSigner, agentcash, or the marketplace UI, then retry."*

`marketplace.ts` removes the human: it reads the challenge, signs the EIP-3009
authorisation, retries with payment attached. Verified against the live
marketplace — 39 paid listings discovered, a real Base challenge parsed, and a
valid signature produced that recovers to the signer. It refuses over-cap and
off-allowlist purchases *before a signature exists*, because a signed
authorisation is bearer-spendable the moment it leaves the process.

## Install

```bash
npm i outcome-sdk      # the authority, the payer, the KeeperHub client
npx outcome-mcp        # six MCP tools; every read-only one needs no credential
```

## Run it

```bash
npm install
npm test                       # 134 tests across sdk, mcp and policy
npm run build -w outcome-web
```

Set `KEEPERHUB_API_KEY`, `SEPOLIA_RPC_URL` and `MONGODB_URI` in `.env` (see
`.env.example`).

## Provenance

The fifteen-rule engine and its canonical hashing are **ported from
[untch](https://untch.xyz)**, a production authority layer live on X Layer
mainnet, and moved here onto KeeperHub and Sepolia. The port swaps viem for
ethers; `hashSpendIntent` is verified byte-identical to the Solidity
implementation across untch's differential corpus (**15/15**), and untch's own
engine suite passes against it (**68/68**).

Written here: the KeeperHub anchoring and loader, the authority gate, the
autonomous x402 marketplace payer, the escrow, the receipt verifier, the MCP
server and the console.

## Known gaps

Stated rather than hidden.

- **MPP is unused.** Tempo is reachable (chain 4217 / 42431) and the CLI talks
  to it, but the KeeperHub wallet holds no Tempo balance
  (`kh wallet balance --chain 42431` → "No balances found"), so an MPP payment
  cannot settle. Blocked on funding, not on capability — so it is left undone
  rather than faked.
- **Sepolia, not mainnet.** x402's own gate is Base-mainnet-only.
- **The web console still presents the earlier verification product**, not the
  authority. The backend above is real and tested; the site has not caught up.
- Verification covers ERC-20 transfers, not arbitrary off-chain work.
