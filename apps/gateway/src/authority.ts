/**
 * The spending authority, running live.
 *
 * Everything else in this repo could judge a spend. Nothing enforced one.
 * `evaluateIntent` is pure and takes the ledger as an argument, the SDK's
 * `executeIfAuthorised` takes a decision the caller computed, and the browser
 * demo hands the engine a hand-built empty ledger. Each of those is correct in
 * isolation and none of them is an authority, because in every case the state
 * that decides -- how much has already been spent today -- is supplied by
 * whoever is asking permission.
 *
 * This closes it. One entry point, and the caller supplies none of the things
 * that decide:
 *
 *   1. **The policy comes from the chain.** The document is read from disk,
 *      hashed, and checked against PolicyRegistry on Sepolia. A document edited
 *      after anchoring hashes differently and is refused. A policy paused on
 *      chain is refused. The agent does not get to name its own limits.
 *
 *   2. **The ledger comes from Mongo.** Spend accumulates across requests,
 *      across restarts, and across replicas. This is what makes the daily
 *      budget a budget rather than a per-process suggestion.
 *
 *   3. **The decision comes from the engine.** All fifteen rules, in order,
 *      short-circuiting at the first refusal.
 *
 *   4. **The money moves through KeeperHub**, which holds the key. An agent
 *      refused here has nothing to route around the refusal with.
 *
 * ORDER OF WRITES, AND WHY IT IS THIS WAY
 *
 * The budget is charged BEFORE the transfer is executed, not after. Both orders
 * lose something if the process dies mid-request, and they do not lose the same
 * thing: charge-then-execute can leave budget consumed by a spend that never
 * happened, while execute-then-charge can leave money moved that no budget ever
 * counted. The first over-refuses, the second over-spends. An authority whose
 * failure mode is "refused something it could have allowed" is doing its job
 * badly; one whose failure mode is "allowed something it should have refused"
 * is not doing its job at all.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { JsonRpcProvider } from "ethers";

import {
  assertAnchored,
  statusFromAnchor,
  PolicyAnchorMismatch,
  PolicyNotUsable,
  executeIfAuthorised,
  type KeeperHubClient,
} from "outcome-sdk/node";
import {
  mongoLedger,
  toRuleTrace,
  type SpendLedger,
  type DecisionRecord,
  type RuleTrace,
} from "outcome-sdk/node";
import { proposeDecision, ledgerPartitionKey } from "outcome-policy";
import { hashCanonicalJson } from "outcome-policy/canon";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Sepolia PolicyRegistry. The anchor every decision here is checked against. */
export const REGISTRY = process.env.POLICY_REGISTRY ?? "0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304";
/** The on-chain policy id this gateway enforces. Set once the document is anchored. */
export const POLICY_ID = process.env.POLICY_ID ?? "";
/** tUSDC on Sepolia -- what an approved spend actually moves. */
const TOKEN = process.env.OUTCOME_TOKEN ?? "0x49C86277a91002c4943837bf20F6ED41976Db09F";
const CHAIN_ID = 11155111;

/** The owner wallet the policy is registered to, and the intent's declared owner. */
const OWNER = process.env.AUTHORITY_OWNER ?? "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67";

type PolicyDoc = {
  id: string;
  version: number;
  status: string;
  rules: Record<string, unknown>;
};

/**
 * The policy document, read from disk once.
 *
 * Read at startup rather than per request so that a decision cannot be judged
 * against a document that changed halfway through a demo -- and so the hash
 * check at request time is checking the same bytes every request used.
 */
export const POLICY_DOC: PolicyDoc = (() => {
  const raw = JSON.parse(readFileSync(join(HERE, "..", "policy.json"), "utf8"));
  delete raw._comment;
  return raw as PolicyDoc;
})();

/**
 * The anchored hash: the canonical hash of `rules` alone.
 *
 * `rules` and not the whole document, because the id is assigned by the chain
 * at registration and the status is the chain's to decide -- committing to
 * either would mean the document could never hash to what it anchored.
 */
export const POLICY_HASH = hashCanonicalJson(POLICY_DOC.rules);

const b32 = (x: string) => `0x${x.repeat(32)}` as `0x${string}`;

export type SpendRequest = {
  amount: number;
  category: string;
  endpoint: string;
  recipient: string;
  /** Distinguishes otherwise identical intents, so a second click is not a duplicate. */
  nonce: number;
};

