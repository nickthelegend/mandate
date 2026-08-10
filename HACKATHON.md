# Hackathon plan

The build is bigger than the pitch. That is fine — but only if you pitch one
thing and let the rest sit behind it as evidence. This file decides what leads,
what is held in reserve, and what gets cut from the story (not from the repo).

**Deadline: 2026-08-13. Track: Agents Onchain.**

---

## The one sentence

> **Give an agent a budget it cannot exceed.**

Everything else — the engine, the registry, the ledger, the escrow, the SDK, the
MCP server, the x402 work — exists to make that sentence true rather than
aspirational. None of it is the pitch.

If a judge remembers one thing, it should be: *the limit is not in the agent's
prompt, and not in the agent's process. It is on chain and in a database, and
the agent has no key to route around it with.*

### Why this and not "verified payments"

The earlier pitch was "x402 pays on a promise, Outcome pays on a receipt." It is
true, the demo still runs at `/demo`, and it is now a supporting exhibit rather
than the argument. Two reasons it lost the lead:

1. **It describes a check, not a product.** Everyone in this track can bolt a
   receipt check onto something. Nobody can hand you an agent whose budget is
   enforced somewhere the agent cannot reach.
2. **The spending problem is the one people actually have.** "My agent might get
   prompt-injected and drain the account" is a fear people already hold. "A
   facilitator might lie about settlement" needs to be explained first.

---

## Why the idea feels too big

Twelve surfaces got built and each is defensible on its own. But a judge gives
you ninety seconds before deciding whether to keep listening, and twelve doors
is the same as no door. The fix is not to delete work — it is to rank it.

**Lead (the pitch):**

| Surface | Job in the pitch |
|---|---|
| `/authority` | The product, live. Spend it down; the refusal survives a reload |
| `/verify` | They check a payment themselves, in their own browser |
| `/agent` | The Agents-Onchain claim: no key, no ETH, still paid |
| `/docs` | It is infrastructure, not a demo |

Those four are the header nav, in that order. That is the whole argument.

**Reserve (evidence, in the footer):** the x402 lying-facilitator demo, the
decision ledger, the intent explorer, the KeeperHub execution record, the x402
write-up, wallet claiming. Do not open these unprompted. Open them when a judge
pushes — and they are exactly what turns "nice demo" into "this is real".

**Cut from the story entirely:** the monorepo layout, the test count as a
headline, the Sourcify verification story, the ABI-drift fix, the untch port.
All true, none of it is why anyone should care.

---

## What actually differentiates this

Most submissions in this space put a model somewhere in the money path — an LLM
judge, an LLM approver, an agent that decides its own limits. Say this out loud,
once:

> "There is no model anywhere in the money path. Fifteen deterministic rules, in
> a fixed order, against a budget the agent cannot read or write."

Four claims a neighbouring project cannot truthfully copy, each with something on
screen:

1. **The budget survives.** It is in MongoDB, keyed by the on-chain policy id.
   Restart the server, reload the page, open another browser — the spend is
   still gone. Almost every hackathon demo resets on refresh; this one is the
   demo *because* it does not.
2. **The policy is on chain, and it is load-bearing.** The document is hashed and
   checked against `PolicyRegistry` before every decision. Edit a rule and every
   spend is refused for a hash mismatch — the operator cannot quietly widen a
   budget after the fact.
3. **The kill switch is a transaction.** Pause the policy on Sepolia and the very
   next request fails `policy.active`, rule 1 of 15, with the other fourteen
   never consulted. It is not a flag in one process's memory.
4. **The agent holds no private key and no ETH.** KeeperHub owns the signer, so a
   refusal is not advice the agent can decline to take. There is nothing to
   route around it with.

---

## The flow, end to end

The full beat sheet with timings and exact wording lives in
[DEMO.md](DEMO.md). The shape of it:

