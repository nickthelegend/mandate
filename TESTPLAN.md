# Test plan — Mandate

Every component and every flow, with what "correct" means written down before
anything is run. This file is the checklist; `apps/web/qa-plan.mjs` executes it
and prints one PASS/FAIL line per item id. A run that does not match a line
below is a FAIL regardless of how the screen looks.

Three rules apply to every item:

1. **Correct means the exact stated result**, not "the button did something".
2. **Console and network are part of the item.** Any console error, uncaught
   exception, failed request or unexpected HTTP ≥ 400 fails it, even if the UI
   looks right.
3. **Nothing is assumed from a sibling.** Every item is executed.

An earlier version of this file described the escrow/x402 product that was
removed. It is rewritten here for what actually exists: one authority, six
pages, eleven endpoints, three contracts, six packages.

---

## 1. Contracts on Sepolia

| id | Item | Correct means |
|---|---|---|
| 1.1 | `PolicyRegistry` `0x13452fcA…` | `eth_getCode` returns non-empty bytecode |
| 1.2 | `MandateReceipts` `0x64AE971F…` | non-empty bytecode |
| 1.3 | `tUSDC` `0x49C86277…` | non-empty bytecode |
| 1.4 | The enforced policy is anchored and live | `getPolicy(POLICY_ID).status == 1` and `isUsable == true` |
| 1.5 | The anchor matches the document on disk | registry `policyHash` == `hashCanonicalJson(policy.json.rules)`, byte for byte |
| 1.6 | Receipts contract holds real anchors | `batchCount() >= 1` |
| 1.7 | A displayed receipt root is on chain | `isAnchored(batchId, root)` returns true for a CONFIRMED batch |
| 1.8 | Every transaction the site shows is real | each hash resolves to a receipt with `status == 1` |
| 1.9 | An approved spend really moved tokens | the spend tx has an ERC-20 `Transfer` of the exact amount to the payee |
| 1.10 | Writes come from KeeperHub, not a local key | the anchor tx `from` is KeeperHub's relayer, not the deployer |

## 2. Gateway endpoints

| id | Item | Correct means |
|---|---|---|
| 2.1 | `GET /health` | 200, `ok: true`, the live `policyId`, `keeperhub: true` |
| 2.2 | `GET /authority` | 200, `onChain.status == "ACTIVE"`, numeric `vendorFloor`, budget and `totals` present |
| 2.3 | `GET /authority?agent=<new>` | 200, echoes the agent, `spentToday == 0` — its own partition |
| 2.4 | `GET /authority?agent=<bad>` | 400 naming the agent-id rule |
| 2.5 | `GET /authority/log` | 200, newest-first, every entry carries a decision and a rule trace |
| 2.6 | `GET /authority/score/<addr>` | 200, `lcb <= score`, exactly 7 features, exactly 4 observed |
| 2.7 | `GET /authority/score/<junk>` | 400, "not a 20-byte address" |
| 2.8 | `GET /authority/escalations` | 200, an array, **no** `approvalCodeHash` on any row |
| 2.9 | `GET /authority/receipts` | 200, entries with a status on the ladder, plus what the tick moved |
| 2.10 | `GET /authority/receipt/<id>` | 200 with a merkle proof; `anchored` true only when CONFIRMED |
| 2.11 | `GET /authority/receipt/<junk>` | 400, "not a receipt id" |
| 2.12 | `GET /execution/<real>` | 200, KeeperHub's own record, `status: completed` |
| 2.13 | `GET /execution/<junk>` | 400, "not an execution id" |
| 2.14 | `GET /authority/spend` | 405, "POST only" |
| 2.15 | `POST` malformed JSON | 400, "body must be JSON" |
| 2.16 | `POST` amount ≤ 0 / non-numeric / absent | 400, "amount must be a positive number" |
| 2.17 | `POST` absurd amount | 400, "amount is implausible" |
| 2.18 | `POST` bad recipient | 400, "recipient must be a 20-byte address" |
| 2.19 | `POST` non-URL endpoint | 400, "endpoint must be a plain http(s) URL" |
| 2.20 | `POST` category containing markup | 400 **and** nothing written to the public log |
| 2.21 | Validation precedes the throttle | two malformed posts back to back both answer 400, never 429 |
| 2.22 | Resolve with a bad code | 400, "code is 24 hex characters" |
| 2.23 | Resolve with a bad operator | 400, "operator must be a 20-byte address" |
| 2.24 | Resolve with a bad action | 400, "action must be APPROVE or DENY" |
| 2.25 | Resolve an unknown escalation | 200, `outcome == "IGNORED_NOT_FOUND"` |
| 2.26 | A route that does not exist | 404 naming the path |
| 2.27 | The removed product's routes are gone | `/demo`, `/agent`, `/article`, `/audit` all 404 |
| 2.28 | `GET /health` names each dependency | four checks — mongo, sepolia, policy-anchor, keeperhub — each with `up` and a timing; aggregate `UP` |
| 2.29 | `POST /hook/operator` | 200 with a delivery id, and the body appears at `/authority/deliveries` |
| 2.30 | `POST /hook/operator` malformed | 400, "body must be JSON" |
| 2.31 | `GET /hook/operator` | 405, "POST only" |
| 2.32 | `GET /authority/deliveries` | 200, names the destination notices are sent to |

