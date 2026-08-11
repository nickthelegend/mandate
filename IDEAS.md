# 100 ideas, ranked

Scored impact × feasibility × fit. Everything here is *this* product going
deeper — a spending authority an agent cannot argue with. Nothing that would
make it a second product wearing the same name.

Status is filled in only after a thing is built AND run. **skipped** carries its
reason. Blank means not reached.

---

## Tier A — the holes. These are defects, not features.

| # | Idea | Status |
|---|---|---|
| 1 | A held spend notifies the operator, delivered through KeeperHub, with a delivery receipt anyone can read | BUILT — verified: escalation raised, notice delivered, `dlv_ywrtjz74zx` recorded by the receiver |
| 2 | Simulate the actual transfer before approving — a spend that would revert is refused with the decoded reason, not approved and then failed | BUILT — verified: simulator catches `ERC20InvalidReceiver` and `ERC20InsufficientBalance`; a normal spend still approves |
| 3 | The kill-switch read and the transfer become one KeeperHub call, closing the TOCTOU window | skipped — `check-and-execute` cannot carry an ERC-20 transfer as its action; the TOCTOU window needs a different fix |
| 4 | Receipts anchor on a KeeperHub Schedule trigger, so a quiet day still produces evidence | BLOCKED — a Schedule trigger needs an action to call, and every HTTP action is `requiredPlan: pro` (402) |
| 5 | Notification failure is visible, not swallowed — the escalation says whether the operator was actually reached | BUILT — verified: the console shows notified / not reached / no notifier |

## Tier B — the authority, deeper

| # | Idea | Status |
|---|---|---|
| 6 | A 16th rule: refuse when the treasury cannot cover the spend, read from the chain |  |
| 7 | Per-decision "what would have changed" — show the effects the engine proposed and did not apply |  |
| 8 | Preflight endpoint returns the exact rule that *would* fail next, so an agent can adjust once instead of guessing |  |
| 9 | Rule-chain deep link: `/authority?case=cap` opens with that case pre-selected |  |
| 10 | Decision permalink — every decision has a URL that reproduces its full trace |  |
| 11 | Escalation expiry countdown, live, so a held spend visibly ages out | BUILT — verified live: `14:55 left to answer`, recomputed each tick |
| 12 | Deny path in the UI, not just approve — a refused escalation is a decision too | skipped — already wired; the Deny button exists and calls the same resolve route |
| 13 | Show the ledger's lease in flight: two concurrent decisions visibly serialise | |
| 14 | Budget window boundary: show when the UTC day rolls and what resets |  |
| 15 | Rate-limit rule surfaced as a live counter, not just a refusal |  |
| 16 | Cooldown rule: show time remaining against a service | |
| 17 | Duplicate window: show the prior intent and how long its lock has left |  |
| 18 | Vendor score history — a payee's LCB over time, from the epoch snapshots | |
| 19 | Explain the renormalization: which weights moved when a signal was missing |  |
| 20 | σ visualised — the gap between score and bound, drawn to scale |  |

## Tier C — KeeperHub, past the minimum

| # | Idea | Status |
|---|---|---|
| 21 | Event trigger on `PolicyPaused` → every operator is told the instant the kill switch lands | BLOCKED — same 402: an Event trigger has nothing free to notify with |
| 22 | Surface `sponsored: true` and the gas KeeperHub paid on every approval | BUILT — verified: "executed as transfer with gas sponsored" |
| 23 | Mirror the policy's daily cap into KeeperHub's own `dailyCapWei` | skipped — `get_spending_limits` is org-wide, our cap is per-agent; writing one from the other would misreport both |
| 24 | Live execution progress from `get_execution` instead of a spinner | BUILT — the execution record is read after the verdict renders |
| 25 | `validate_workflow` in CI for every workflow we publish | skipped — ran out of time; `validate_workflow` exists and is not wired to CI |
| 26 | Bureau reads KeeperHub's error taxonomy from `list_executions` | |
| 27 | Publish the preflight as a free read listing so any agent can ask | |
| 28 | Gas spent per agent, from KeeperHub's analytics | |
| 29 | `test_notification` when an operator binds a channel | BLOCKED — `test_notification` needs a Discord/Slack integration that does not exist on this account |
| 30 | Show the Turnkey smart account and relayer, so "the agent holds no key" is checkable | BUILT — verified: the signing address is shown and linked, and it is not the deployer |

