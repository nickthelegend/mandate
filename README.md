# Outcome

**x402 pays per request. Nobody checks the request was served, or that the money
moved. This makes it pay per verified result.**

Agents Onchain 2026 · Sepolia · executes through KeeperHub

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

## The loop

```
claim intent  ->  escrow  ->  do the work  ->  verify  ->  release / refund / retry
```

| Stage | What holds |
|---|---|
| **Claim** | The intent id is derived from the work, so two agents given the same job collide on chain instead of both paying. This is the half of an idempotency key a header cannot provide — a header can be rotated, a mapping cannot. |
| **Escrow** | Funds sit between claim and verdict. There is no window where the payer has paid and the work is unproven. |
| **Verify** | The receipt is read for a real ERC-20 `Transfer` to the recipient. No Transfer, no release. Unreadable evidence is *not proven*, never *proven*. |
| **Settle** | Release, refund, or diagnose-and-retry. Payment follows the outcome, not the attempt. |

**No AI adjudicator.** Every comparable project — Clawback, internet-court,
x402r — resolves disputes with an LLM judge. When the chain already knows
whether value moved, adjudication is a lookup, not an opinion. There is no model
in the money path.

## Live on Sepolia

`OutcomeEscrow` — [`0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B`](https://sepolia.etherscan.io/address/0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B)

| What was proven | Transaction |
|---|---|
| Deploy | [`0x81534a1e`](https://sepolia.etherscan.io/tx/0x81534a1e9c623a4f7d33e679df3c65990f12c2ddd796d8cb5b0182e1f7c1630b) |
| Claim — money into escrow, payee unpaid | [`0x9117b580`](https://sepolia.etherscan.io/tx/0x9117b5804879c0aaed2978cb769c90ecede443d9329a9de0654d0adc4ad1c865) |
| Work that mined and moved nothing → refunded | [`0xf2c4055d`](https://sepolia.etherscan.io/tx/0xf2c4055d08d9b52ca5f4f89fe2cd6c670e2204c2458e4731fd3c0ae0eda5073c) |
| Agent did the work, unprompted | [`0x749a8459`](https://sepolia.etherscan.io/tx/0x749a8459508963b5a85533767b934c20bc3c38656984d711380046cd5346665a) |
| Agent proved it and got itself paid | [`0x6cf46523`](https://sepolia.etherscan.io/tx/0x6cf465234f8a08b01b74719e707b4c0a1ab005a5ab36de8c79b0e15cb22c9fe2) |

Release and refund both execute **through KeeperHub's execute API** — simulated
before sending, idempotent per attempt, gas sponsored.

## Dashboard

**[nickthelegend.github.io/outcome](https://nickthelegend.github.io/outcome/)** — a single static page that reads the escrow directly from a
public Sepolia RPC. No backend and no database on purpose: a dashboard for a
project about verification should be checkable against the chain by anyone
looking at it, not trusted because a server said so.

Live, no install. To run it locally instead:

```bash
python3 -m http.server 4177
```

Every row is an event this contract emitted. The refunded row carries the
verifier's actual reason, read off chain -- *no Transfer of \<token\> to
\<recipient\> in 1 log(s)* -- for a transaction that mined with `status: 0x1`.

## 60-second demo

```bash
cp .env.example .env          # SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, KEEPERHUB_API_KEY
cd verifier && npm install
```

**1. Both branches, 40 seconds.** Two intents: one where the work happened, one
where it did not.

```bash
node --experimental-strip-types src/run-demo.ts
```

> `work-done` → 1 log, real Transfer → **PROVEN** → release → state `Released`
> `work-not-done` → an `approve`: mines `status 0x1`, emits `Approval` and not
> `Transfer`, moves nothing → **NOT PROVEN** → refund → state `Refunded`

The second is the point. That transaction succeeded by every measure a
status-only check applies, and it paid nobody.

**2. Diagnosis, 10 seconds.** Why a failure happened and whether retrying helps.

```bash
node --experimental-strip-types src/run-rescue.ts
```

**3. An agent using it, unattended.** A payer posts a job, escrows, and walks
away. Nothing after that line is driven by a human.

```bash
node --experimental-strip-types src/run-agent.ts
```

> agent finds an intent naming it as payee → reads the job the intent commits to
> → does the work on chain → hands the hash to the verifier → **release**, and it
> is paid.

The agent does not get to declare its own work complete. It performs the action
and submits a transaction hash; the verifier reads the receipt and decides. An
agent that could assert its way to a payout is the thing this project replaces,
so it is held to the same evidence standard as anyone else — including when it
is the one being paid. It can also lose: if the work does not land, the payer is
refunded and the agent earns nothing. That is the intended branch, not an error
path.

It declines work it cannot describe, rather than guessing at a job whose task
string it does not hold — it cannot prove work it cannot state.

**4. As a tool, 10 seconds.** Six MCP tools over stdio.

```bash
node --experimental-strip-types src/server.ts
```

`outcome_intent_id` · `outcome_get_intent` · `outcome_verify` · `outcome_settle`
· `outcome_diagnose` · `outcome_audit`

## Two boundaries worth reviewing

**`outcome_settle` takes a transaction hash, never a verdict.** An agent that
could assert "the work is done" and have money move on its word would be exactly
what this replaces. A test asserts the handler never reads a caller-supplied
`proven` flag, because that boundary *is* the product and a refactor could
quietly erode it.

**`outcome_audit` exists because KeeperHub has no equivalent.** It writes agent
actions to an append-only trail and exposes no agent-reachable read — both
routes are session-cookie only, and grepping its MCP registry for `audit`
returns nothing. A service deciding whether an agent gets paid owes it an
account of why. Persisted as append-only JSON lines, so a restart does not empty
it and a torn write costs one entry rather than the file.

## Tests — 49, all passing

```bash
cd contracts && npx hardhat test      # 12
cd verifier  && npm test              # 37
```

Written against the failures the promise model permits, not the happy path:
double claim, re-claim after settlement, double release, refund after release,
verdicts from revoked verifiers, reclaim before and after the window, a solvency
case running three interleaved intents to three endings that must land the
balance at zero, a mined transaction with zero logs, a worthless token emitting
a large Transfer, under-delivery, in-flight classification that must never
resend, and restart survival.

One suite exists because of a bug this build actually hit. The ABIs here are
hand-written strings, and a wrong one does not throw — it decodes. Adding
`beneficiary` to `Intent` left three files on the five-field declaration, so
`intents()` decoded `refundableAt` as `state`, every open intent read as
settled, and the agent silently found no work. Nothing errored anywhere. Those
declarations are now checked against the compiled artifact, not against each
other — comparing them to one another only proves they drifted together.

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
contracts/    OutcomeEscrow.sol, deploy + proof scripts, 12 tests
verifier/
  src/verify.ts     receipt -> verdict. The core claim.
  src/diagnose.ts   why it failed, and whether resending can fix it
  src/settle.ts     verdict -> KeeperHub execute
  src/tools.ts      the six agent-facing handlers
  src/agent.ts      a worker agent that finds jobs, does them, and gets paid
  src/server.ts     MCP transport, deliberately thin
  vendor-kh/        KeeperHub client, carried over with its 45-test history
index.html    static dashboard, reads the chain with no backend
```
