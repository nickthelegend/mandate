# 60-second demo

One idea, shown twice. **A payment rail that only reads a status byte can be
told it was paid when it was not.** Everything below is live on Sepolia.

Have two terminals open and the site loaded before you start recording.

---

## Before you hit record

```bash
cd outcome && npm install
cp .env.example .env        # SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, KEEPERHUB_API_KEY
npm run build
npm start --prefix apps/gateway      # leave this running in terminal 2
```

Open `https://nickthelegend.github.io/outcome/` in a browser tab.

---

## 0:00 — 0:12 · The claim

> "x402 pays per request. When the facilitator says the payment succeeded, the
> server believes it. Nobody checks the transaction."

Show the landing page. Point at the live counters — they are read from Sepolia
in the browser, not served by a backend.

## 0:12 — 0:30 · An honest payment

Terminal 1:

```bash
npm run pay --prefix apps/gateway
```

> "A real x402 handshake. The client gets a 402, signs an EIP-3009
> authorisation, and never sends a transaction itself."

Point at the last three lines: **HTTP 200**, the Etherscan link, and
`observed 1000000`. Say:

> "The article came back — because the receipt actually shows the money
> arriving."

## 0:30 — 0:48 · The same flow, paying nobody

```bash
npm run pay:lying --prefix apps/gateway
```

> "Identical protocol. The facilitator submits an `approve` instead — it mines,
> it emits a log, it moves nothing — and reports `success: true`. That is a
> legal x402 settlement response."

Point at the output:

```
facilitator claimed success : true
actually observed           : 0
reason : no Transfer of 0x0d864A62… to 0x…dEaD in 1 log(s)
```

> "**HTTP 402. The article is withheld.** A stock x402 server would have handed
> it over for free."

## 0:48 — 0:60 · It's a package, not a demo

```bash
npx -y outcome-mcp
```

> "It's on npm. `outcome-sdk` and `outcome-mcp` — six tools over stdio, no
> configuration, and every read-only tool works without a credential. Any agent
> can install this and stop taking payment on trust."

End on the `/x402` page showing both transactions side by side.

---

## If you have another 30 seconds

**The escrow loop, unattended:**

```bash
node --experimental-strip-types packages/sdk/examples/run-agent.ts
```

A payer posts a job and walks away. The agent finds it, does the work on chain,
and hands the verifier a transaction hash — never a verdict. It gets paid only
because the transfer was proven.

**Verify anything, in the browser:** open `/verify`, click *"Mined, moved
nothing"*, hit **Read the receipt**. No backend answers that question.

---

## Numbers, if asked

| | |
|---|---|
| Tests | 81 — 21 contract, 54 SDK, 6 MCP over stdio |
| Packages | [`outcome-sdk`](https://npmjs.com/package/outcome-sdk), [`outcome-mcp`](https://npmjs.com/package/outcome-mcp) |
| Escrow | [`0x0ED9d123…dC3B`](https://sepolia.etherscan.io/address/0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B) |
| USDCx (EIP-3009) | [`0x0d864A62…CF13`](https://sepolia.etherscan.io/address/0x0d864A625c280F7f9B9AD024d12F94f5D6DCCF13) |
| Console | [nickthelegend.github.io/outcome](https://nickthelegend.github.io/outcome/) |

**"Why no AI judge?"** — Every comparable project (Clawback, internet-court,
x402r) resolves disputes with an LLM. When the chain already knows whether value
moved, adjudication is a lookup, not an opinion. There is no model in the money
path.

**"Isn't the lying facilitator contrived?"** — It submits an `approve`. That is
the cheapest possible thing a real facilitator could do to collect fees without
settling, and the protocol cannot tell the difference. The point is not that
facilitators are malicious; it is that x402 has no way to find out.