```
0:00  The fear         "Your agent has your card. What stops it spending everything?"
0:20  The authority    /authority → buy market data → APPROVED, real Sepolia transfer
0:45  The refusals     $5,000 → per-call cap. Same request twice → duplicate. GPU → category.
1:15  The proof        Reload the page. The spend is still gone. It is in a database.
1:40  The kill switch  Pause on chain → next request dies at rule 1 of 15
2:10  The agent        /agent → full cycle, no key, no ETH
2:35  Infrastructure   npm i outcome-sdk · npx outcome-mcp · reads need no credential
2:55  The close        "No model in the money path."
```

The single most persuasive moment is **1:15**, not the refusal. Anyone can show
you a red X. Pressing reload and having the number still be there is the part
nobody else in the room can fake, because almost nothing at a hackathon persists.

---

## Before you present

Railway sleeps the gateway when idle, and a cold start mid-demo is the one thing
that will make a working project look broken. Warm it and confirm the authority
is live and unpaused:

```bash
curl -s https://gateway-production-944e.up.railway.app/authority
```

`onChain.status` must read `ACTIVE`. If it reads `PAUSED`, a previous run left
the kill switch pulled — resume it before presenting:

```bash
node --experimental-strip-types apps/gateway/src/anchor-policy.ts --resume "$POLICY_ID"
```

**Check the remaining budget.** It is $5 a day and it does not reset until UTC
midnight. If a rehearsal spent it down, the live run will only show refusals —
which is a fine story, but not the one in the beat sheet. Rehearse with the
refusal buttons, which cost nothing, and leave at least one approval's worth.

**Have these hashes on a sticky note.** If the live run fails for any reason,
these are already on chain and prove the same things:

| What | Transaction |
|---|---|
| Policy anchored through KeeperHub | `0x17cc144a475c94e2243dd859166a90ab2fd2923728f876de5bc9dda7054a9ad2` |
| An approved spend, executed | `0xd8bd2b6170811f38831ea6b118f142ecaebbf0b2389e137e2ac5e508062288b8` |
| Kill switch pulled | `0x384a73fe41aaad058d171984d17838b08a50ebab440bc40d3d4e47db436e1b9d` |
| Kill switch released | `0x408a2da6841874095e4fd9b6d5c00dc0d8ce119e582dd3f87c80d46a6b73df50` |
| Facilitator lied, moved nothing | `0x6db7218d717f5be3c3b37f386593bf0bdf3760b0407ac1145c617ac172136603` |
| Facilitator honest, moved 1000000 | `0x3aac3134ba7c4ce4e12c04e206ad7ce468318607fdb7a8e7ad85e91a70fe72ee` |

The last two are the *same demand* — same token, same recipient, same amount.
That is what makes the pair an argument rather than two anecdotes.

---

## Questions you will get

**"How is this different from a spend limit in my agent framework?"**
A framework limit lives in the same process as the agent, and a prompt-injected
agent is running inside that process. This one lives on a chain the agent cannot
write to and in a database it has no credential for, and the signer belongs to
KeeperHub. The agent cannot exceed it because it never touches the thing that
decides.

**"Couldn't the operator just raise the budget?"**
Only by anchoring a new policy on chain, which is a transaction with a
timestamp. That is the point of hashing the document: a decision names the exact
bytes it was judged under, so "we raised it afterwards" is visible rather than
deniable.

**"What if the gateway is down?"**
Then nothing spends. The authority is the only path from a decision to an
execution, so its failure mode is refusal. That is the correct direction for
this component to fail in, and it is why the budget is charged before the
transfer rather than after.

**"Why not have an LLM decide?"**
Because a model introduces a way to be wrong about a question that has a
deterministic answer, and it puts a probabilistic component in the money path.

**"What stops the agent lying to you?"**
It cannot. `outcome_settle` takes a transaction hash and refuses a verdict —
there is no `proven` flag in the schema, and a test asserts there never will be.
An agent supplies evidence, not conclusions.

**"Is this mainnet?"**
No, Sepolia, and the README says so. x402's own gate is Base-mainnet-only, which
is documented as a known gap rather than glossed.

---

## Still outstanding

- [ ] Record the demo video against [DEMO.md](DEMO.md)
- [ ] Rotate every credential that was pasted in plaintext during the build
