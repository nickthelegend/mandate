# Test plan

Every component and every flow, with what "correct" means stated before
anything is run. This file is the checklist; `apps/web/qa.mjs`,
`apps/web/qa-live.mjs` and `apps/web/qa-infra.mjs` execute it, and a run that
does not match a line below is a FAIL regardless of how the screen looks.

Three rules apply to every item:

1. **Correct means the exact stated result**, not "the button did something".
2. **Console and network are part of the item.** Any console error, uncaught
   exception, failed request, or unexpected HTTP ≥ 400 fails it, even if the UI
   looks right.
3. **Nothing is assumed from a sibling.** Each item is executed.

Legend: **A** automated in `qa.mjs` · **L** automated in `qa-live.mjs` (spends
real testnet funds) · **I** automated in `qa-infra.mjs` (contracts, endpoints,
integrations) · **M** exercised manually in a browser.

---

## 1. Contracts on Sepolia (I)

| # | Item | Correct means |
|---|---|---|
| 1.1 | `PolicyRegistry` `0x13452fcA…` | `eth_getCode` returns non-empty bytecode |
| 1.2 | `MandateEscrow` `0x0ED9d123…` | non-empty bytecode |
| 1.3 | `USDCx` (EIP-3009) `0x0d864A62…` | non-empty bytecode |
| 1.4 | `tUSDC` `0x49C86277…` | non-empty bytecode |
| 1.5 | The enforced policy is anchored | `getPolicy(POLICY_ID)` returns `status == 1` and `isUsable == true` |
| 1.6 | The anchor matches the document on disk | registry `policyHash` == `hashCanonicalJson(policy.json.rules)` exactly |
| 1.7 | Escrow reads work | `MandateEscrow` answers a `getIntent` call without reverting |
| 1.8 | Every transaction the site displays is real | each hash resolves to a receipt with `status == 1` |
| 1.9 | The "moved nothing" claim is true | the lying-facilitator tx has **zero** ERC-20 `Transfer` logs |
| 1.10 | The "moved money" claim is true | the honest tx has a `Transfer` of exactly 1000000 base units |

## 2. Gateway endpoints (I)

| # | Item | Correct means |
|---|---|---|
| 2.1 | `GET /health` | 200, JSON with `ok: true` and the facilitator address |
| 2.2 | `GET /authority` | 200, `onChain.status == "ACTIVE"`, `vendorFloor` a number, budget fields present |
| 2.3 | `GET /authority?agent=x` | 200, `agent == "x"`, that agent's own budget |
| 2.4 | `GET /authority` bad agent id | 400, message naming the agent-id rule |
| 2.5 | `GET /authority/log` | 200, newest-first entries, each with a decision and a rule trace |
| 2.6 | `GET /authority/escalations` | 200, an array, no `approvalCodeHash` on any row |
| 2.7 | `GET /authority/score/<addr>` | 200, `lcb` ≤ `score`, 7 features, 4 observed |
| 2.8 | `GET /authority/score/<junk>` | 400, "not a 20-byte address" |
| 2.9 | `GET /audit` | 200, persisted x402 decision entries |
| 2.10 | `GET /execution/<bad>` | 400, "not an execution id" |
| 2.11 | `GET /execution/<real>` | 200, KeeperHub's own record for that execution |
| 2.12 | `GET /article` unpaid | **402** with a spec-shaped `accepts[]` challenge |
| 2.13 | `GET /authority/spend` | 405, "POST only" |
| 2.14 | `POST /authority/spend` malformed JSON | 400, "body must be JSON" |
| 2.15 | `POST` amount ≤ 0 / non-numeric / absent | 400, "amount must be a positive number" |
| 2.16 | `POST` absurd amount | 400, "amount is implausible" |
| 2.17 | `POST` bad recipient | 400, "recipient must be a 20-byte address" |
| 2.18 | `POST` non-URL endpoint | 400, "endpoint must be a plain http(s) URL" |
| 2.19 | `POST` category containing markup | 400 **and** nothing written to the public log |
| 2.20 | Validation precedes the throttle | two malformed posts back to back both answer 400, never 429 |
| 2.21 | `POST /authority/escalation/<id>/resolve` bad code | 400, "code is 24 hex characters" |
| 2.22 | …bad operator | 400, "operator must be a 20-byte address" |
| 2.23 | …bad action | 400, "action must be APPROVE or DENY" |
| 2.24 | Unknown escalation id | 200, `mandate == "IGNORED_NOT_FOUND"` |

## 3. The authority engine, end to end (L)

