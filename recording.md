# recording.md — the take

One continuous run through `/authority`, then the evidence. No cuts planned;
the driver holds each beat for its own narration line plus a breath.

**Blockchain: yes.** Sepolia. Two beats sign a real transaction through
KeeperHub and must hold a "Signing Transaction" overlay until the chain
confirms — flagged below.

**Wallet note.** No browser wallet is involved and none should be injected.
The whole argument is that *the agent holds no key* — KeeperHub's relayer
signs, server-side, and the site never asks anyone to connect anything. So
there is no extension to auto-approve and no key to inject. The "signing"
overlay covers the ~20–40s while KeeperHub's transaction confirms on Sepolia,
which is a real wait for a real signature, just not one made in the browser.

The deployer key in `.env` is Sepolia-only and is **not** used by the demo path.

---

## Beats

| id | beat | signing | notes |
|---|---|---|---|
| `b01-open` | Land on `/`, headline and live totals | | totals must be non-zero |
| `b02-authority` | Open `/authority`; `ACTIVE ON CHAIN`, `$0.00 / $5.00` | | fresh agent, so budget starts at zero |
| `b03-approve` | Press **Buy market data** → `APPROVED`, real tx | **YES** | hold overlay until receipt confirms |
| `b04-signer` | Show "executed as transfer with gas sponsored, signed by 0xA17c…" | | the agent-holds-no-key proof |
| `b05-cap` | Press **Spend $5,000** → `BLOCKED_PER_CALL_CAP` | | chain stops at 11/15, caption agrees |
| `b06-duplicate` | Press **Buy the same thing again** → `BLOCKED_DUPLICATE` | | budget must not move |
| `b07-escalate` | Press **Pay someone new** → `ESCALATED_VENDOR_RISK` | | σ bar: score 38.5 clears, bound 17.2 does not |
| `b08-release` | Press **Release it** → money moves, budget charged | **YES** | charged at release, not at hold |
| `b09-reload` | Press **Reload the page state** | | the spend is still gone — it is in a database |
| `b10-ledger` | Open `/ledger`, click a refused decision | | full trace, "the remaining N were never consulted" |
| `b11-proof` | Press **Check the proof** | | recomputed in-browser AND the contract agrees |
| `b12-verify` | Terminal: `node scripts/verify-a-receipt.mjs` | | VERIFIED, using none of our code |

Estimated ≈2:45. The narration clock decides the real length.

## Pre-flight

- Clear `localStorage` before driving so `b02` starts at `$0.00`. The agent id
  lives there and a warm one starts mid-budget.
- Wake the gateway first. Railway sleeps it; a cold start would put
  `LAST KNOWN — NOT CONFIRMED` on screen during `b02` — correct behaviour, but
  not the take we want.
- Confirm today's budget has headroom. The policy allows $5/day across all
  agents and the demo spends $0.60; a day already drained would make `b03`
  refuse for the wrong reason.
- Count console errors before starting and assert the count does not grow,
  rather than asserting zero — the page may already carry noise from a prior
  navigation.
- Detect completion by real state: a verdict element appearing, the budget
  figure changing, the held row clearing. Never by a spinner disappearing.
- Record 2s first, pull a frame, confirm it is the app and not a grey window.

## The one thing to get right

`b07` into `b08`. Every other project has approve/refuse; the third answer is
the part nobody else shows. Hold on the σ bar long enough for a viewer to read
that the score clears the floor and the bound does not — that single frame is
the technical argument.
