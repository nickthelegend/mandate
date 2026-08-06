# outcome-sdk

**Pay agents for verified results, not attempts.**

x402 releases funds when a facilitator returns success, and the buyer is
expected to trust it. Nothing checks that value actually moved.

`status: 0x1` only means the EVM did not revert. A transaction can mine, emit no
logs, transfer nothing, and still be recorded as a payment by every rail that
reads the status byte. This package reads the receipt instead.

```bash
npm i outcome-sdk
```

## Verify a payment

```ts
import { OutcomeClient } from "outcome-sdk";

const outcome = new OutcomeClient({
  provider: "https://ethereum-sepolia-rpc.publicnode.com",
  escrow: "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B",
  token: "0x49C86277a91002c4943837bf20F6ED41976Db09F",
});

const { proven, reason, observed, proof } = await outcome.verify({
  transactionHash,
  recipient,
  minAmount: 1_000_000n,
});
```

`proven` is `false` unless a real ERC-20 `Transfer` of at least `minAmount`
reached `recipient`. Unreadable evidence resolves to **not proven**, never
proven — a false negative costs a retry, a false positive pays for nothing.

## Don't do the same job twice

The intent id is derived from the work, so two agents independently told to do
the same job produce the same id and collide on chain instead of both paying.
This is the half of an idempotency key a header cannot provide: a header can be
rotated, a mapping cannot.

```ts
const id = outcome.intentId("deliver 1 tUSDC to treasury", agentAddress);
if (await outcome.isClaimed(id)) return; // someone is already on it
```

## Don't get stuck

```ts
const d = outcome.diagnose({ reason: "timeout waiting for confirmation" });
// { cause: "in_flight", retryable: false, worthRescuing: false, correction: … }
```

An unknown outcome is classified as in-flight and is **never** worth resending —
the first attempt may still land, and resending pays twice.

## Three entry points

| Import | Runs in | Holds |
|---|---|---|
| `outcome-sdk` | anywhere | read and verify. No `node:` builtins, no React, no credential. |
| `outcome-sdk/react` | React 18+ | `OutcomeProvider`, `useIntents`, `useIntent`, `useEscrowed`, `useVerify` |
| `outcome-sdk/node` | Node | settlement through KeeperHub, the worker agent, the audit trail |

The split is a position, not packaging convenience. The party being asked to
trust a payment is the one who most needs to check it, so checking must not
require a server or a key — verification runs in a browser against any ethers
provider, including a wallet's. A build step walks the emitted modules and fails
if `node:` or React ever reaches the main entry.

## React

```tsx
import { OutcomeProvider, useIntents, useVerify } from "outcome-sdk/react";

function Ledger() {
  const { data: intents, loading } = useIntents();
  // every intent the escrow has seen, assembled from events, newest first
}
```

## Settling

Settlement moves money, so it lives behind `/node` and needs a KeeperHub key.
Release and refund execute through KeeperHub's execute API: simulated before
sending, idempotent per attempt, gas sponsored.

```ts
import { createTools, KeeperHubClient } from "outcome-sdk/node";
```

`outcome_settle` takes a **transaction hash, never a verdict**. An agent that
could assert "the work is done" and have money move on its word would be exactly
what this replaces.

## Links

- Console and live explorer — [github.com/nickthelegend/outcome](https://github.com/nickthelegend/outcome)
- MCP server — [`outcome-mcp`](https://www.npmjs.com/package/outcome-mcp)

MIT