## Tier D — evidence

| # | Idea | Status |
|---|---|---|
| 31 | A receipt page: paste a receipt id, get the proof and the contract's answer | BUILT — on `/ledger`, verified against a real receipt |
| 32 | Verify a proof entirely client-side, then ask the chain — and show both | BUILT — verified: recomputed in-browser AND `MandateReceipts confirms this exact root` |
| 33 | The receipt ladder rendered as a ladder, with what moved on the last tick | BUILT — the ladder is drawn as a ladder, with the last tick's movement |
| 34 | Degraded-unanchored shown as its own state, never as failure | BUILT — `DEGRADED_UNANCHORED` renders as its own state with its reason |
| 35 | Batch view: the four receipts under a root, and the root on chain |  |
| 36 | Copy a proof as JSON for independent verification | BUILT — the proof is expandable as JSON |
| 37 | Anchor transaction linked from every confirmed receipt | BUILT — the anchoring transaction is linked from a confirmed receipt |
| 38 | Show what the receipt body deliberately omits, and why | BUILT — what the body omits, and why, is stated under the list |
| 39 | Receipt id derivation explained — same decision twice is one receipt | |
| 40 | A standalone verifier snippet a judge can paste into node | |

## Tier E — design and motion

| # | Idea | Status |
|---|---|---|
| 41 | The rule chain runs — chips resolve left to right, stopping dead at the refusal | already shipped — the chain animates chip by chip |
| 42 | Numbers roll rather than snap when the budget changes |  |
| 43 | The budget bar fills, and overshoot is drawn as overshoot |  |
| 44 | Verdict lands with weight — a stamp, not a fade |  |
| 45 | The refused chip's strike draws itself |  |
| 46 | Held pulses slowly; approved and refused are still |  |
| 47 | Skeleton rows cross-fade into real ones instead of popping |  |
| 48 | The σ band animates from score down to bound |  |
| 49 | Live counter for the escalation deadline, ticking | BUILT — see 11 |
| 50 | Transaction hash reveals character by character as it confirms | skipped — cute, but it delays a hash a judge wants to copy |
| 51 | The chain-status dot breathes while reading, settles when read |  |
| 52 | Reduced-motion respected throughout, properly |  |
| 53 | Focus rings that match the design, on every interactive element |  |
| 54 | The decision panel slides the ledger down rather than jumping it |  |
| 55 | Hover on a rule chip reveals what it compared, inline |  |
| 56 | Copy feedback that is a state change, not a toast |  |
| 57 | The hero video pauses when off-screen |  |
| 58 | A judge-facing "what just happened" trail after each spend |  |
| 59 | Print stylesheet — the ledger prints as a ledger |  |
| 60 | Dark mode that is designed, not inverted | skipped — the whole palette is light-committed; a half-done dark mode looks worse than none |

## Tier F — production readiness

