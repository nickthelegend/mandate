# Mandate

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

Mandate puts a **deterministic authority** between an agent and its money, and
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
policy.active → duplicate.<configured tuple> → cooldown.sameService
→ replay.contextBinding → recipient.allowDeny → agent.workerAllowDeny
→ category.allow → vendor.lcbFloor → intent.maxAmountBound → hardCap.absolute
→ perCall.cap → budget.daily → rate.limit → proof.tierRequired
→ escalate.aboveThreshold
```

Those are the ids the engine emits, exported as `IMPLEMENTED_RULES`. The
duplicate rule names the tuple it actually compared, so a trace cannot claim a
comparison it did not make.

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

## Running it for real

Judging a spend and *enforcing* one are different things, and for a while only
the first was true here. The engine is pure and takes the ledger as an argument;
`executeIfAuthorised` takes a decision the caller already computed. In both, the
state that decides — how much has been spent today — is supplied by whoever is
asking permission. The policy engine said so outright: *"the ledger window is
per-process and resets on restart."*

A budget that resets on restart is not a budget. An agent that wants to
overspend waits for a deploy.

So the ledger is durable and there is one entry point where the caller supplies
none of the inputs that decide:

```
POST /authority/spend      { "amount": 0.40, "category": "market-data" }

  1. read the policy from PolicyRegistry, Sepolia    ← not from the request
  2. check the document hashes to the anchor          ← not from the request
  3. take the partition lease
  4. read the spend window from MongoDB               ← not from the request
  5. run all fifteen rules
  6. record the decision, approved or refused
  7. charge the budget, then execute through KeeperHub
```

Three properties the store has that a counter would not:

- **Windows are computed at read.** The trailing hour is derived from stored
  call timestamps, the daily budget from the stored UTC day key. Nothing has to
  have been running for the answer to be right — an instance down for a week
  reads what one that never stopped reads.
- **Cooldown clocks are stored as pairs, not a map.** The engine keys them by
  host, hosts contain dots, and a dotted Mongo key is a path expression whose
  failure is silent: the lookup misses, the rule reads "never called", and the
  cooldown never fires.
- **The lease crosses processes.** A Mongo document with a unique id and a TTL,
  which is the durable form of the in-memory per-agent lock.

The budget is charged **before** the transfer, not after. Both orders lose
something if the process dies mid-request: charge-first can consume budget for a
spend that never happened, execute-first can move money no budget counted. The
first over-refuses, the second over-spends.

`/authority` on the site is that loop, operable. Spend it down and reload — the
refusal is still true, because it is in a database rather than in the page.

| Step | Result | Transaction |
|---|---|---|
| Anchor this gateway's policy | `ACTIVE`, owner = KeeperHub | [`0x17cc144a`](https://sepolia.etherscan.io/tx/0x17cc144a475c94e2243dd859166a90ab2fd2923728f876de5bc9dda7054a9ad2) |
| Approved $0.25 spend | budget 0.50 → 0.75 | [`0xd8bd2b61`](https://sepolia.etherscan.io/tx/0xd8bd2b6170811f38831ea6b118f142ecaebbf0b2389e137e2ac5e508062288b8) |
| Approved $0.40, driven from the browser | budget 0.75 → 1.15 | [`0x67c881c2`](https://sepolia.etherscan.io/tx/0x67c881c2a723670cfdeec3a7ff3515ed5274321bde5f69ea7527eba88b38dc45) |
| Pause on chain | next spend dies at `policy.active`, rule 1 of 15 | [`0x384a73fe`](https://sepolia.etherscan.io/tx/0x384a73fe41aaad058d171984d17838b08a50ebab440bc40d3d4e47db436e1b9d) |
| Resume | `ACTIVE` again | [`0x408a2da6`](https://sepolia.etherscan.io/tx/0x408a2da6841874095e4fd9b6d5c00dc0d8ce119e582dd3f87c80d46a6b73df50) |

Budget read `0.75` before a process restart and `0.75` after, then the same
figure from a different machine — the deployed gateway — because the ledger is
shared, not per-instance.

## Deployments

| | |
|---|---|
| `PolicyRegistry` | [`0x13452fcA…C5E304`](https://sepolia.etherscan.io/address/0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304) |

## KeeperHub surfaces used

| Surface | Where |
|---|---|
| **Execute API** | every policy anchor, every authorised transfer |
| **MCP server** | KeeperHub's, to create and publish a workflow; plus `mandate-mcp`, seven tools of our own including a real preflight |
| **x402** | spec-exact adapter and an autonomous payer, with a Challenge Binding Check so a swapped payee is caught before signing |
| **Workflow builder** | [`mandate-policy-status`](https://app.keeperhub.com), listed at $0.02/call |
| **Audit trail** | KeeperHub's execution record read back at `/inspect`; our own decision record, refusals included, persisted to MongoDB |
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
npm i mandate-sdk mandate-policy   # the authority, the payer, the KeeperHub client
npx mandate-mcp                    # seven MCP tools; every read-only one needs no credential
```