## 3. The authority, end to end

| id | Item | Correct means |
|---|---|---|
| 3.1 | Preflight refuses | `BLOCKED_*` with the failing rule named, and the ledger is **unchanged** |
| 3.2 | Preflight approves | `APPROVED`, `spentAfter == spentBefore`, **no** transaction |
| 3.3 | Preflight agrees with the spend | the same request preflighted and then spent gives the same decision |
| 3.4 | Approved spend | `APPROVED`, budget rises by the amount, a real tx hash that resolves on chain |
| 3.5 | Per-call cap | $5,000 → `BLOCKED_PER_CALL_CAP`, observed 5000 vs limit 1, no tx |
| 3.6 | Category | compute → `BLOCKED_CATEGORY`, no tx, budget unchanged |
| 3.7 | Duplicate | the same purchase twice → `BLOCKED_DUPLICATE` naming the prior intent |
| 3.8 | Rule chain short-circuits | rules after the refusal are never-consulted, and the count matches |
| 3.9 | Agent isolation | two agents each get $5 and both may make the identical purchase |
| 3.10 | Budget persists | the figure survives a reload and a second browser context |
| 3.11 | Vendor floor is consulted | the decision carries `lcb`, σ, band and 7 features |
| 3.12 | Unknown payee escalates | `ESCALATED_VENDOR_RISK`, nothing charged, no tx, held row appears |
| 3.13 | Release | bound operator + code → money moves, budget charged **at release** |
| 3.14 | Unbound operator | `IGNORED_UNBOUND`, escalation stays PENDING |
| 3.15 | Wrong code | `IGNORED_BAD_CODE`, escalation stays PENDING |
| 3.16 | Replay | the same code twice → `IGNORED_ALREADY_RESOLVED` |
| 3.17 | Kill switch | paused on chain → next spend fails `policy.active`, 1 of 15 rules consulted |
| 3.18 | Resume | spending works again afterwards |
| 3.19 | A decision produces a receipt | a spend appears in `/authority/receipts` |
| 3.20 | Receipts climb the ladder | QUEUED → BATCHED/SUBMITTED → CONFIRMED |
| 3.21 | A receipt proof verifies independently | recomputes the root **and** the contract agrees |
| 3.22 | A held spend notifies the operator | the escalation carries `notified` with a delivery id, and the notice is in `/authority/deliveries` |
| 3.23 | The notice never blocks the decision | the verdict returns before delivery; a held spend with an unreachable operator still holds correctly |
| 3.24 | Simulation runs on the approval path only | an approved spend carries 15 rules; a refusal carries no `execution.simulated` |
| 3.25 | The simulator would catch a revert | a transfer to the zero address returns `ERC20InvalidReceiver`; over-balance returns `ERC20InsufficientBalance` |

## 4. Pages

| id | Item | Correct means |
|---|---|---|
| 4.1 | `/` | headline renders, hero video **plays** (readyState ≥ 3, not paused, no third-party source) |
| 4.2 | `/` totals | shows the authority's system-wide counts, not zeros |
| 4.3 | `/authority` | chain status, budget, five spend cases, decision log |
| 4.4 | `/ledger` | rows from the authority's decision record |
| 4.5 | `/inspect` | a real execution id returns KeeperHub's record |
| 4.6 | `/docs` | quickstart, the seven tools, config |
| 4.7 | unknown URL | the branded 404 with ≥ 4 links back |
| 4.8 | Every page | a real `<title>` and a meta description |
| 4.9 | Every page | no horizontal overflow at 375 / 768 / 1440 |
| 4.10 | Every page | no stray `console.log` |
| 4.11 | Every internal link resolves | no `href` points at a deleted route |
| 4.12 | `/ledger` receipts | the ladder renders per receipt, with what the last tick moved |
| 4.13 | A receipt proof, checked in the browser | recomputed locally **and** `MandateReceipts confirms this exact root` |
| 4.14 | The proof is exportable | leaf, proof, root and batchId available as JSON |
| 4.15 | An approved spend shows who signed it | "gas sponsored", the signing address linked, and it is not the deployer |
| 4.16 | A held spend counts down | `M:SS left to answer`, decreasing |
| 4.17 | A held spend says whether anyone was told | notified / not reached / no notifier — never silence |

## 5. Interaction edges

