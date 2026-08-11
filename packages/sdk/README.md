# mandate-sdk

**Give an agent a budget it cannot exceed.**

Not a wallet guard the agent enforces on itself — a policy anchored on chain,
read before every decision, holding a key the agent does not have.

```bash
npm i mandate-sdk
```

## The shape of it

A spending policy is a JSON document. Canonicalise it (RFC 8785), hash it, and
anchor the hash in `PolicyRegistry` on Sepolia. From then on, the authority
reads that anchor before it decides anything and refuses outright if the
document in front of it does not hash to what the chain holds.

Editing the policy is a transaction. Pausing it is a transaction. Neither is
something an agent that holds no key can do.

```ts
import { anchorPolicy, readAnchoredPolicy, assertAnchored } from "mandate-sdk/node";

const { policyId, policyHash } = await anchorPolicy({ rules, agent, keeperhub });

// before every decision, not once at boot
const anchored = await readAnchoredPolicy({ provider, registry, policyId });
assertAnchored(anchored, rules); // throws PolicyAnchorMismatch / PolicyNotUsable
```

`assertAnchored` throws rather than returning a flag on purpose. A caller that
can forget to check a boolean will eventually forget.

## Decide, then execute — never the other way round

`evaluateSpend` returns a decision **and a set of proposed effects**. It applies
nothing. The caller applies the effects only on the path where money actually
moves, which is what makes a preflight a real preflight instead of a dry-run
flag on the same code.

```ts
import { evaluateSpend } from "mandate-sdk";
import { mongoLedger, executeIfAuthorised } from "mandate-sdk/node";

const ledger = await mongoLedger(uri);
const decision = await evaluateSpend({ rules, intent, snapshot: await ledger.read(key) });

if (!decision.approved) return decision;      // nothing written, nothing moved
await executeIfAuthorised(decision, transfer); // and only now
```

The ledger is durable and shared: budgets, duplicate windows, cooldowns and
rate limits survive a restart and are not per-replica, held under a Mongo lease
so two concurrent decisions serialise instead of both seeing the same balance.

## Read the receipt, not the status byte

`status: 0x1` only means the EVM did not revert. A transaction can mine, emit no
logs, transfer nothing, and still be recorded as a payment by anything that
reads the status byte.

```ts
import { verifyTransfer } from "mandate-sdk";

const { proven, reason, observed } = await verifyTransfer(provider, {
  transactionHash,
  token,
  recipient,
  minAmount: 1_000_000n,
});
```

`proven` is `false` unless a real ERC-20 `Transfer` of at least `minAmount`
reached `recipient`. Unreadable evidence resolves to **not proven**, never
proven — a false negative costs a retry, a false positive pays for nothing.

## Buying from a marketplace without being overcharged

x402 hands the seller both the price and the payee, in a challenge the buyer is
expected to sign. `bindingFor` pins what you agreed to against what you were
served, so a swapped payee or a raised price is caught before a signature
exists.

```ts
import { discover, parseChallenge, bindingFor, bindingMismatches, payAndCall } from "mandate-sdk";

const challenge = parseChallenge(await fetch(url));
const mismatches = bindingMismatches(bindingFor(expected, challenge));
if (mismatches.length) throw new Error(`challenge does not match the quote: ${mismatches[0].field}`);
```

## Don't get stuck

```ts
import { diagnose } from "mandate-sdk";

const d = diagnose({ reason: "timeout waiting for confirmation" });
// { cause: "in_flight", retryable: false, worthRescuing: false, correction: … }
```

An unknown outcome is classified as in-flight and is **never** worth resending —
the first attempt may still land, and resending pays twice.

## Three entry points

| Import | Runs in | Holds |
|---|---|---|
| `mandate-sdk` | anywhere | decide, read, verify. No `node:` builtins, no credential. |
| `mandate-sdk/x402` | anywhere | the x402 wire format, plus the settlement check the protocol lacks |
| `mandate-sdk/node` | Node | the Mongo ledger, KeeperHub execution, policy anchoring, the audit trail |

The split is a position, not packaging convenience. The party being asked to
trust a payment is the one who most needs to check it, so checking must not
require a server or a key — verification runs in a browser against any ethers
provider. A build step walks the emitted modules and fails if `node:` ever
reaches the main entry.

## Links

- Console, decision record and docs — [github.com/nickthelegend/mandate](https://github.com/nickthelegend/mandate)
- MCP server — [`mandate-mcp`](https://www.npmjs.com/package/mandate-mcp)
- The rule engine on its own — [`mandate-policy`](https://www.npmjs.com/package/mandate-policy)

MIT
