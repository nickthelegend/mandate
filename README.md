# Outcome

**x402 pays per request. Nobody checks the request was served, or that the money
moved. Outcome is the settlement layer that reads the receipt.**

An SDK and an MCP server your agent installs. Agents Onchain 2026 · Sepolia ·
executes through KeeperHub.

```bash
npm i outcome-sdk      # https://npmjs.com/package/outcome-sdk
npx outcome-mcp        # https://npmjs.com/package/outcome-mcp
```

**[nickthelegend.github.io/outcome](https://nickthelegend.github.io/outcome/)** —
paste any Sepolia transaction and the verdict is computed in your own browser.

---

## The problem

Agent payment rails settle on a promise.

x402 releases funds when a facilitator returns a success response and the buyer
is expected to trust it. ERC-8004's `proofOfPayment` field is optional and
unenforced. KeeperHub's own `workflow_payments` table has no transaction-hash
column at all, and its MPP path verifies an HMAC locally and executes without
touching the chain. In every case the evidence for "you were paid" is somebody's
word.

**A status byte is not evidence.** `status: 0x1` means the EVM did not revert.
It says nothing about whether value moved. A call to an address with no code
mines successfully and does nothing — which is not hypothetical: I found exactly
that in production last week, where a settlement reported success while the
recipient's balance was byte-identical either side of the block.

Across roughly 900 submissions to eight x402 hackathons, receipts are everywhere
and verification is nowhere.

## Three guarantees

| | Guarantee | Mechanism |
|---|---|---|
| **01** | An agent can't double-pay | The intent id is derived from the work, so two agents told to do the same job collide on chain instead of both paying. This is the half of an idempotency key a header cannot provide — a header can be rotated, a mapping cannot. |
| **02** | An agent can't be lied to | Payment settles on a receipt read. No real `Transfer` to the recipient, no release. Unreadable evidence is *not proven*, never *proven*: a false negative costs a retry, a false positive pays for nothing. |
| **03** | An agent can't get stuck | Failures are diagnosed before they're retried. An unknown outcome is classified as in-flight and never resent, because the first attempt may still land. Funds sit in escrow until a verdict, and the payer can always reclaim. |

**No AI adjudicator.** Every comparable project — Clawback, internet-court,
x402r — resolves disputes with an LLM judge. When the chain already knows
whether value moved, adjudication is a lookup, not an opinion. There is no model
in the money path.

## Try it in one line

```bash
npx -y outcome-mcp
```

No configuration. The defaults point at the live deployment, and every read-only
tool works without a credential — only settlement moves money, and only
settlement needs a key. Then ask it:

```
outcome_verify
  transactionHash  0xf2c4055d08d9b52ca5f4f89fe2cd6c670e2204c2458e4731fd3c0ae0eda5073c
  recipient        0x000000000000000000000000000000000000dEaD
  minAmount        2000000
```

> `proven: false` — *no Transfer of 0x49C86277… to 0x…dEaD in 1 log(s)*

That transaction mined with `status: 0x1` on Sepolia and paid nobody.

Into a client — `.mcp.json`, or `claude_desktop_config.json`:

```json
{ "mcpServers": { "outcome": { "command": "npx", "args": ["-y", "outcome-mcp"] } } }
```

## Or in code

```ts
import { OutcomeClient } from "outcome-sdk";

const outcome = new OutcomeClient({
  provider: "https://ethereum-sepolia-rpc.publicnode.com",
  escrow: "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B",
  token: "0x49C86277a91002c4943837bf20F6ED41976Db09F",
});

const id = outcome.intentId("deliver 1 tUSDC to treasury", agent);
if (await outcome.isClaimed(id)) return;          // someone is already on it

const { proven, reason } = await outcome.verify({ // did it actually pay?
  transactionHash, recipient, minAmount: 1_000_000n,
});
```

Three entry points, and the split is the position rather than packaging
convenience — the party being asked to trust a payment is the one who most needs
to check it, so checking must not require a server or a key:

| Import | Runs in | Holds |
|---|---|---|
| `outcome-sdk` | anywhere | read and verify. No `node:` builtins, no React, no credential. |
| `outcome-sdk/react` | React 18+ | `OutcomeProvider`, `useIntents`, `useIntent`, `useEscrowed`, `useVerify` |
| `outcome-sdk/node` | Node | settlement through KeeperHub, the worker agent, the audit trail |

A build step walks the emitted modules and fails if `node:` or React ever
reaches the main entry — a bug I shipped once before, which does not surface
until somebody else's bundler breaks.

## The loop

```
claim intent  ->  escrow  ->  do the work  ->  verify  ->  release / refund / retry
```

An autonomous agent runs it unattended: it watches for intents naming it as
payee, reads the job the intent commits to, does the work on chain, and hands
the verifier a transaction hash — never a verdict. It can lose. If the work does
not land the payer is refunded and the agent earns nothing, which is the
intended branch rather than an error path.

```bash
node --experimental-strip-types packages/sdk/examples/run-agent.ts
```

## Live on Sepolia

`OutcomeEscrow` — [`0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B`](https://sepolia.etherscan.io/address/0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B)

| What was proven | Transaction |
|---|---|
| Deploy | [`0x81534a1e`](https://sepolia.etherscan.io/tx/0x81534a1e9c623a4f7d33e679df3c65990f12c2ddd796d8cb5b0182e1f7c1630b) |
| Claim — money into escrow, payee unpaid | [`0x9117b580`](https://sepolia.etherscan.io/tx/0x9117b5804879c0aaed2978cb769c90ecede443d9329a9de0654d0adc4ad1c865) |
| Work that mined and moved nothing → refunded | [`0xf2c4055d`](https://sepolia.etherscan.io/tx/0xf2c4055d08d9b52ca5f4f89fe2cd6c670e2204c2458e4731fd3c0ae0eda5073c) |
| Agent did the work, unprompted | [`0x749a8459`](https://sepolia.etherscan.io/tx/0x749a8459508963b5a85533767b934c20bc3c38656984d711380046cd5346665a) |
| Agent proved it and got itself paid | [`0x6cf46523`](https://sepolia.etherscan.io/tx/0x6cf465234f8a08b01b74719e707b4c0a1ab005a5ab36de8c79b0e15cb22c9fe2) |

Release and refund execute **through KeeperHub's execute API** — simulated
before sending, idempotent per attempt, gas sponsored.

## The console

**[nickthelegend.github.io/outcome](https://nickthelegend.github.io/outcome/)** —
a Next.js static export built on the published SDK, not around it. `listIntents`,
`useIntents`, `useEscrowed` and `useVerify` all had to exist for it to render,
which is the point: if the package could not drive the site, it would not be
worth publishing.

`/verify` is the page that matters. Paste any transaction, name who was supposed
to be paid, and the verdict is computed in your browser from the receipt. A
claim about trust you have to take on faith is not worth making, so there is no
backend here to take it on faith from.

## Two boundaries worth reviewing

**`outcome_settle` takes a transaction hash, never a verdict.** An agent that
could assert "the work is done" and have money move on its word would be exactly
what this replaces. A test asserts the tool's schema still accepts nothing but
an intent id and a hash, because that boundary *is* the product and a refactor
could quietly erode it.

**Verification is against the beneficiary, not the payee.** The payee is who
gets paid; the beneficiary is who the work had to reach. Checking the payee
would only ever prove an agent paid itself — which is what the first live agent
run actually did, before the contract recorded the distinction.

## Tests — 61, all passing

```bash
npm test                # 49 across both packages (43 SDK, 6 MCP)
npm run test:contracts  # 12
```

Written against the failures the promise model permits, not the happy path:
double claim, re-claim after settlement, double release, refund after release,
verdicts from revoked verifiers, reclaim before and after the window, a solvency
case running three interleaved intents to three endings that must land the
balance at zero, a mined transaction with zero logs, a worthless token emitting
a large Transfer, under-delivery, in-flight classification that must never
resend, and restart survival.

Two suites exist because of bugs this build actually hit:

- **ABI drift.** The ABIs are hand-written strings, and a wrong one does not
  throw — it decodes. Adding `beneficiary` to `Intent` left three files on the
  five-field form, so `intents()` read `refundableAt` as `state`, every open
  intent looked settled, and the agent silently found no work. Nothing errored
  anywhere. Declarations are now checked against the compiled artifact, never
  against each other — that would only prove they drifted together.
- **The MCP transport.** The stdio suite spawns the *built binary* and speaks
  JSON-RPC to it, because the failures only a transport can produce — a stray
  `console.log` corrupting the stream, a tool that never registers — surface in
  a real client as "the server is broken" with nothing else to go on.

## What is not done

- **Sepolia, not Base.** x402's payment gate is hardcoded to Base mainnet
  (`eip155:8453`) with real USDC. The organiser confirmed testnet is accepted
  and not marked down, and the verification layer is indifferent to which rail
  carries the value — so the x402 adapter is a thin layer, not a rewrite.
- **MPP is untested here.** KeeperHub's agentic wallet hardcodes Tempo testnet
  as chain `4218`, which does not exist; Moderato is `42431`. A passing test
  asserts the wrong value, so CI defends it. Written up with a patch in the
  companion teardown.
- **The audit log is per-instance.** Append-only on disk and restart-safe, but
  not shared across processes. A single verifier is the deployment this assumes.
- **Verification covers ERC-20 transfers.** Proving arbitrary off-chain work
  needs a different oracle and is deliberately out of scope.

## Layout

```
packages/sdk/     outcome-sdk — the client, the verifier, the agent
  src/verify.ts     receipt -> verdict. The core claim.
  src/client.ts     OutcomeClient. Isomorphic, no key, no node builtins.
  src/diagnose.ts   why it failed, and whether resending can fix it
  src/settle.ts     verdict -> KeeperHub execute
  src/agent.ts      a worker agent that finds jobs, does them, and gets paid
  src/react.ts      hooks over the read path
packages/mcp/     outcome-mcp — six tools over stdio, zero-config
apps/web/         the console, built on the published SDK
contracts/        OutcomeEscrow.sol, deploy + proof scripts, 12 tests
```