| id | Item | Correct means |
|---|---|---|
| 5.1 | `/inspect` malformed id | refused client-side with a readable message, no request |
| 5.2 | `/inspect` empty id | no request fired |
| 5.3 | Double-click a spend | one decision; a refusal never moves the budget |
| 5.4 | Refresh mid-transaction | the page recovers, the budget never goes backwards |
| 5.5 | Back then forward | the page still works |
| 5.6 | Click Release the instant it appears | the request is sent, not silently dropped |
| 5.7 | Held spend from another session | explains why it cannot be released; no dead button |
| 5.8 | Checking a proof twice | the second check re-runs and agrees; no stale panel from the first |
| 5.9 | The countdown across a reload | continues from the real deadline, not from where it was |

## 6. External integrations

| id | Item | Correct means |
|---|---|---|
| 6.1 | Sepolia RPC | a block number and a receipt read succeed |
| 6.2 | MongoDB | ledger, decisions, escalations and receipts all read back |
| 6.3 | KeeperHub execute API | an execution status query returns a real record |
| 6.4 | KeeperHub MCP | initialize → 40+ tools |
| 6.5 | KeeperHub marketplace | discovery returns listings, ≥ 1 paid |
| 6.6 | Our marketplace listing | `outcome-escrow-intent-status` live at $0.02/call |
| 6.7 | `mandate-mcp` over stdio | initialize → exactly the 7 tools |
| 6.8 | An MCP tool answers for real | `mandate_can_spend` returns a verdict from the live authority |
| 6.9 | npm | `mandate-*` names resolve, or are recorded as not yet published |
| 6.10 | x402 challenge binding | honest binds; swapped payee and raised price both caught |

## 7. Repository hygiene

| id | Item | Correct means |
|---|---|---|
| 7.1 | No mocks or stubs in shipped code | grep finds only tests, HTML `placeholder`, and comments about *past* bugs |
| 7.2 | No references to the removed product | no `escrow`, `facilitator` or deleted route in shipped source |
| 7.3 | Unit tests | all pass, 0 fail |
| 7.4 | Typecheck | 0 errors across every workspace |
| 7.5 | CI | both workflows green on the head commit |
| 7.6 | No secrets in tracked files | the scan finds none |

---

## Results — 2026-08-11

Executed against the live deployment, not a local build.

| Section | Runner | Result |
|---|---|---|
| 1. Contracts | `node apps/web/qa-infra.mjs` | 10 / 10 |
| 2. Endpoints | `node apps/web/qa-infra.mjs` | 27 / 27 |
| 3. The authority | `node apps/web/qa-live.mjs` | 21 / 21 |
| 4. Pages | `node apps/web/qa.mjs` | 11 / 11 |
| 5. Interaction edges | `node apps/web/qa.mjs` | 7 / 7 |
| 6. Integrations | `node apps/web/qa-infra.mjs` | 9 / 10 |
| 7. Hygiene | `node apps/web/qa-infra.mjs` | 6 / 6 |
| | | **91 / 92** |

Zero console errors, zero uncaught exceptions, zero failed requests and no
unexpected HTTP ≥ 400 across every page in sections 4 and 5. 216 unit and
contract tests pass, 0 fail. 0 typecheck errors. Both CI workflows green on the
head commit. No mock, stub or fixture stands in for anything on any of these
paths: every transaction is on Sepolia, every budget figure comes out of Mongo,
every KeeperHub call is a real API call.

**Open: 6.9.** `mandate-sdk`, `mandate-policy` and `mandate-mcp` are built,
packable and tested, but not published — the stored npm token answers 401, and
re-authenticating is not something this side can do. Until they are published,
`npm i mandate-sdk` in the docs is a promise the registry does not keep.

### What the first run caught

The plan was written before it was run, and the first pass was 47/53 with six
genuine defects behind it — recorded here because a plan that only ever passes
is not evidence that it was executed.

- CI had been red on every push: `contracts/test` still exercised
  `OutcomeEscrow` and `USDCx`, both deleted, and the entry-point guard still
  asserted a `./react` build that no longer exists.
- CI ran two of six package suites. The rule engine, the bureau, the escalation
  state machine and the receipt tree — 112 tests — were never run on a push.
- `mandate-mcp` shipped with no tests at all.
- `/ledger` showed every visitor an empty table: the public log defaulted to the
  `shared` partition while every real decision is written per agent.
- The ledger rendered proven / not proven / awaiting, and `/inspect` invited a
  sceptic to "check this one yourself" through a link to a deleted route.
- The npm descriptions, both package READMEs and the marketplace listing all
  still sold the escrow product; the listing was public and priced, and its
  workflow errored on an unresolved input reference.

## Explicitly untestable here

Recorded rather than marked PASS.

- **MPP (Tempo).** The KeeperHub wallet holds no Tempo balance, so an MPP
  payment cannot settle. Funding it is real money.
- **Buying a paid marketplace listing.** Settles in Base **mainnet** USDC.
  Discovery, challenge parsing, binding and signature are verified; the
  purchase is not.
- **A user rejecting a real wallet prompt.** Nothing on this site asks a
  visitor to sign; the authority holds no key of theirs. There is no flow to
  reject.