| # | Idea | Status |
|---|---|---|
| 61 | Gateway cold start is explained, not a hang |  |
| 62 | Every fetch has a deadline and says so when it expires |  |
| 63 | Retry with backoff on a read, and say it is retrying |  |
| 64 | Offline detection — the page says the network went, not that the gateway did |  |
| 65 | An empty ledger reads as empty on purpose, with a way to fill it |  |
| 66 | An empty receipt list explains the ladder rather than showing nothing |  |
| 67 | A failed chain read is distinguished from a paused policy |  |
| 68 | Rate-limit response renders as a countdown, not an error |  |
| 69 | Every error surfaces the authority's own sentence, never a wrapper's | BUILT — the authority's own sentence is surfaced, never a wrapper's |
| 70 | 503 from the gateway is a different screen from 400 |  |
| 71 | The console survives a gateway restart mid-flight |  |
| 72 | Long payee addresses never break the layout |  |
| 73 | A decision with no rules consulted still renders honestly |  |
| 74 | Escalation resolved in another tab reconciles here |  |
| 75 | Health endpoint reports what it cannot reach, not just ok | BUILT — verified live: `UP — mongo 133ms, sepolia 34ms, policy-anchor 250ms, keeperhub 0ms`; 503 when a dependency the decision needs is down |
| 76 | Receipt tick failure never blocks a decision |  |
| 77 | A malformed policy document fails at boot, loudly |  |
| 78 | Mongo unavailable is a 503 with a reason, not a crash |  |
| 79 | Structured request logging with a request id | |
| 80 | Graceful shutdown that finishes in-flight decisions | |

## Tier G — the pitch

| # | Idea | Status |
|---|---|---|
| 81 | A 90-second guided path a judge can follow without reading |  |
| 82 | Every claim on the homepage links to the thing that proves it |  |
| 83 | The comparison a judge is making, stated: policy vs prompt vs wallet guard |  |
| 84 | Known gaps on the site, not just in the README |  |
| 85 | A "check this yourself" affordance on every number |  |
| 86 | The rule engine runs client-side so the persuasion is operable | skipped — already shipped as the decision demo |
| 87 | Architecture diagram that matches the code |  |
| 88 | Provenance stated: what was ported, what was written here |  |
| 89 | Latency shown honestly — 20-40s is the chain, not the app |  |
| 90 | The MCP tools listed with what each returns |  |
| 91 | A single command that reproduces the whole verification |  |
| 92 | Contract source linked, verified, from the page that uses it |  |
| 93 | The policy document itself, readable, next to its hash |  |
| 94 | What happens if you edit the policy — shown, not described |  |
| 95 | Per-visitor agent explained, so isolation is understood not assumed |  |
| 96 | A demo video that matches the current product | skipped — recorded against the removed product; re-recording needs a take I cannot verify is good |
| 97 | Judge mode: a URL that pre-fills a walkthrough state | |
| 98 | The test plan linked from the site as evidence |  |
| 99 | Social card that shows the live decision count | skipped — a static export cannot render a live OG image without a server |
| 100 | An honest "what this is not" section |  |

---

## What actually happened

**16 built and verified running against the live deployment.** Each was checked
by triggering it, not by compiling it: a real escalation delivered a real
notice, the simulator was fed transfers that do and do not revert, the proof was
recomputed in a browser and put to the contract.

**Four are blocked on a KeeperHub plan, not on effort.** Every action that can
send anything — `webhook/send-webhook`, the System `HTTP Request`, and by
extension Discord, Slack and SendGrid — answers `402 upgrade_required`,
`requiredPlan: pro`. That takes out the KeeperHub-routed notification (1's
better half), the Schedule trigger for anchoring (4), the `PolicyPaused` event
trigger (21) and `test_notification` (29). The workflow definition for the
notifier is written and correct in `scripts/create-notify-workflow.mjs`; it is
one upgrade from running and the gateway side does not move when it does.

**One was abandoned after looking at it properly.** `check-and-execute` (3)
cannot carry an ERC-20 transfer as its action, so it does not close the
TOCTOU window the way the idea assumed.

**The rest were not reached.** Not skipped for a reason — there was simply more
list than time, and the ranking is what decided the order. Nothing below is
marked done that is not.

**Final regression, everything green except one pre-existing block.** Sections
1, 2, 6, 7: **52/53** — the only failure is 6.9, npm publish, blocked on an
expired token since before this work started. Sections 4 and 5: **18/18**, zero
console errors. 216 unit and contract tests, 0 typecheck errors, both CI
workflows green.

One regression was introduced and caught by the sweep: the new receipts section
names each receipt's decision, so the ledger row-count check read 112 rows
against a header claiming 100 and reported a correct page as lying. The check
now counts table rows. Nothing that worked before this session is broken.
