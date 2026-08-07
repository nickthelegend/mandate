# 3-minute demo

**One line to open with:** *KeeperHub executes. Nobody checks the execution did
what it claimed.*

Everything below is live. Nothing is a recording.

---

## Before you hit record

Open these three tabs:

1. `https://nickthelegend.github.io/outcome/demo/`
2. `https://nickthelegend.github.io/outcome/explorer/`
3. A terminal in the repo, with `.env` filled in

Sanity check the gateway is warm — Railway sleeps idle services and a cold start
mid-demo is the one thing that will make this look broken:

```bash
curl https://gateway-production-944e.up.railway.app/health
```

---

## 0:00 — 0:25 · The gap

> "KeeperHub executes transactions for agents. What nothing in the stack does is
> check that the execution actually did what it claimed."

> "Their own `workflow_payments` table has no transaction-hash column. The MPP
> path verifies an HMAC locally and never touches the chain. x402 releases funds
> when a facilitator says success. In every case the evidence for *you were
> paid* is somebody's word."

Say the line that makes it concrete:

> "A transaction can mine, return `status: 0x1`, emit no `Transfer`, pay nobody
> — and satisfy every check any of these actually perform."

## 0:25 — 1:10 · Show it, don't say it

Tab 1. Click **Pay honestly**.

> "Real x402. The payer signs an EIP-3009 authorisation and sends no
> transaction. KeeperHub settles it — sponsored, so the merchant needs no ETH."

Point at **HTTP 200**, the Etherscan link, `chain actually moved: 1000000`.

Now click **Pay with a lying facilitator**.

> "Identical protocol. This facilitator submits an `approve` instead — it mines,
> it emits a log, it costs nothing, and it moves no money. Then it reports
> `success: true`."

Let the trace land, then point at the two lines together:

```
facilitator claimed    true
chain actually moved   0
```

> "**HTTP 402. The article is withheld.** A stock x402 server hands it over."

**This is the whole pitch. Do not rush it.**

## 1:10 — 1:50 · The agent has no wallet

Terminal:

```bash
node --experimental-strip-types packages/sdk/examples/run-agent.ts
```

> "A payer posts a job and walks away. The agent finds it, does the work, and
> gets paid — and it holds no private key and no ETH."

While it runs:

> "It doesn't get to declare its own work complete either. It hands over a
> transaction hash, and the verifier reads the receipt and decides. It can lose:
> if the work doesn't land, the payer is refunded and the agent earns nothing."

## 1:50 — 2:20 · Only KeeperHub can move the money

```bash
node --experimental-strip-types -e '
import { JsonRpcProvider, Contract } from "ethers";
const p = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL, 11155111);
const c = new Contract("0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B",
  ["function isVerifier(address) view returns (bool)"], p);
console.log("KeeperHub:", await c.isVerifier("0x7a4FdD120a17e5390D87565e74a3Fbf80dF05FC1"));
console.log("deployer :", await c.isVerifier("0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67"));'
```

> "The contract holds the money. KeeperHub is the only key that opens it — I
> revoked my own. Calling `release` as the admin reverts. And what tells
> KeeperHub to open it is a receipt read, not a person."

## 2:20 — 3:00 · It's infrastructure, not a demo

```bash
npx -y outcome-mcp
```

> "It's on npm. `outcome-sdk` and `outcome-mcp`. Six tools over stdio, zero
> configuration, and every read-only tool works without a credential — so anyone
> can verify any payment without asking permission."

Close on:

> "Building this also produced merged fixes to KeeperHub's own idempotency
> semantics and API docs. The gap I'm filling is the one that reading their
> execution layer closely made obvious."

---

## If asked

**"Isn't the lying facilitator contrived?"** — It submits an `approve`. That is
the cheapest possible thing a real facilitator could do to collect fees without
settling, and the protocol cannot tell the difference. The point is not that
facilitators are malicious; it is that x402 has no way to find out.

**"Why no AI judge?"** — Every comparable project (Clawback, internet-court,
x402r) resolves disputes with an LLM. When the chain already knows whether value
moved, adjudication is a lookup, not an opinion. There is no model in the money
path.

**"Why Sepolia?"** — x402's reference deployment is Base mainnet with real USDC.
The organiser confirmed testnet is accepted. `NETWORK_CHAIN_IDS` already maps
Base and Base Sepolia; the verification layer is indifferent to which chain
carries the value.

---

## Numbers

| | |
|---|---|
| Tests | 81 — 21 contract, 54 SDK, 6 MCP over stdio |
| Packages | [`outcome-sdk`](https://npmjs.com/package/outcome-sdk), [`outcome-mcp`](https://npmjs.com/package/outcome-mcp) |
| Escrow | [`0x0ED9d123…dC3B`](https://sepolia.etherscan.io/address/0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B#code) — verified |
| USDCx (EIP-3009) | [`0x0d864A62…CF13`](https://sepolia.etherscan.io/address/0x0d864A625c280F7f9B9AD024d12F94f5D6DCCF13#code) — verified |
| Console | [nickthelegend.github.io/outcome](https://nickthelegend.github.io/outcome/) |
| Gateway | `gateway-production-944e.up.railway.app` |
