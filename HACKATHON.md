# Hackathon plan

The build is bigger than the pitch. That is fine — but only if you pitch one
thing and let the rest sit behind it as evidence. This file decides what leads,
what is held in reserve, and what gets cut from the story (not from the repo).

**Deadline: 2026-08-13. Track: Agents Onchain.**

---

## The one sentence

> **x402 pays on a promise. Outcome pays on a receipt.**

Everything else — escrow, SDK, MCP server, the agent, the ledger, the explorer —
exists to make that sentence checkable. None of it is the pitch.

If a judge remembers one thing, it should be: *a payment can report success and
move nothing, and this is the thing that catches it.*

---

## Why the idea feels too big

Eleven surfaces got built, and each is defensible on its own. But a judge gives
you ninety seconds before deciding whether to keep listening, and eleven doors
is the same as no door. The fix is not to delete work — it is to rank it.

**Lead (the pitch):**

| Surface | Job in the pitch |
|---|---|
| `/demo` | The failure, live, on a real transaction |
| `/verify` | They check it themselves, in their own browser |
| `/agent` | The Agents-Onchain claim: no key, no ETH, still paid |
| `/docs` | It is infrastructure, not a demo |

Those four are the header nav, in that order. That is the whole argument.

**Reserve (evidence, in the footer):** the decision ledger, the intent explorer,
the KeeperHub execution record, the x402 write-up, wallet claiming. Do not open
these unprompted. Open them when a judge pushes — and they are exactly what
turns "nice demo" into "this is real".

**Cut from the story entirely:** the monorepo layout, the test count as a
headline, the Sourcify verification story, the ABI-drift fix. All true, none of
it is why anyone should care.

---

## What actually differentiates this

Most submissions in this space resolve payment disputes with an LLM judge. Say
this out loud, once:

> "There is no model anywhere in the money path. The chain already knows whether
> value moved, so adjudication is a lookup, not an opinion."

Three claims a neighbouring project cannot truthfully copy, each with a
transaction on screen:

1. The agent holds **no private key and no ETH** — it signs nothing.
2. The merchant accepts x402 with **no gas** — settlement runs through
   KeeperHub's execute API.
3. **Only KeeperHub can move escrowed funds** — the deployer's verifier role was
   revoked, and `release` from the admin now reverts `NotVerifier`.

---

## The flow, end to end

The full beat sheet with timings and exact wording lives in
[DEMO.md](DEMO.md). The shape of it:

```
0:00  The gap          "A facilitator says success: true. Nobody reads the transaction."
0:25  The failure      /demo → Pay with a lying facilitator → HTTP 402, article withheld
0:50  The contrast     /demo → Pay honestly → HTTP 200, article served
1:10  Their turn       "read this receipt yourself" → /verify, verdict computed in THEIR browser
1:40  The agent        /agent → full cycle, no key, no ETH, paid only because it was proven
2:20  Infrastructure   npm i outcome-sdk · npx outcome-mcp · verification needs no credential
2:50  The close        "No model in the money path."
```

The single most persuasive moment is **1:10**, not the failure. Anyone can show
you a red X. Handing the judge a link that recomputes the same verdict on their
own machine, against terms they can edit, is the part nobody else can fake.

---

## Before you present

Railway sleeps the gateway when idle, and a cold start mid-demo is the one thing
that will make a working project look broken. Warm it, and confirm the pair of
transactions still reads correctly:

```bash
curl -s https://gateway-production-944e.up.railway.app/health
```

Then click through `/demo` once, fully, in the browser you will present from.
The first run is the slow one; let it be the one nobody watches.

**Have the two hashes on a sticky note.** If the live run fails for any reason,
these are already on chain and prove the same thing:

- Lying facilitator, moved nothing: `0x6db7218d717f5be3c3b37f386593bf0bdf3760b0407ac1145c617ac172136603`
- Honest facilitator, moved 1000000: `0x3aac3134ba7c4ce4e12c04e206ad7ce468318607fdb7a8e7ad85e91a70fe72ee`

Both are the *same demand* — same token, same recipient, same amount. That is
what makes the pair an argument rather than two anecdotes.

---

## Questions you will get

**"Isn't this just checking a transaction succeeded?"**
No — that is the exact confusion the project exists to name. `status: 0x1` means
the EVM did not revert. It says nothing about whether value moved. The lying
facilitator's transaction has `status: 0x1` and moved zero.

**"Why not have an LLM decide?"**
Because the chain already knows. A model introduces a way to be wrong about a
question that has a deterministic answer, and it puts a probabilistic component
in the money path.

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
