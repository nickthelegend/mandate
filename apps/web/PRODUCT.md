# Product

<!-- impeccable:product-schema 1 -->

> Every fact here is inferred from the repository — README.md, DEMO.md, contract
> source, SDK source, page copy, and the live deployment — rather than from an
> interview. The user pre-authorised that substitution explicitly ("write one
> yourself from the actual product… don't ask me for it"). Inferred fields are
> marked `[inferred]`. Nothing here is invented: every claim traces to a file or
> a verified on-chain fact.

## Platform

web

## Users

**Primary: a hackathon judge, 90 seconds in.** [inferred from DEMO.md, which is
written as a 3-minute beat sheet with per-second timings] They arrive
sceptical, from a submission page, having already seen a dozen projects that
claim more than they prove. They are not going to clone a repo. They will click
two things and decide.

**Secondary: an engineer evaluating the SDK.** [inferred from README's install
block and the four documented entry points] They want to know whether
`mandate-sdk` is real infrastructure or a demo dressed as a package, and they
answer that by reading the API surface and checking whether the claims are
checkable.

**Tertiary: an agent, programmatically.** Six MCP tools over stdio, and a public
`/audit` endpoint that needs no credential. The console is the human-readable
face of surfaces an agent reads as JSON.

## Product Purpose

Teams are handing autonomous agents private keys and hoping. Mandate is the
authority that sits between an agent and its money: fifteen deterministic rules,
anchored on chain, and — because KeeperHub holds the signer and the policy is
the only path to execution — a limit the agent has no key to break.

Success is a visitor who *tries to overspend and watches it stop*, then sees the
same refusal proven on chain. Not a claim about safety; a gate they operated
themselves.

Receipt verification still exists and still matters — it is how a spend is
confirmed to have moved value — but it is now a component of the authority, not
the pitch.

## Positioning

**A status byte is not evidence.** `status: 0x1` means the EVM did not revert;
it says nothing about whether value moved. Every comparable project (Clawback,
internet-court, x402r) resolves payment disputes with an LLM judge. Mandate
resolves them with a lookup, because the chain already knows.

Three claims a neighbouring project cannot truthfully copy, each verifiable on
chain:

- The agent holds **no private key and no ETH**; the wallet that funds delivery
  has `0.0 ETH` (work tx `0xef3a8f88`).
- The merchant accepts x402 with **no gas** (settlement `0x3dba2aa4`).
- **Only KeeperHub can move escrowed funds** — the admin's verifier role was
  revoked (`0xe5e25335`); `release` from the deployer reverts `NotVerifier`.

## Operating Context

Ten routes, and they are not one mode.

**Persuade** — `/` only. It has to make one claim land in ninety seconds and let
the visitor test it. Its decision demo runs the real engine client-side, so the
persuasion is an operable thing rather than a promise.

**Operate** — `/demo`, `/verify`, `/claim`, `/agent`. Buttons that spend real
testnet funds and take seconds to return. Scanability and honest state beat
expression here; a spinner that never resolves is worse than an error.

**Read** — `/x402`, `/docs` for someone deciding; `/explorer`, `/ledger`,
`/inspect` as records. Comprehension and wayfinding, nothing performing.

Everything on every page is fetched live: Sepolia through a public RPC in the
visitor's own browser, and the hosted gateway for settlement traces and the
decision ledger. There is no backend and no seeded data. Reads take a beat and
can fail; the interface has to be honest about not knowing yet.

## Capabilities and Constraints

- Next.js 15 static export (`output: "export"`), React 19, Tailwind 4, shadcn/ui
  primitives, `basePath: /mandate` on GitHub Pages. No server runtime.
- Data: `mandate-sdk` + `mandate-sdk/react` hooks reading Sepolia client-side;
  the Railway gateway for `/demo`, `/audit`, `/execution/:id`.
- Reads have a 20s deadline and surface failure rather than spinning forever.
- Numbers are base units (6 decimals) and hashes are 66 characters. Both must
  stay copyable and exact — truncation is display-only, never the source.
- Railway sleeps the gateway when idle; a first request can be slow.
- Live on Sepolia. Escrow `0x0ED9d123…dC3B`, USDCx `0x0d864A62…CF13`, both
  verified on Etherscan and Sourcify.

## Brand Commitments

Name: **Mandate**. Existing marks: an emerald status dot beside a lowercase
monospace wordmark.

**Voice, as already written in the repo** — the strongest asset and binding:
plain, specific, unhedged, and willing to state its own limits. It prefers a
concrete number to an adjective ("observed 1000000 to 0x…dEaD" over "payment
verified"). It has a dry register that never becomes jokey: *"A transaction can
mine, emit no Transfer, pay nobody, and satisfy every check x402 performs."* It
names its own failures in public — the README documents what is not done.

No exclamation marks. No emoji. No marketing verbs the product cannot evidence.

## Evidence on Hand

Real, and all of it checkable:

- Live transactions for both x402 mandates: honest `0x3aac3134` (HTTP 200),
  lying `0x6db7218d` (HTTP 402, zero moved).
- A running gateway that produces a fresh pair on demand.
- A public decision ledger in MongoDB, readable without a credential.
- Two verified contracts; 88 passing tests; two published npm packages.
- Merged fixes to KeeperHub's own idempotency semantics and API docs.

**Absent, and never to be fabricated:** users, testimonials, adoption numbers,
uptime figures, funding, team size, partner logos, or any mainnet claim.

## Product Principles

1. **Show the receipt, never the assertion.** Any number on screen must trace to
   a transaction the visitor can open. The product loses its argument the moment
   the interface asks to be believed.
2. **Not knowing is a state worth rendering.** A read in flight is not zero. A
   read that failed is not empty. Both say so.
3. **The failure case is the pitch.** The refused settlement gets more design
   attention than the successful one, because it is the thing nobody else can
   show.
4. **Exactness over comfort.** Hashes, addresses and base units stay precise and
   copyable; the interface may abbreviate for the eye but never for the record.
5. **Earn every claim in the same viewport that makes it.** A statement and its
   proof belong together, not on separate pages.

## Accessibility & Inclusion

Dark-first, and monospace carries meaning throughout — so contrast on the
smallest type is the binding constraint, not an afterthought. Every state the
product distinguishes (proven / not proven / awaiting) must survive being read
in greyscale: colour may reinforce a verdict, never carry it alone.