| # | Item | Correct means |
|---|---|---|
| 3.1 | Fresh agent | budget reads `$0.00 / $5.00` |
| 3.2 | Approved spend | `APPROVED`, budget rises by the amount, a real tx hash that resolves on chain |
| 3.3 | Per-call cap | `$5,000` → `BLOCKED_PER_CALL_CAP`, rule `perCall.cap`, observed 5000 vs limit 1, **no** tx |
| 3.4 | Category | GPU → `BLOCKED_CATEGORY`, rule `category.allow`, no tx, budget unchanged |
| 3.5 | Duplicate | the same purchase twice → `BLOCKED_DUPLICATE` naming the prior intent, budget unchanged |
| 3.6 | Rule chain short-circuits | rules after the refusal render as never-consulted, and the count is correct |
| 3.7 | Agent isolation | two agents each get `$5` and can both make the identical purchase |
| 3.8 | Budget persists | the figure survives a reload and a second browser context |
| 3.9 | Vendor floor consulted | the decision carries a score with `lcb`, σ, band, and 7 features |
| 3.10 | Unknown payee escalates | `ESCALATED_VENDOR_RISK`, **nothing charged**, **no** tx, held row appears |
| 3.11 | Release | bound operator + code → money moves, budget charged **at release** |
| 3.12 | Unbound operator | `IGNORED_UNBOUND`, escalation stays `PENDING` |
| 3.13 | Wrong code | `IGNORED_BAD_CODE`, escalation stays `PENDING` |
| 3.14 | Replay | the same code twice → `IGNORED_ALREADY_RESOLVED` |
| 3.15 | Kill switch | policy paused on chain → next spend fails `policy.active`, rule 1 of 15, nothing else consulted |
| 3.16 | Resume | policy resumes and spending works again |

## 4. Pages (A unless noted)

| # | Item | Correct means |
|---|---|---|
| 4.1 | `/` | headline renders, hero video **plays** (`readyState` 4, not paused), live stats read from chain |
| 4.2 | `/authority` | chain status, budget, five spend cases, decision log |
| 4.3 | `/demo` | both facilitator buttons; each run is a real tx (L) |
| 4.4 | `/agent` | one action; a full cycle completes with a claim and a settlement (L) |
| 4.5 | `/verify` | form + two samples, verdict computed in-browser |
| 4.6 | `/claim` | with no wallet the connect button is disabled **and** says why |
| 4.7 | `/ledger` | rows from the gateway's persisted record, not placeholders |
| 4.8 | `/explorer` | intents read from chain |
| 4.9 | `/inspect` | a real execution id returns KeeperHub's record |
| 4.10 | `/x402` | the write-up renders |
| 4.11 | `/docs` | quickstart, six tools, config table |
| 4.12 | unknown URL | the branded 404 with ≥ 4 links back |
| 4.13 | Every page | a real `<title>` and a meta description |
| 4.14 | Every page | no horizontal overflow at 375 / 768 / 1440 |
| 4.15 | Every page | no stray `console.log` |

## 5. Form and interaction edges (A)

| # | Item | Correct means |
|---|---|---|
| 5.1 | `/verify` malformed hash | inline "0x followed by 64 hex characters", no request sent |
| 5.2 | `/verify` fractional amount | inline "whole digits only" |
| 5.3 | `/verify` bad address | inline "0x followed by 40 hex characters" |
| 5.4 | `/verify` unknown-but-valid hash | a verdict or a readable error, never a raw exception |
| 5.5 | `/verify` double submit | exactly one verdict panel |
| 5.6 | `/verify` deep link | the hash, token, recipient and amount all prefill |
| 5.7 | `/inspect` malformed id | refused client-side with a readable message, no request |
| 5.8 | `/inspect` empty id | no request fired |
| 5.9 | Double-click any spend | one decision, budget moves at most once |
| 5.10 | Refresh mid-transaction | the page recovers and the budget never goes backwards |
| 5.11 | Back then forward | the page still works |
| 5.12 | Click Release the instant it appears | the request is sent (not silently dropped) |
| 5.13 | Held spend from another session | explains why it cannot be released; no dead button |
| 5.14 | `/demo` and `/agent` pacing | a live countdown, button disabled until it reaches zero |

## 6. External integrations (I)

| # | Item | Correct means |
|---|---|---|
| 6.1 | Sepolia RPC | a block number and a receipt read succeed |
| 6.2 | MongoDB | the ledger, decision log and escalation collections read back |
| 6.3 | KeeperHub execute API | an execution status query returns a real record |
| 6.4 | KeeperHub MCP | initialize → 44 tools |
| 6.5 | KeeperHub marketplace | discovery returns listings, ≥ 1 paid |
| 6.6 | Our marketplace listing | `mandate-escrow-intent-status` live at `$0.02/call` |
| 6.7 | `mandate-mcp` over stdio | initialize → exactly the 6 tools, read-only ones need no credential |
| 6.8 | npm | `mandate-sdk` and `mandate-policy` install clean and export what the README claims |
| 6.9 | x402 challenge binding | an honest challenge binds; a swapped payee or price is caught |

## 7. Repository hygiene (I)

| # | Item | Correct means |
|---|---|---|
| 7.1 | No mocks or stubs in shipped code | grep finds only tests, HTML `placeholder` attrs, and comments about *past* bugs |
| 7.2 | Unit tests | 185 pass, 0 fail |
| 7.3 | Typecheck | 0 errors across every workspace |
| 7.4 | CI | both workflows green on the deployed commit |
| 7.5 | No secrets committed | the staged-diff scan finds none |

---

## Explicitly untestable here

Recorded rather than marked PASS.

- **MPP (Tempo).** The KeeperHub wallet holds no Tempo balance, so an MPP
  payment cannot settle. Funding it is real money. The README documents it as
  the one unused surface of the six.
- **Buying a paid marketplace listing.** Settles in Base **mainnet** USDC.
  Discovery, challenge parsing, binding and signature are all verified; the
  purchase is not.
- **A user rejecting a wallet prompt.** `/claim`'s signing path is proven with a
  real injected EIP-1193 signer, but a human clicking "reject" in MetaMask needs
  the actual extension.
