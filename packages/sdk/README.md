# mandate-sdk

**Pay agents for verified results, not attempts.**

x402 releases funds when a facilitator returns success, and the buyer is
expected to trust it. Nothing checks that value actually moved.

`status: 0x1` only means the EVM did not revert. A transaction can mine, emit no
logs, transfer nothing, and still be recorded as a payment by every rail that
reads the status byte. This package reads the receipt instead.

```bash
npm i mandate-sdk
```

## Verify a payment

```ts
import { MandateClient } from "mandate-sdk";

const mandate = new MandateClient({
  provider: "https://ethereum-sepolia-rpc.publicnode.com",
  escrow: "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B",
  token: "0x49C86277a91002c4943837bf20F6ED41976Db09F",
});

const { proven, reason, observed, proof } = await mandate.verify({
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
const id = mandate.intentId("deliver 1 tUSDC to treasury", agentAddress);
if (await mandate.isClaimed(id)) return; // someone is already on it
```

## Don't get stuck

```ts
const d = mandate.diagnose({ reason: "timeout waiting for confirmation" });
// { cause: "in_flight", retryable: false, worthRescuing: false, correction: … }
```

An unknown outcome is classified as in-flight and is **never** worth resending —
the first attempt may still land, and resending pays twice.

## Four entry points

| Import | Runs in | Holds |
|---|---|---|
| `mandate-sdk` | anywhere | read and verify. No `node:` builtins, no React, no credential. |
| `mandate-sdk/react` | React 18+ | `MandateProvider`, `useIntents`, `useIntent`, `useEscrowed`, `useVerify` |
| `mandate-sdk/x402` | anywhere | the x402 wire format, plus the settlement check the protocol lacks |
| `mandate-sdk/node` | Node | settlement through KeeperHub, the worker agent, the audit trail |

The split is a position, not packaging convenience. The party being asked to
trust a payment is the one who most needs to check it, so checking must not
require a server or a key — verification runs in a browser against any ethers
provider, including a wallet's. A build step walks the emitted modules and fails
if `node:` or React ever reaches the main entry.

## x402

x402 ends at *"the facilitator reported success"* — a field produced by the one
party with an incentive to say yes, next to a transaction hash nobody follows. A
settlement that mined with `status: 0x1`, emitted no `Transfer`, and moved
nothing satisfies every check the protocol performs.

```ts
import { verifySettlement } from "mandate-sdk/x402";

// after the facilitator returns, before you serve the resource
const verdict = await verifySettlement(mandate, {
  requirements,   // the PaymentRequirements you quoted
  settlement,     // the SettlementResponse it handed back
});

if (!verdict.proven) return respond402(verdict.reason);
return serve(resource);
```

A facilitator reporting *failure* is taken at its word — claiming failure is
against its interest and there is nothing to check. A facilitator reporting
success is not.

Also exports the wire format with the specification's exact field names:
`paymentRequired`, `encodePaymentHeader`, `decodePaymentHeader`,
`encodeSettlementHeader`, `decodeSettlementHeader`, and the
`PaymentRequirements` / `PaymentPayload` / `SettlementResponse` types.

## React

```tsx
import { MandateProvider, useIntents, useVerify } from "mandate-sdk/react";

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
import { createTools, KeeperHubClient } from "mandate-sdk/node";
```

`mandate_settle` takes a **transaction hash, never a verdict**. An agent that
could assert "the work is done" and have money move on its word would be exactly
what this replaces.

## Links

- Console and live explorer — [github.com/nickthelegend/mandate](https://github.com/nickthelegend/mandate)
- MCP server — [`mandate-mcp`](https://www.npmjs.com/package/mandate-mcp)

MIT
