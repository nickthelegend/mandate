# A complete authority, in one file

```bash
npm i mandate-policy mandate-sdk mongodb ethers

MONGODB_URI=… KEEPERHUB_API_KEY=… POLICY_ID=… \
  node authority.mjs 0.40 market-data
```

Everything imported here is on npm. If this file runs, the packages compose —
if it did not, the SDK would be a private detail of one gateway wearing a
public name.

Refused:

```
policy  v3 ACTIVE, hash 0x81575c6226a6…
budget  $0.00 spent today
verdict BLOCKED_PER_CALL_CAP at perCall.cap (11 of 15 consulted)
        per-call cap exceeded: 5000.00 > 1.00 USDT

nothing moved, and the refusal is on the record.
```

Approved:

```
verdict APPROVED (all 15 passed)

executed via KeeperHub
  execution 5trgyh39gbulk6px9b491
  tx        0x9b4e25fab7d7ec8392acf31ae377fa5677d37a4380249cad2f03457e2b6e4721
  budget    $0.00 → $0.40

The agent held no key. KeeperHub signed it.
```

That transaction is real: status 1, one ERC-20 transfer of 0.40 tUSDC, sent by
KeeperHub's relayer `0xA17cb6ad…` and **not** by the deployer key sitting in the
`.env` this script read.

## Two things that cost a run while writing it

Kept here because they are the two places the engine's shape is not obvious,
and the error it gives you is not the error you expect.

- **`token` is the ERC-20 address, not the symbol.** The policy document's
  `budgets.token` is a display label; the intent's `token` is a contract.
  Passing `"USDT"` gets `REJECTED_MALFORMED: token is not a 20-byte hex
  address`, which reads like a bug rather than a field you filled in wrong.
- **A missing vendor score escalates.** With no reputation source the chain
  stops at rule 8 with *"vendor score unavailable — escalated per policy"*,
  because the document sets `onScoreUnavailable: ESCALATE`. That is correct —
  unknown is a question for a person, not an approval — and it is surprising the
  first time. The engine takes the score as an input; where it comes from is
  yours to choose.