export type AuthorityOutcome = {
  decision: string;
  approved: boolean;
  failedRule: string | null;
  reason: string;
  intentHash: string;
  policyId: string;
  policyVersion: number;
  /**
   * Every rule, in engine order, with its verdict and whatever detail the rule
   * itself recorded. `observed` against `limit` is what lets a reader see *how
   * far over* a refused spend was, rather than only that it was refused.
   */
  rules: RuleTrace[];
  /** What the ledger held when this was judged, and what it holds now. */
  budget: { limit: number; spentBefore: number; spentAfter: number; remaining: number };
  callsInLastHour: number;
  anchor: { registry: string; policyHash: string; onChainStatus: string; usable: boolean };
  executionId?: string;
  transactionHash?: string;
  executionError?: string;
};

/**
 * Build the engine's intent from a spend request.
 *
 * `taskHash` and `paramsHash` are derived from the request, not fixed.
 *
 * That is load-bearing. The policy's duplicate tuple is
 * `taskHash + endpoint + paramsHash`, so whatever those hashes commit to is
 * the engine's definition of "the same piece of work". Constants collapse every
 * request into one task, and the second spend of the day -- for a different
 * amount, to a different payee -- comes back BLOCKED_DUPLICATE. Random values
 * go wrong in the more dangerous direction: every request becomes unique and
 * the duplicate rule, one of the fifteen, silently never fires again.
 *
 * So the task is what actually distinguishes the work: what is being bought,
 * from where, and for whom. Ask for the identical thing twice inside the TTL
 * and it is a duplicate, which is exactly what the rule is for. Ask for
 * something different and it is not.
 *
 * The amount is deliberately NOT in the task hash. Paying twice for the same
 * work at a different price is still paying twice for the same work.
 */
function taskHashOf(req: SpendRequest): `0x${string}` {
  return hashCanonicalJson({
    endpoint: req.endpoint,
    category: req.category,
    recipient: req.recipient.toLowerCase(),
  });
}

function toIntent(req: SpendRequest) {
  return {
    owner: OWNER as `0x${string}`,
    buyerAgentId: 1n,
    workerAgentId: 0n,
    token: TOKEN as `0x${string}`,
    // The per-call ceiling travels with the amount: the bound rule runs ahead of
    // the cap, and a fixed ceiling would refuse large spends on the wrong rule.
    maxAmount: BigInt(Math.round(req.amount * 1_000_000)),
    taskHash: taskHashOf(req),
    acceptanceHash: b32("22"),
    schemaHash: b32("33"),
    policyHash: POLICY_HASH,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    nonce: BigInt(req.nonce),
    endpoint: req.endpoint,
    paramsHash: hashCanonicalJson({ amount: req.amount }),
    recipientAddress: req.recipient as `0x${string}`,
    category: req.category,
    amount: req.amount,
  };
}

export type Authority = {
  ledger: SpendLedger;
  partitionKey: string;
  decide(req: SpendRequest): Promise<AuthorityOutcome>;
  history(limit: number): Promise<DecisionRecord[]>;
  state(): Promise<{
    policyId: string;
    policyHash: string;
    rules: Record<string, unknown>;
    onChain: { status: string; usable: boolean; version: number; expiry: string } | { error: string };
    spentToday: number;
    remaining: number;
    callsInLastHour: number;
    decisions: { total: number; approved: number; refused: number };
  }>;
};