Two packages, because they answer different questions and only one of them
needs a connection. `mandate-policy` decides whether a spend is allowed and is
pure — no I/O, no credential, runs in a browser, which is why the decision demo
on the site can run the real engine client-side. `mandate-sdk` is everything
that touches the world: the durable ledger, the anchor reads, the KeeperHub
client, the x402 payer.

## Run it

```bash
npm install
npm test                       # 189 across policy, bureau, escalation, receipts, sdk and mcp
npm run test:contracts         # 27 more against the Solidity
npm run build -w mandate-web
```

Set `KEEPERHUB_API_KEY`, `SEPOLIA_RPC_URL` and `MONGODB_URI` in `.env` (see
`.env.example`).

## What this used to be

An earlier version of this repo argued a different thesis: that x402 settles on
a facilitator's word, and a payment can report success while moving nothing.
That is true, it was demonstrated with a real lying facilitator against a real
escrow, and it is not this product. Keeping it meant shipping two products under
one name, so the resource server, the escrow, the job board and the
verify-a-payment page were removed rather than left to confuse anyone reading.

What survived is what the authority actually uses: the chain-reading verifier
(so a payment the authority made can be checked), the x402 payer (so an agent
can buy from KeeperHub's marketplace), and the Challenge Binding Check.

## Provenance

The fifteen-rule engine and its canonical hashing are **ported from
[untch](https://untch.xyz)**, a production authority layer live on X Layer
mainnet, and moved here onto KeeperHub and Sepolia. The port swaps viem for
ethers; `hashSpendIntent` is verified byte-identical to the Solidity
implementation across untch's differential corpus (**15/15**), and untch's own
engine suite passes against it (**68/68**).

Written here: the KeeperHub anchoring and loader, the authority gate, the
autonomous x402 marketplace payer, `MandateReceipts` and the merkle receipt
writer, the reliability bureau, the escalation service, the MCP server and the
console.

## Known gaps

Stated rather than hidden.

- **MPP is unused.** Tempo is reachable (chain 4217 / 42431) and the CLI talks
  to it, but the KeeperHub wallet holds no Tempo balance
  (`kh wallet balance --chain 42431` → "No balances found"), so an MPP payment
  cannot settle. Blocked on funding, not on capability — so it is left undone
  rather than faked.
- **Sepolia, not mainnet.** x402's own gate is Base-mainnet-only.
- **One policy, one agent.** The gateway enforces a single anchored policy read
  from `POLICY_ID`. The registry, the engine and the ledger are all keyed per
  policy and would take many without changing shape, but nothing here provisions
  a second one, so multi-tenancy is untested rather than supported.
- **The daily budget is $5 and shared.** `/authority` is public and unmetered
  beyond the policy itself, so a determined visitor can spend the day's float
  and leave the next one only refusals. That is the honest consequence of
  letting the product be the rate limit; a real deployment would scope a policy
  per caller.
- Verification covers ERC-20 transfers, not arbitrary off-chain work.
