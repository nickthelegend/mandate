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

> ⚠️ **Fix the repo description before you submit.** It currently reads:
> *"Pay per verified result, not per request. Agent payment escrow with on-chain outcome
> verification…"* — that is the old escrow product that no longer exists. A judge opening
> the repo reads a description of software that isn't there. Suggested replacement:
>
> ```
> Give an agent a budget it cannot exceed. A spending policy hashed and anchored on Sepolia, enforced by 15 ordered rules, with every transaction executed through KeeperHub — the agent never holds a key. Agents Onchain 2026.
> ```
>
> I can apply this with one command if you want it.

### Project website (optional)

```
https://nickthelegend.github.io/mandate
```

> ⚠️ **Deploy first.** `/policy` and `/connect` currently 404 on the live site, and the demo
> video spends about ninety seconds on both. Anyone who follows the video to the site hits
> two dead pages.

### Demo video *

**[YOU]** — upload `recording/mandate-demo-subtitled.mp4` (4:58, 23 MB, subtitles burned in)
to YouTube and paste the link.

Suggested title:
```
Mandate — give an agent a budget it cannot exceed (Agents Onchain 2026)
```

Suggested YouTube description:
```
An agent with a spending policy it has no key to break. The policy is hashed
(RFC 8785 + keccak256) and anchored in a PolicyRegistry contract on Sepolia; the
anchoring transaction and every payment are executed through KeeperHub, so KeeperHub's
wallet — not ours, not the agent's — is the owner recorded on chain.

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

Live: https://nickthelegend.github.io/mandate
Code: https://github.com/nickthelegend/mandate
npm:  mandate-sdk · mandate-mcp · mandate-policy
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

- [ ] Fix the stale GitHub repo description (above)
- [ ] Deploy the site so `/policy` and `/connect` stop 404-ing
- [ ] Upload the video to YouTube, paste the link
- [ ] Pick a category, add one social link
- [ ] **Rotate the six credentials** that were pasted in plaintext — npm token first,
      since it was used to publish
