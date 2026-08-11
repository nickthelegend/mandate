# Product

<!-- impeccable:product-schema 1 -->

> Every fact here is inferred from the repository — README.md, contract source,
> SDK source, page copy, and the live deployment — rather than from an
> interview. The user pre-authorised that substitution explicitly ("write one
> yourself from the actual product… don't ask me for it"). Inferred fields are
> marked `[inferred]`. Nothing here is invented: every claim traces to a file or
> a verified on-chain fact.
>
> Rewritten after the escrow product was removed. The previous version described
> ten routes, an escrow contract and six settlement tools, none of which exist.

## Platform

web

## Users

**Primary: a hackathon judge, 90 seconds in.** [inferred from the submission
framing and the console's five one-click spend cases] They arrive sceptical,
having already seen a dozen projects that claim more than they prove. They are
not going to clone a repo. They will press two buttons and decide.

**Secondary: an engineer evaluating the SDK.** [inferred from the README's
install block and the three documented entry points] They want to know whether
`mandate-sdk` is real infrastructure or a demo dressed as a package, and they
answer that by reading the API surface and checking whether the claims are
checkable.

**Tertiary: an agent, programmatically.** Seven MCP tools over stdio, every
read-only one usable with no credential, plus a public decision log. The
console is the human-readable face of surfaces an agent reads as JSON.

## Product Purpose

Teams are handing autonomous agents private keys and hoping. Mandate is the
authority that sits between an agent and its money: fifteen deterministic rules,
anchored on chain, and — because KeeperHub holds the signer and the policy is
the only path to execution — a limit the agent has no key to break.

Success is a visitor who *tries to overspend and watches it stop*, then sees the
same refusal on chain and in a public record. Not a claim about safety; a gate
they operated themselves.

## Positioning

**A budget an agent enforces on itself is a suggestion.** The rules live in a
document, the document is canonicalised and hashed, and the hash is anchored in
`PolicyRegistry` on Sepolia. Editing the policy is a transaction. Pausing it is
a transaction. Neither is available to something holding no key.

Three claims a neighbouring project cannot truthfully copy, each verifiable on
chain:

- **The policy is read before every decision, not once at boot.** Change the
  document without re-anchoring and the authority refuses on hash mismatch.
- **The kill switch is on chain.** Paused in the registry, the next spend fails
  at rule 1 of 15 and nothing downstream gets a chance to be clever about it.
- **Refusals are recorded, not only approvals.** The decision log is public,
  needs no credential, and every entry carries the rule and the number it
  compared. Batches of receipts are merkle-anchored in `MandateReceipts`, and a
  holder can verify their own proof against the contract.

## Operating Context

Six routes, and they are not one mode.

**Persuade** — `/` only. It has to make one claim land in ninety seconds and let
the visitor test it. Its decision demo runs the real engine client-side, so the
persuasion is an operable thing rather than a promise.

**Operate** — `/authority`. Five buttons that spend real testnet funds and take
seconds to return, plus the held-spend queue where a person answers. Scanability
and honest state beat expression here; a spinner that never resolves is worse
than an error.

**Read** — `/docs` for someone deciding; `/ledger` and `/inspect` as records.
Comprehension and wayfinding, nothing performing.

Everything on every page is fetched live: Sepolia through a public RPC in the
visitor's own browser, and the hosted gateway for the ledger and execution
records. There is no backend and no seeded data. Reads take a beat and can fail;
the interface has to be honest about not knowing yet.

## Capabilities and Constraints

- Next.js 15 static export (`output: "export"`), React 19, Tailwind 4, shadcn/ui
  primitives, `basePath: /mandate` on GitHub Pages. No server runtime.
- Data: `mandate-policy` runs the real rule engine client-side for the decision
  demo; the Railway gateway serves the authority, the ledger, receipts and
  `/execution/:id`.
- Reads surface failure rather than spinning forever.
- Numbers are base units (6 decimals) and hashes are 66 characters. Both must
  stay copyable and exact — truncation is display-only, never the source.
- Railway sleeps the gateway when idle; a first request can be slow.
- Every visitor is their own agent, with its own budget and duplicate window, so
  one person's spend cannot exhaust or lock out the next.
- Live on Sepolia. `PolicyRegistry` `0x13452fcA…E304`, `MandateReceipts`
  `0x64AE971F…2f60d`, tUSDC `0x49C86277…b09F`.

## Brand Commitments

Name: **Mandate**. Existing marks: an emerald status dot beside a lowercase
monospace wordmark.

**Voice, as already written in the repo** — the strongest asset and binding:
plain, specific, unhedged, and willing to state its own limits. It prefers a
concrete number to an adjective ("observed 5000 against a limit of 1" over
"exceeded the cap"). It has a dry register that never becomes jokey. It names
its own failures in public — the README documents what is not done.

No exclamation marks. No emoji. No marketing verbs the product cannot evidence.

## Evidence on Hand

Real, and all of it checkable:

- A policy anchored, updated, paused and resumed on Sepolia, each a transaction.
- Approved spends that moved tUSDC, refusals that moved nothing, and held spends
  released by a bound operator holding a single-use code.
- A merkle batch of decision receipts anchored in `MandateReceipts`, with a
  proof that verifies both locally and against the contract.
- A public decision log in MongoDB, readable without a credential, refusals
  included.
- Three verified contracts; 216 passing tests; a priced KeeperHub marketplace
  listing that runs green before it was published.
- Merged fixes to KeeperHub's own idempotency semantics and API docs.

**Absent, and never to be fabricated:** users, testimonials, adoption numbers,
uptime figures, funding, team size, partner logos, or any mainnet claim.

## Product Principles

1. **Show the receipt, never the assertion.** Any number on screen must trace to
   a transaction the visitor can open. The product loses its argument the moment
   the interface asks to be believed.
2. **Not knowing is a state worth rendering.** A read in flight is not zero. A
   read that failed is not empty. Both say so.
3. **The refusal is the pitch.** A blocked spend gets more design attention than
   an approved one, because it is the thing nobody else can show working.
4. **Exactness over comfort.** Hashes, addresses and base units stay precise and
   copyable; the interface may abbreviate for the eye but never for the record.
5. **Earn every claim in the same viewport that makes it.** A statement and its
   proof belong together, not on separate pages.

## Accessibility & Inclusion

Dark-first, and monospace carries meaning throughout — so contrast on the
smallest type is the binding constraint, not an afterthought. Every state the
product distinguishes (approved / refused / held) must survive being read in
greyscale: colour may reinforce a decision, never carry it alone. Held is a
state in its own right and must never collapse into refused.