export async function createAuthority(args: {
  provider: JsonRpcProvider;
  kh: KeeperHubClient | null;
  mongoUri: string;
  mongoDb: string;
}): Promise<Authority> {
  const ledger = await mongoLedger({ uri: args.mongoUri, db: args.mongoDb });
  const policyId = POLICY_ID;
  const partitionKey = ledgerPartitionKey(policyId || null);
  const dailyLimit = Number((POLICY_DOC.rules as { budgets: { daily: number } }).budgets.daily);

  async function readAnchor() {
    return assertAnchored(args.provider, REGISTRY, policyId, POLICY_HASH);
  }

  return {
    ledger,
    partitionKey,

    async decide(req) {
      /*
       * The chain read happens before the lease, not inside it. It is a network
       * round trip to a public RPC and holding a cross-process lock across one
       * would serialize every agent behind the slowest node -- and the answer
       * it produces (is this policy still live?) cannot be invalidated by
       * another request in the meantime, only by a transaction.
       */
      let anchor: Awaited<ReturnType<typeof readAnchor>> | null = null;
      let anchorError: string | null = null;
      try {
        anchor = await readAnchor();
      } catch (e) {
        if (e instanceof PolicyAnchorMismatch || e instanceof PolicyNotUsable) {
          anchorError = e.message;
        } else {
          throw e;
        }
      }

      const now = Date.now();

      return ledger.withLease(partitionKey, async () => {
        const before = await ledger.read(partitionKey, now);

        /*
         * The chain overrides the document's own status field. A paused policy
         * is judged as PAUSED regardless of what the file says, which is what
         * makes `pausePolicy` a kill switch rather than a note: the very next
         * decision fails `policy.active`, the first rule in the chain, before
         * any other rule is consulted.
         */
        const onChainStatus = anchor ? statusFromAnchor(anchor) : null;
        const policy = {
          ...POLICY_DOC,
          id: policyId,
          status: anchorError ? "PAUSED" : (onChainStatus?.status ?? "PAUSED"),
          policyHash: POLICY_HASH,
        };

        const { decision, effects } = proposeDecision(
          toIntent(req) as never,
          policy as never,
          before as never,
          { nowMs: now }
        );

        const failed = decision.rules.find((r) => r.result === "FAIL");
        const approved = decision.decision === "APPROVED";

        let executionId: string | undefined;
        let transactionHash: string | undefined;
        let executionError: string | undefined;

        if (approved && effects) {
          // Charge first. See the note at the top of this file on why this order.
          await ledger.apply(effects as never);

          if (args.kh) {
            try {
              const result = await executeIfAuthorised(
                args.kh,
                decision as never,
                {
                  chainId: CHAIN_ID,
                  tokenAddress: TOKEN,
                  to: req.recipient,
                  amount: req.amount.toFixed(6),
                },
                { timeoutMs: 90_000 }
              );
              executionId = result.executionId;
              transactionHash = result.transactionHash;
            } catch (e) {
              /*
               * The spend was authorised and the execution failed. The budget
               * stays charged: un-charging here would let an agent burn the
               * executor with requests that each fail and each cost nothing,
               * which is a free retry loop around the rate limit.
               */
              executionError = e instanceof Error ? e.message : String(e);
            }
          } else {
            executionError = "no KeeperHub key configured on this gateway";
          }
        }

        const after = await ledger.read(partitionKey, now);

        const record: DecisionRecord = {
          at: new Date(now).toISOString(),
          partitionKey,
          policyId,
          policyVersion: POLICY_DOC.version,
          intentHash: decision.intentHash,
          decision: decision.decision,
          failedRule: failed?.rule ?? null,
          /*
           * The engine's own words. `reasons` is where it explains itself; the
           * earlier fallback here printed "within every limit" on refusals,
           * which is the one sentence a refusal must never carry.
           */
          reason:
            anchorError ??
            decision.reasons?.[0] ??
            (approved ? "within every limit" : `refused by ${failed?.rule ?? "an unnamed rule"}`),
          amount: req.amount,
          recipient: req.recipient,
          endpoint: req.endpoint,
          category: req.category,
          rules: decision.rules.map((r) => toRuleTrace(r as never)),
          ...(executionId ? { executionId } : {}),
          ...(transactionHash ? { transactionHash } : {}),
        };
        await ledger.record(record);

        return {
          decision: decision.decision,
          approved,
          failedRule: failed?.rule ?? null,
          reason: record.reason,
          intentHash: decision.intentHash,
          policyId,
          policyVersion: POLICY_DOC.version,
          rules: record.rules,
          budget: {
            limit: dailyLimit,
            spentBefore: before.budgetUsage.effectiveToday,
            spentAfter: after.budgetUsage.effectiveToday,
            remaining: Math.max(0, dailyLimit - after.budgetUsage.effectiveToday),
          },
          callsInLastHour: after.callsInLastHour,
          anchor: {
            registry: REGISTRY,
            policyHash: POLICY_HASH,
            onChainStatus: anchorError ? "unusable" : (onChainStatus?.status ?? "unknown"),
            usable: Boolean(anchor?.usable),
          },
          ...(executionId ? { executionId } : {}),
          ...(transactionHash ? { transactionHash } : {}),
          ...(executionError ? { executionError } : {}),
        } satisfies AuthorityOutcome;
      });
    },

    async history(limit) {
      return ledger.decisions(limit, partitionKey);
    },

    async state() {
      const now = Date.now();
      const [w, s] = await Promise.all([
        ledger.read(partitionKey, now),
        ledger.stats(partitionKey, now),
      ]);

      let onChain: Awaited<ReturnType<Authority["state"]>>["onChain"];
      try {
        const rec = await readAnchor();
        const st = statusFromAnchor(rec);
        onChain = { status: st.status, usable: rec.usable, version: rec.version, expiry: st.expiry };
      } catch (e) {
        onChain = { error: e instanceof Error ? e.message : String(e) };
      }

      return {
        policyId,
        policyHash: POLICY_HASH,
        rules: POLICY_DOC.rules,
        onChain,
        spentToday: w.budgetUsage.effectiveToday,
        remaining: Math.max(0, dailyLimit - w.budgetUsage.effectiveToday),
        callsInLastHour: w.callsInLastHour,
        decisions: { total: s.total, approved: s.approved, refused: s.refused },
      };
    },
  };
}
