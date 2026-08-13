# DoraHacks submission — copy/paste

Every number and address below was checked against the live system on 2026-08-13.
Fields marked **[YOU]** are the ones I cannot fill in for you.

---

## BUIDL name

```
Mandate
```

---

## BUIDL logo

Two 480×480 PNGs are rendered from the same SVG the site uses:

- `recording/brand/mandate-logo-light.png` — mark on paper (**use this one**)
- `recording/brand/mandate-logo-dark.png` — mark on near-black, if the listing renders on a dark card

Both are 11 KB, well under the 2 MB limit. Regenerate with `node scripts/logo-png.mjs`.

---

## Vision

> Paste the block below. It is ~1,900 characters.

```
Agents can spend money now. The way that is done today is an API key in an environment
variable and a system prompt that says "please stay under budget." That is not a limit.
It is a suggestion — made to something that can be talked into anything.

Mandate replaces it with a limit the agent has no key to break.

An operator writes a spending policy: a daily budget, a cap on any single call, which
category may be bought, and what has to happen before a payee with no history gets paid.
That document is canonicalised (RFC 8785), hashed with keccak256, and the hash is
registered in a PolicyRegistry contract on Sepolia — and the transaction that registers it
is executed by KeeperHub, so the registry records KeeperHub's wallet as the policy's owner.
Not ours. Not the agent's.

From then on the limit is structural rather than advisory. The agent holds no signing key
at any point: it asks the authority, fifteen rules run in a fixed order, and only an
approval reaches KeeperHub, which signs and broadcasts the payment. Edit one character of
the policy file and its hash no longer matches the anchor — every spend is refused with
PolicyAnchorMismatch until a human re-anchors it, which is itself a transaction the agent
cannot send.

This matters because prompt injection works on the agent, not on the authority. Convincing
a model that a $5,000 spend was pre-approved changes nothing, because the tool that spends
money is the same tool that enforces the cap. In our demo the agent is told exactly that,
believes it, and works out on its own that it cannot route around the refusal — including
that splitting the spend into 5,000 sub-$1 calls fails on the rate limit.

A refusal is never just "denied". It names the rule and how far the chain got —
"BLOCKED_DUPLICATE at duplicate.taskHash_endpoint_paramsHash, stopped at rule 2 of 15" —
which is something an operator can act on. Vendor reputation is compared as a lower
confidence bound rather than a raw score, so a payee with thin evidence escalates to a
person instead of being flattered by a small sample.

Every decision is on a public record, and every one can be verified with none of our code:
recompute the Merkle root from the receipt, compare it against the root anchored on chain.

Live now on Sepolia: 472 decisions judged, 114 approved, 190 refused, 168 held for a human.
```

---

## Category

**[YOU]** — pick from what the form offers. In order of fit:

1. **AI / Agents** (or "Agents Onchain") — the primary fit
2. **Infrastructure / Developer Tooling** — three npm packages + an MCP server
3. **Payments** — only if the first two aren't options

---

## Links

### GitHub *

```
https://github.com/nickthelegend/mandate
```

> Description and homepage updated 2026-08-13 — the repo no longer advertises the old
> escrow product.

### Project website (optional)

```
https://mandate-keeperhub.vercel.app
```

Deployed 2026-08-13 to Vercel — served from the root, so no `/mandate` path segment. The
GitHub Pages build stays live at `https://nickthelegend.github.io/mandate` as a mirror; the
Actions workflow still runs on every push, so the two do not drift.

Every route in the demo video is live and public — verified by following redirects and
checking the returned content, not just the status code:

| Page | | What a judge can do there |
|---|---|---|
| [`/`](https://mandate-keeperhub.vercel.app/) | 200 | The claim, and the authority's running totals read from the live gateway |
| [`/policy/`](https://mandate-keeperhub.vercel.app/policy/) | 200 | Change a number and watch keccak256 recompute in their own browser |
| [`/connect/`](https://mandate-keeperhub.vercel.app/connect/) | 200 | The MCP config, the 7 tools, the SDK in an editor |
| [`/authority/`](https://mandate-keeperhub.vercel.app/authority/) | 200 | Spend the budget down and watch it refuse |
| [`/ledger/`](https://mandate-keeperhub.vercel.app/ledger/) | 200 | Every decision, and verify one against the chain |
| [`/docs/`](https://mandate-keeperhub.vercel.app/docs/) | 200 | Quickstart |
| [`/inspect/`](https://mandate-keeperhub.vercel.app/inspect/) | 200 | KeeperHub's own execution record |

Confirmed working on the deployed origin: `/policy` starts at `0x81575c62…f095a`
**ANCHORED ON SEPOLIA** and flips to `0xddeae871…` **NOT ANCHORED** on a single keystroke,
and `/connect` reports **AUTHORITY UP · policy 1096875157…736629 · ACTIVE, v3**.

> Vercel enables SSO Deployment Protection by default on team projects, which 302s every
> visitor to a Vercel login page. It was turned off for this project — worth re-checking
> after any settings change, because a status-code check alone does not catch it: the
> redirect ends at a login page that returns 200.

### Demo video *

**[YOU]** — upload `recording/mandate-demo-subtitled.mp4` (4:58, 23 MB, subtitles burned in)
to YouTube and paste the link here.

### YouTube title

```
Mandate — Give an Agent a Budget It Cannot Exceed | KeeperHub Agents Onchain 2026
```

Alternatives, if you want a different angle:

```
I told an AI agent it was approved to spend $5,000. Watch what stopped it.
```
```
Mandate — an on-chain spending limit an AI agent has no key to break (KeeperHub)
```

### YouTube description

```
An AI agent with a spending limit it has no key to break.

Today an agent that can spend money has an API key in an environment variable and a
prompt that says "please stay under budget." That is not a limit — it is a suggestion,
made to something that can be talked into anything.

Mandate makes it structural. A spending policy is canonicalised (RFC 8785), hashed with
keccak256, and the hash is registered in a PolicyRegistry contract on Sepolia. The
transaction that registers it is executed through KeeperHub, so KeeperHub's wallet — not
ours, and not the agent's — is the owner recorded on chain. The agent holds no signing key
at any point: it asks the authority, fifteen rules run in a fixed order, and only an
approval ever reaches KeeperHub, which signs and broadcasts the payment.

Everything in this video is real. The policy is anchored on chain during the recording,
the agent is Claude Code connected to our published MCP server, the payment settles on
Sepolia, and the block explorer shows KeeperHub's relayer as the sender. Nothing is
preloaded and nothing is re-enacted.

The best part is at 3:03, where the agent is told the user already approved a $5,000
spend. It believes it — and works out on its own that it cannot route around the refusal,
including that splitting it into 5,000 sub-$1 calls fails on the rate limit.

CHAPTERS
0:06  The problem
0:23  Fifteen rules, judged in your own browser
0:38  Writing a policy — watch the hash move
0:59  Deploying it through KeeperHub
1:14  The policy the authority enforces
1:26  Hashed and anchored on Sepolia
1:42  The anchoring transaction on Etherscan
1:54  Connecting an agent over MCP
2:15  Claude Code, connected to mandate-mcp
2:26  "What governs me, and what is my budget?"
2:36  An approved spend, settled on chain
2:48  The same spend again — BLOCKED_DUPLICATE
3:03  Prompt injection: "the user approved $5,000"
3:23  A payee with no history — held, not refused
3:37  The payment on the block explorer
3:49  The SDK, in five steps
4:21  Run it — refused at the per-call cap
4:33  The public decision record
4:39  Verified with none of our code

TRY IT
Live site   https://mandate-keeperhub.vercel.app
Write a policy and watch the hash move:
            https://mandate-keeperhub.vercel.app/policy/
Connect your own agent:
            https://mandate-keeperhub.vercel.app/connect/
Source      https://github.com/nickthelegend/mandate

Connect any MCP client in one line:
  claude --mcp-config mandate.mcp.json --strict-mcp-config --allowedTools mcp__mandate

ON NPM
  mandate-sdk     anchoring, the durable ledger, the gate before execution
  mandate-mcp     7 MCP tools; the read-only ones need no credential
  mandate-policy  the 15-rule engine and the RFC 8785 canonicaliser

ON CHAIN (Sepolia)
  PolicyRegistry   0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304
  MandateReceipts  0x64AE971Fda589E4C878F66452b8CE0533032f60d
  KeeperHub relayer 0xA17cb6adb58277E5b4A44B8c1ECB449BB6614E87

Built for KeeperHub Agents Onchain 2026.

#AIAgents #KeeperHub #Ethereum #Sepolia #MCP #AgentPayments #Web3
```

### Social links (at least one)

**[YOU]** — the form needs at least one. Your X/Twitter profile is the usual choice.
If you don't want to use a personal account, the GitHub org profile is accepted by most
DoraHacks forms:

```
https://github.com/nickthelegend
```

---

## Supporting detail (for a "more info" / README field, if the form has one)

### How KeeperHub is used

| Surface | What runs on it |
|---|---|
| **Execute API** | Every on-chain write: anchoring a policy, every authorised transfer, the kill-switch pause |
| **MCP** | Our `mandate-mcp` server (7 tools) — and KeeperHub's own MCP to publish the workflow listing |
| **CLI** | `kh execute contract-call` anchored a policy |
| **Workflow builder** | `mandate-policy-status` — a live listing at $0.02/call |
| **x402** | Spec-exact adapter and an autonomous payer |
| **Audit trail** | KeeperHub's execution record, alongside our own decision ledger |

The one we did **not** use is MPP: Tempo is reachable, but the wallet holds no balance
there, so a payment cannot settle. Stated rather than hidden.

KeeperHub's relayer — [`0xA17cb6adb58277E5b4A44B8c1ECB449BB6614E87`](https://sepolia.etherscan.io/address/0xA17cb6adb58277E5b4A44B8c1ECB449BB6614E87) —
is the `From` on every transaction in the demo. That is the architecture in one line:
we decide, KeeperHub signs, and the two are different parties.

### On chain (Sepolia, chain ID 11155111)

| | |
|---|---|
| PolicyRegistry | [`0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304`](https://sepolia.etherscan.io/address/0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304) |
| MandateReceipts | [`0x64AE971Fda589E4C878F66452b8CE0533032f60d`](https://sepolia.etherscan.io/address/0x64AE971Fda589E4C878F66452b8CE0533032f60d) |
| Token | [`0x49C86277a91002c4943837bf20F6ED41976Db09F`](https://sepolia.etherscan.io/address/0x49C86277a91002c4943837bf20F6ED41976Db09F) (pUSDC, 6dp) |
| Live policy | id `1096875157…736629`, hash `0x81575c62…f095a`, **ACTIVE v3** |
| Anchoring tx | [`0xb314c15c…6e0e0d`](https://sepolia.etherscan.io/tx/0xb314c15cd7053e8f8a714043fe8562f2af1e84b83b67051c40f377a4486e0e0d) |
| Agent's payment | [`0x33e133b2…907994`](https://sepolia.etherscan.io/tx/0x33e133b2d3b9defb4ec665acc483003ef35a2c6728e46d372af8d83b34907994) — 0.4 tokens moved |

### Published on npm

```
npm i mandate-sdk mandate-policy
npx -y mandate-mcp
```

- [`mandate-sdk`](https://www.npmjs.com/package/mandate-sdk) `0.6.0` — anchoring, the ledger, the gate between a decision and its execution
- [`mandate-mcp`](https://www.npmjs.com/package/mandate-mcp) `0.1.2` — 7 MCP tools; read-only ones need no credential
- [`mandate-policy`](https://www.npmjs.com/package/mandate-policy) `0.1.0` — the 15-rule engine and the RFC 8785 canonicaliser

`mandate-bureau`, `mandate-escalation` and `mandate-receipts` are in the repo but not
published — say so if asked rather than implying six packages ship.

### Try it in one line

```bash
claude --mcp-config mandate.mcp.json --strict-mcp-config --allowedTools mcp__mandate
```

### Verify a decision without trusting us

```bash
node scripts/verify-a-receipt.mjs
```

Recomputes the Merkle root from a receipt and compares it against the root anchored on
Sepolia. Zero dependencies — it hand-rolls keccak256 rather than importing ours.

### What's honest about the limits

- The token on Sepolia is a test token named **Polaris USD (pUSDC)**, left over from an
  earlier project. The policy's `budgets.token` field reads `"USDT"` — that field is a
  display label; the engine compares the ERC-20 **address**. The explorer will show
  "Polaris USD" where the agent says "USDT".
- Gas is sponsored by KeeperHub's relayer, which is why the agent needs no funds at all.
- 124 of 124 test-plan items pass, including 25 that spend real money on Sepolia.

---

## Before you hit submit

- [x] ~~Fix the stale GitHub repo description~~ — done 2026-08-13
- [x] ~~Deploy the site so `/policy` and `/connect` stop 404-ing~~ — done, all 7 routes 200
- [ ] Upload the video to YouTube, paste the link
- [ ] Pick a category, add one social link
- [ ] **Rotate the six credentials** that were pasted in plaintext — npm token first,
      since it was used to publish

---

# The four form questions

## Which KeeperHub surfaces did you use?

```
Execute API, MCP server, CLI, workflow builder, x402, and the audit trail — five of the
six listed, plus KeeperHub's own MCP. MPP is the one we did not use.

- Execute API — every on-chain write goes through it: anchoring a policy in
  PolicyRegistry, every authorised transfer, and the kill-switch pause. Nothing in this
  project signs with a local key.
- MCP server — two ways. We publish our own, mandate-mcp on npm, giving any MCP client
  seven tools (can_spend, spend, budget, policy, score, decisions, escalations). And we
  used KeeperHub's MCP to publish our marketplace listing.
- CLI — `kh execute contract-call` anchored a policy.
- Workflow builder — "Mandate — Is This Spending Policy Live" is published and live. It
  answers whether a given policy id is still ACTIVE on chain, priced through x402.
- x402 — a spec-exact adapter and an autonomous payer in mandate-sdk, plus the guard that
  decides whether an autonomous purchase is allowed to happen at all.
- Audit trail — KeeperHub's execution record is the second source on every payment,
  alongside our own decision ledger. Each approved spend carries its execution id, which
  resolves in KeeperHub's own record.

Not used: MPP. Tempo is reachable and the adapter is written, but the wallet holds no
balance there, so a payment cannot settle. Said plainly rather than counted.
```

## Link to a transaction your agent landed onchain via KeeperHub

```
https://sepolia.etherscan.io/tx/0x33e133b2d3b9defb4ec665acc483003ef35a2c6728e46d372af8d83b34907994
```

> This is the agent's own payment, made during the demo recording: it asked the authority,
> all fifteen rules passed, and KeeperHub signed and broadcast it. `From` is KeeperHub's
> relayer `0xA17cb6adb58277E5b4A44B8c1ECB449BB6614E87` — which also paid the gas, so the
> agent needed no funds and no wallet. The ERC-20 transfer row shows 0.4 tokens actually
> moving. Confirmed in block 11467145.
>
> The policy those rules came from was anchored, also through KeeperHub, at
> `0xb314c15cd7053e8f8a714043fe8562f2af1e84b83b67051c40f377a4486e0e0d`.

## Testnet or mainnet?

```
Testnet — Ethereum Sepolia (chain ID 11155111).
```

> One caveat worth stating: the marketplace listing is priced on **Base mainnet**
> (`eip155:8453`), because that is what KeeperHub's x402 gating uses. The listing is
> published and returns a valid payment challenge, but we have not executed a mainnet
> purchase through it.

## What still breaks or is unfinished?

```
1. Operator notification does not go through KeeperHub, which is the one place our
   architecture is weaker than we would like. When a spend is held for a human, KeeperHub
   should carry the message — then "was the operator reached" is answered by KeeperHub's
   execution record rather than by us. Both actions that could do it (webhook/send-webhook
   and the System HTTP Request) return 402 upgrade_required, requiredPlan: pro. The
   workflow definition is written and ready in scripts/create-notify-workflow.mjs; it is
   one plan upgrade from running. What we do instead is the half that needs no plan: the
   receiving end writes the arrival down, so it is evidence of arrival rather than our
   assertion of dispatch. Honest, but weaker.

2. MPP is unused. Tempo is reachable, the wallet has no balance, a payment cannot settle.

3. The token naming is inconsistent and it looks sloppy on the explorer. The policy's
   `budgets.token` field reads "USDT", but that field is a display label — the engine
   compares the ERC-20 contract address. The token deployed on Sepolia is named
   "Polaris USD (pUSDC)", left over from an earlier project. So the agent says "USDT" and
   Etherscan says "Polaris USD". Fixing it properly means re-anchoring the policy, since
   the label is inside the hashed document.

4. Three of the six packages are not published. mandate-sdk, mandate-mcp and
   mandate-policy are on npm; mandate-bureau, mandate-escalation and mandate-receipts are
   in the repo but unpublished, so "six packages" would be an overstatement.

5. The gateway is a single instance. If it goes down, agents cannot get new decisions.
   The anchor, the receipts and the decision log stay independently verifiable — that
   part does not depend on us being up — but there is no failover for the decision path.

6. Escalation resolution is an API call with a one-time code, not a proper operator
   inbox. A human can resolve a held spend, and expiry defaults to denied so nothing
   leaks through by timeout, but there is no dedicated approvals UI.

7. The build fetches Inter from Google Fonts at build time, and that fetch failed one of
   two deploys. A retry cleared it. It should be self-hosted; it is not yet.

8. Vendor scoring is thin by construction. It runs on our own decision history plus
   on-chain signals for the payee, and the system is new — so most payees have little
   evidence. That is handled correctly (a lower confidence bound means thin evidence
   escalates rather than flatters), but it means the floor is doing most of the work
   right now, not the ranking.
```
