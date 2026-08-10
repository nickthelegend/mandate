# 3-minute demo

**One line to open with:** *Your agent has your card. What stops it spending
everything?*

Everything below is live. Nothing is a recording.

A recorded run of this script is at `apps/web/demo/mandate-demo.mp4` — two
minutes, made by driving the deployed site against the live gateway, with every
transaction in it landing on Sepolia as it recorded. Re-record any time with
`node apps/web/record-demo.mjs`.

---

## Before you hit record

Open these three tabs:

1. `https://nickthelegend.github.io/mandate/authority/`
2. `https://nickthelegend.github.io/mandate/agent/`
3. A terminal in the repo, with `.env` filled in

Warm the gateway — Railway sleeps idle services and a cold start mid-demo is the
one thing that will make this look broken. This also tells you the two things
that can spoil the run:

```bash
curl -s https://gateway-production-944e.up.railway.app/authority
```

- `onChain.status` must be **ACTIVE**. If a rehearsal left the kill switch
  pulled, resume it (see 1:40 below) before recording.
- The budget is per browser, so a rehearsal does not eat the live run's $5.
  Clearing site data gives you a fresh agent and a visibly fresh budget.

---

## 0:00 — 0:20 · The fear

> "People are giving agents money. The way we bound that today is a number in a
> prompt, or a limit in the agent's own framework — inside the same process as
> the agent you are worried about."

> "A prompt-injected agent is running *inside* that boundary. Asking it to
> respect a limit it can read and edit is not a control."

Then the claim:

> "This is a budget the agent cannot exceed, because it never touches the thing
> that decides."

## 0:20 — 0:45 · The authority, working

Tab 1. Click **Buy market data**.

Wait for it. This is a real Sepolia transfer through KeeperHub, so it takes
twenty or thirty seconds — do not fill the silence by clicking again.

Point at three things as they land:

- **APPROVED**, with all fifteen rules filled in green, in order.
- The budget moving. `$0.00 → $0.40 of $5.00`, and the bar with it.
- The **transaction hash**. Click it. Etherscan, real transfer, real recipient.

> "Fifteen deterministic rules, in a fixed order. No model anywhere in that
> path."

## 0:45 — 1:15 · The refusals

Three clicks, no waiting — a refusal never reaches the chain, so these are
instant. Let the rule chain do the talking each time.

| Click | What refuses it | The line |
|---|---|---|
| **Spend $5,000** | `perCall.cap` — observed 5000.00, limit 1.00 | "This is the prompt-injection case. It does not get to the chain." |
| **Buy the same thing again** | `duplicate` — names the prior intent and its TTL | "Same work, twice. Paid for once." |
| **Buy GPU time** | `category` — compute is not on the allow list | "In budget, and still refused. It is not what this agent is for." |

Then point at the chain itself:

> "Look at what is dimmed. The rules after the refusal were never consulted —
> it stops at the first one that says no, and the dim is telling you the
> difference between *passed* and *never asked*."

## 1:15 — 1:40 · The proof (**the moment**)

Press **Reload the page state**. Then hit browser refresh. Then, if you want to
be unkind about it, open the same URL in a private window.

> "The spend is still gone."

> "That number is not in this page. It is in a database, keyed by the policy id
> that is on chain. It survives a refresh, it survives a redeploy, and it does
> not reset until the UTC day rolls."

This is the beat that separates it from the room. Almost nothing at a hackathon
persists. Give it a full three seconds of silence.

## 1:40 — 2:05 · The third answer

Click **Pay someone new**.

This is a payee the system has never paid, generated fresh each click, so the
bureau is scoring it from nothing at all.

> "Look at the arithmetic. Score 38.5, minus 1.28 times a sigma of 16.6, gives a
> lower bound of 17.2 against a floor of 20. It is not refused because we think
> this address is bad — it is refused because we do not know, and three of the
> seven signals have no honest source, so the uncertainty they carry drags the
> bound under the floor. Missing evidence tightens the limit instead of relaxing
> it."

Then the part nobody else has:

> "And it is not refused. It is *held*. Unknown is a question for a person, not a
> verdict."

Press **Release it**.

> "Bound operator, single-use code the server only stores the hash of. And
> releasing relaxes exactly the rule that escalated — the budget, the per-call
> cap and the rate limit are all still enforced on the way out."

The transfer that follows is real. The budget moves at *release*, not when the
spend was held — so an escalation nobody answers costs nothing.

## 2:05 — 2:30 · The kill switch

Tab 3, the terminal:

```bash
node --experimental-strip-types apps/gateway/src/anchor-policy.ts --pause "$POLICY_ID"
```

Wait for the transaction. Then go back to tab 1 and click **Buy market data** —
the one that worked at 0:20.

> "Refused at `policy.active`. Rule one of fifteen. The other fourteen were
> never consulted, because there is nothing left to consult."

> "That is not a flag in this server's memory. It is a transaction on Sepolia,
> and it applies to every process reading that registry."

Resume it before you move on, or the rest of the demo is refusals:

```bash
node --experimental-strip-types apps/gateway/src/anchor-policy.ts --resume "$POLICY_ID"
```

## 2:30 — 2:45 · The agent, with no key

Tab 2. Click **Run the cycle**.

> "The agent has no private key and no ETH. KeeperHub owns the signer. That is
> why a refusal is binding rather than advisory — the agent has nothing to route
> around it with."

## 2:45 — 2:55 · It is infrastructure

Terminal:

```bash
npm i mandate-sdk
```

> "The engine, the ledger and the anchor are a package. The MCP server is the
> same loop as tools an agent can pick up on its own. Every read works with no
> credential — only moving money needs one."

## 2:55 — 3:00 · Close

> "No model in the money path. A budget that outlives the process, a policy the
> operator cannot quietly widen, and a kill switch that is a transaction."

---

## If the live run fails

These are already on chain and make the same points. Have them on a sticky note.

| What | Transaction |
|---|---|
| Policy anchored through KeeperHub | `0x17cc144a475c94e2243dd859166a90ab2fd2923728f876de5bc9dda7054a9ad2` |
| An approved spend, executed | `0xd8bd2b6170811f38831ea6b118f142ecaebbf0b2389e137e2ac5e508062288b8` |
| Kill switch pulled | `0x384a73fe41aaad058d171984d17838b08a50ebab440bc40d3d4e47db436e1b9d` |
| Kill switch released | `0x408a2da6841874095e4fd9b6d5c00dc0d8ce119e582dd3f87c80d46a6b73df50` |

---

## Held in reserve

Do not open these unprompted. They are what turns "nice demo" into "this is
real" when a judge pushes.

- **`/demo`** — the older argument, still live: an x402 facilitator that reports
  `success: true` on a transaction that mines, emits a log, and pays nobody.
  Open this if asked "what else have you built" or "is x402 not enough".
- **`/verify`** — hand them a link and let them recompute a verdict in their own
  browser, against terms they can edit. Best answer to "how do I know?"
- **`/ledger`** and **`/inspect`** — the decision record and KeeperHub's own
  execution account, both readable with no credential.
- **`/explorer`** — escrowed intents read straight from the chain.
