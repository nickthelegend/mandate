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
} from "mandate-sdk/node";
import {
  mongoLedger,
  toRuleTrace,
  type SpendLedger,
  type DecisionRecord,
  type RuleTrace,
} from "mandate-sdk/node";
import { proposeDecision, ledgerPartitionKey } from "mandate-policy";
import { hashCanonicalJson } from "mandate-policy/canon";
import {
  ReceiptWriter,
  mongoReceipts,
  keeperHubAnchorer,
  type AnchorProof,
  type Receipt,
} from "mandate-receipts";
import {
  EscalationService,
  mongoEscalations,
  type EscalationRecord,
} from "mandate-escalation";
import {
  mongoBureau,
  mongoSnapshots,
  scoreFromSources,
  toVendorScoreInject,
  epochOf,
  type ScoreResult,
} from "mandate-bureau";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Sepolia PolicyRegistry. The anchor every decision here is checked against. */
export const REGISTRY = process.env.POLICY_REGISTRY ?? "0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304";
/** The on-chain policy id this gateway enforces. Set once the document is anchored. */
export const POLICY_ID = process.env.POLICY_ID ?? "";
/**
 * Where receipt batch roots are anchored.
 *
 * A separate contract from the registry: that one gates spending, this one
 * records what was decided, and they should not share a blast radius.
 */
export const RECEIPTS = process.env.MANDATE_RECEIPTS ?? "0x64AE971Fda589E4C878F66452b8CE0533032f60d";
/** tUSDC on Sepolia -- what an approved spend actually moves. */
const TOKEN = process.env.MANDATE_TOKEN ?? "0x49C86277a91002c4943837bf20F6ED41976Db09F";
const CHAIN_ID = 11155111;

/** The owner wallet the policy is registered to, and the intent's declared owner. */
const OWNER = process.env.AUTHORITY_OWNER ?? "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67";

/**
 * Who may resolve an escalation, and up to how much.
 *
 * The operator is the policy owner: the party whose money it is. Not the agent,
 * which is the whole point -- an agent that could approve its own escalations
 * has a spending limit it can lift by asking itself.
 */
const OPERATORS = (process.env.AUTHORITY_OPERATORS ?? OWNER)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
/** The most one operator may release here. A ceiling on the ceiling. */
const MAX_APPROVAL = Number(process.env.AUTHORITY_MAX_APPROVAL ?? 2);
const ESCALATION_TIMEOUT_S = Number(process.env.AUTHORITY_ESCALATION_TIMEOUT ?? 900);

/**
 * What the file on disk carries.
 *
 * No `id` and no `status`: both come from the chain at request time, and a copy
 * of either in the file would be a second answer that could disagree with the
 * registry. The id is whatever `registerPolicy` assigned; the status is whatever
 * the registry says right now, which is what makes the pause a kill switch.
 */
type PolicyDoc = {
  version: number;
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
  /**
   * Which agent under this policy is asking.
   *
   * One owner's policy governs many agents, and each gets its own budget,
   * duplicate window, cooldown clocks and rate limit. That is the real
   * deployment shape -- a team does not give every agent a shared wallet and
   * hope -- and it is what stops one agent's spending from silently consuming
   * another's headroom.
   *
   * It also fixes what was, in practice, the worst bug in the product. With a
   * single shared partition, the demo's duplicate window was global: the first
   * visitor to buy market data locked that exact purchase for everyone else for
   * an hour, and the day's budget drained for everyone at once. The button
   * promising "inside every limit" answered BLOCKED_DUPLICATE to the second
   * person who pressed it.
   */
  agent: string;
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
  /**
   * What the bureau said about this payee, and therefore what
   * `vendor.lcbFloor` compared against. Present on every decision, including
   * the ones another rule refused first -- a reader should not have to guess
   * whether the floor was even consulted.
   */
  vendor?: {
    payee: string;
    lcb: number;
    score: number;
    sigma: number;
    band: string;
    floor: number;
    epoch: number;
    features: { key: string; value: number; weightApplied: number; observed: boolean; note: string }[];
  };
  /**
   * Present when the decision escalated. The spend is held, not refused: a
   * bound operator can release it with the code, and the code is returned
   * exactly once, here.
   */
  escalation?: {
    id: string;
    code: string;
    expiresAt: string;
    resolveWith: string;
  };
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
    agent: req.agent,
    endpoint: req.endpoint,
    category: req.category,
    recipient: req.recipient.toLowerCase(),
  });
}

/**
 * The ledger partition for one agent under this policy.
 *
 * `mandate-policy`'s own `ledgerPartitionKey` keys on the policy alone, because
 * untch's model is one policy per agent -- their comment says so. Mandate runs
 * one anchored policy over many agents, so the key carries both. The rules, the
 * hash and the on-chain anchor are still shared and still the thing being
 * enforced; only the spend history is per agent, which is exactly the state
 * that should be.
 */
function partitionFor(policyId: string, agent: string): string {
  return `${ledgerPartitionKey(policyId || null)}:agent:${agent}`;
}

/** Agent ids are ours to constrain: they become part of a storage key. */
export const AGENT_ID = /^[a-z0-9][a-z0-9_-]{2,63}$/i;
/** The agent a caller gets when it does not name one. */
export const DEFAULT_AGENT = "shared";

function toIntent(req: SpendRequest) {
  return {
    owner: OWNER as `0x${string}`,
    // Derived from the agent id so two agents are distinguishable to the engine
    // as well as to the ledger, rather than every caller being agent number one.
    buyerAgentId: BigInt(`0x${hashCanonicalJson({ agent: req.agent }).slice(2, 14)}`),
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
  /**
   * The same decision, with nothing written and no money moved.
   *
   * Possible only because the engine returns PROPOSED effects rather than
   * applying them — a caller that discards the proposal has changed nothing,
   * and there is no code path through which it could have. That is what makes
   * a preflight honest rather than a second, laxer evaluator: it is the same
   * fifteen rules against the same anchored policy and the same persisted
   * ledger, and its verdict is the verdict.
   */
  preflight(req: Omit<SpendRequest, "nonce">): Promise<AuthorityOutcome>;
  history(limit: number, agent?: string): Promise<DecisionRecord[]>;
  /** Score a payee on demand, from the same sources a decision would use. */
  score(payee: string): Promise<ScoreResult>;
  /** An operator's answer to a held spend. */
  resolveEscalation(args: {
    id: string;
    code: string;
    operator: string;
    action: "APPROVE" | "DENY";
  }): Promise<{
    mandate: string;
    status: string | null;
    detail: string;
    executionId?: string;
    transactionHash?: string;
    executionError?: string;
    budget?: { spentBefore: number; spentAfter: number; remaining: number };
  }>;
  escalations(limit: number, status?: string, agent?: string): Promise<EscalationRecord[]>;
  /** Move queued receipts along: batch, anchor, confirm. */
  tickReceipts(): Promise<{ batched: number; submitted: number; confirmed: number; degraded: number }>;
  receipts(limit: number): Promise<Receipt[]>;
  /** The merkle proof a holder can check for themselves. */
  receiptProof(receiptId: string): Promise<AnchorProof | null>;
  /** Expire anything past its deadline. Silence defaults to denied. */
  sweepEscalations(): Promise<{ expired: string[] }>;
  state(agent?: string): Promise<{
    agent: string;
    policyId: string;
    policyHash: string;
    rules: Record<string, unknown>;
    onChain: { status: string; usable: boolean; version: number; expiry: string } | { error: string };
    spentToday: number;
    remaining: number;
    callsInLastHour: number;
    decisions: { total: number; approved: number; refused: number };
    /** Across every agent, for a reader asking what this authority has done. */
    totals: { total: number; approved: number; refused: number; escalated: number };
    /** The floor a payee's bound must clear, and what it is compared against. */
    vendorFloor: number | null;
  }>;
};

export async function createAuthority(args: {
  provider: JsonRpcProvider;
  kh: KeeperHubClient | null;
  mongoUri: string;
  mongoDb: string;
}): Promise<Authority> {
  const ledger = await mongoLedger({ uri: args.mongoUri, db: args.mongoDb });

  /*
   * The bureau, and the snapshot store in front of it.
   *
   * A score is pinned per 6-hour epoch rather than recomputed per request. Not
   * only for cost: a score that drifts between two spends seconds apart makes a
   * refusal impossible to reproduce, and a decision that cites a number nobody
   * can recover is not an explanation.
   */
  const bureau = await mongoBureau({
    uri: args.mongoUri,
    db: args.mongoDb,
    provider: args.provider,
    token: TOKEN,
  });
  const snapshots = await mongoSnapshots({ uri: args.mongoUri, db: args.mongoDb });

  /*
   * The escalation service. The approvals config is handed in once and
   * snapshotted onto every escalation it opens, so raising the operator cap
   * later cannot retroactively authorise anything already pending.
   */
  /*
   * The receipt writer.
   *
   * Every decision, approved or refused, becomes a receipt: durable
   * immediately, batched under a merkle root, anchored on chain through
   * KeeperHub afterwards. Anchoring is deliberately downstream -- if it were on
   * the decision's path, an RPC outage would stop the authority deciding, and
   * an authority that stops deciding stops refusing.
   */
  const receipts = new ReceiptWriter(
    await mongoReceipts({ uri: args.mongoUri, db: args.mongoDb }),
    args.kh
      ? keeperHubAnchorer({
          kh: args.kh as never,
          provider: args.provider,
          registry: RECEIPTS,
          chainId: CHAIN_ID,
        })
      : null
  );

  const escalations = new EscalationService(
    await mongoEscalations({ uri: args.mongoUri, db: args.mongoDb }),
    {
      operators: OPERATORS,
      maxApprovalAmount: MAX_APPROVAL,
      timeoutSeconds: ESCALATION_TIMEOUT_S,
    }
  );

  const vendorFloor = (POLICY_DOC.rules as { vendors?: { minScoreLCB: number } }).vendors?.minScoreLCB;

  /**
   * Execute an authorised spend.
   *
   * Shared by the immediate path and the released-escalation path on purpose:
   * a spend a human approved must move money through exactly the same code an
   * automatically approved one does, or the two are different products with one
   * name.
   */
  async function runTransfer(
    decision: { decision: string; rules: readonly { rule: string; result: string }[]; intentHash?: string },
    recipient: string,
    amount: number
  ): Promise<{ executionId?: string; transactionHash?: string; error?: string }> {
    if (!args.kh) return { error: "no KeeperHub key configured on this gateway" };
    try {
      const r = await executeIfAuthorised(
        args.kh,
        decision as never,
        { chainId: CHAIN_ID, tokenAddress: TOKEN, to: recipient, amount: amount.toFixed(6) },
        { timeoutMs: 90_000 }
      );
      return {
        ...(r.executionId ? { executionId: r.executionId } : {}),
        ...(r.transactionHash ? { transactionHash: r.transactionHash } : {}),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function scoreFor(payee: string, nowMs: number): Promise<ScoreResult> {
    const epoch = epochOf(nowMs);
    const cached = await snapshots.get(payee, epoch);
    if (cached) return cached;
    const fresh = await scoreFromSources(bureau, payee, { nowMs });
    await snapshots.put(fresh);
    return fresh;
  }

  const policyId = POLICY_ID;
  /** The default partition, for callers that do not name an agent. */
  const partitionKey = partitionFor(policyId, DEFAULT_AGENT);
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

      /*
       * The payee's score, read outside the lease for the same reason the
       * anchor is: it is Mongo plus a handful of receipt reads, and no
       * concurrent request can invalidate it inside this decision's window.
       */
      const vendorScore = vendorFloor === undefined ? null : await scoreFor(req.recipient, now);

      const part = partitionFor(policyId, req.agent);

      return ledger.withLease(part, async () => {
        const before = await ledger.read(part, now);

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

        /*
         * The bureau's verdict joins the ledger window here, which is the only
         * place `vendor.lcbFloor` reads. It carries the LOWER-confidence bound
         * rather than the raw score: a payee with a good score and thin
         * evidence must not clear a floor that a well-evidenced payee clears.
         */
        const state = vendorScore
          ? { ...before, vendorScore: toVendorScoreInject(vendorScore) }
          : before;

        const { decision, effects } = proposeDecision(
          toIntent(req) as never,
          policy as never,
          state as never,
          { nowMs: now }
        );

        const failed = decision.rules.find((r) => r.result === "FAIL");
        const approved = decision.decision === "APPROVED";

        let executionId: string | undefined;
        let transactionHash: string | undefined;
        let executionError: string | undefined;
        let opened: { id: string; code: string; expiresAt: string } | undefined;

        if (approved && effects) {
          /*
           * Re-key the effects onto this agent's partition before applying.
           *
           * `proposeDecision` stamps them with `ledgerPartitionKey(policyId)`,
           * which is the policy-only key -- correct for untch, where one policy
           * governs one agent. Here it would charge the spend to a partition
           * nothing reads, so the budget would never accumulate and the daily
           * limit would silently never bind. Charged first; see the note at the
           * top of this file on why that order.
           */
          await ledger.apply({ ...effects, partitionKey: part } as never);
          const run = await runTransfer(decision, req.recipient, req.amount);
          executionId = run.executionId;
          transactionHash = run.transactionHash;
          /*
           * The spend was authorised and the execution failed. The budget stays
           * charged: un-charging here would let an agent burn the executor with
           * requests that each fail and each cost nothing, which is a free
           * retry loop around the rate limit.
           */
          executionError = run.error;
        } else if (decision.decision.startsWith("ESCALATED_")) {
          /*
           * The third answer. The engine did not approve this and did not
           * refuse it either -- it asked for a person, and before this the
           * distinction was thrown away and the spend recorded like a refusal.
           *
           * Nothing is charged and nothing moves. The request is held in full
           * so that releasing it later spends exactly what was asked for, and
           * the budget is charged at release rather than now: an escalation
           * that expires unanswered must cost nothing.
           */
          opened = await escalations.create({
            intentHash: decision.intentHash,
            policyId,
            decision: decision.decision,
            reason: decision.reasons?.[0] ?? decision.decision,
            failedRule: failed?.rule ?? null,
            amount: req.amount,
            token: TOKEN,
            recipient: req.recipient,
            heldSpend: { ...req },
          });
        }

        const after = await ledger.read(part, now);

        const record: DecisionRecord = {
          at: new Date(now).toISOString(),
          partitionKey: part,
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

        /*
         * The receipt, after the decision is already recorded. A failure here
         * must not turn a completed decision into an error for the caller --
         * the ledger is the operative record and the receipt is the evidence
         * trail on top of it.
         */
        void receipts
          .enqueue({
            intentHash: decision.intentHash,
            policyId,
            policyVersion: POLICY_DOC.version,
            policyHash: POLICY_HASH,
            decision: decision.decision,
            failedRule: failed?.rule ?? null,
            amountBase: String(Math.round(req.amount * 1_000_000)),
            recipient: req.recipient,
            token: TOKEN,
            agent: req.agent,
            decidedAt: new Date(now).toISOString(),
            ...(transactionHash ? { transactionHash } : {}),
          })
          .catch(() => {});

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
          ...(vendorScore
            ? {
                vendor: {
                  payee: vendorScore.subject,
                  lcb: vendorScore.lcb,
                  score: vendorScore.score,
                  sigma: vendorScore.sigma,
                  band: vendorScore.band,
                  floor: vendorFloor!,
                  epoch: vendorScore.epoch,
                  features: vendorScore.features.map((f) => ({
                    key: f.key,
                    value: f.value,
                    weightApplied: f.weightApplied,
                    observed: f.implemented,
                    note: f.note,
                  })),
                },
              }
            : {}),
          ...(opened
            ? {
                escalation: {
                  id: opened.id,
                  // Returned once, here. Only its hash is stored.
                  code: opened.code,
                  expiresAt: opened.expiresAt,
                  resolveWith: `POST /authority/escalation/${opened.id}/resolve`,
                },
              }
            : {}),
          ...(executionId ? { executionId } : {}),
          ...(transactionHash ? { transactionHash } : {}),
          ...(executionError ? { executionError } : {}),
        } satisfies AuthorityOutcome;
      });
    },

    async preflight(req) {
      // No lease: nothing is written, so there is nothing to serialize against.
      const full: SpendRequest = { ...req, nonce: Date.now() };
      const now = Date.now();
      const part = partitionFor(policyId, full.agent);

      let anchor: Awaited<ReturnType<typeof readAnchor>> | null = null;
      let anchorError: string | null = null;
      try {
        anchor = await readAnchor();
      } catch (e) {
        if (e instanceof PolicyAnchorMismatch || e instanceof PolicyNotUsable) anchorError = e.message;
        else throw e;
      }

      const vendorScore = vendorFloor === undefined ? null : await scoreFor(full.recipient, now);
      const before = await ledger.read(part, now);
      const onChainStatus = anchor ? statusFromAnchor(anchor) : null;
      const policy = {
        ...POLICY_DOC,
        id: policyId,
        status: anchorError ? "PAUSED" : (onChainStatus?.status ?? "PAUSED"),
        policyHash: POLICY_HASH,
      };
      const state = vendorScore
        ? { ...before, vendorScore: toVendorScoreInject(vendorScore) }
        : before;

      const { decision } = proposeDecision(
        toIntent(full) as never,
        policy as never,
        state as never,
        { nowMs: now }
      );
      const failed = decision.rules.find((r) => r.result === "FAIL");
      const spent = before.budgetUsage.effectiveToday;

      return {
        decision: decision.decision,
        approved: decision.decision === "APPROVED",
        failedRule: failed?.rule ?? null,
        reason: anchorError ?? decision.reasons?.[0] ?? decision.decision,
        intentHash: decision.intentHash,
        policyId,
        policyVersion: POLICY_DOC.version,
        rules: decision.rules.map((r) => toRuleTrace(r as never)),
        /*
         * `spentAfter` is what the ledger holds NOW, not what it would hold if
         * this were executed. A preflight that reported a spend it did not make
         * would be describing a world that does not exist.
         */
        budget: {
          limit: dailyLimit,
          spentBefore: spent,
          spentAfter: spent,
          remaining: Math.max(0, dailyLimit - spent),
        },
        callsInLastHour: before.callsInLastHour,
        anchor: {
          registry: REGISTRY,
          policyHash: POLICY_HASH,
          onChainStatus: anchorError ? "unusable" : (onChainStatus?.status ?? "unknown"),
          usable: Boolean(anchor?.usable),
        },
        ...(vendorScore
          ? {
              vendor: {
                payee: vendorScore.subject,
                lcb: vendorScore.lcb,
                score: vendorScore.score,
                sigma: vendorScore.sigma,
                band: vendorScore.band,
                floor: vendorFloor!,
                epoch: vendorScore.epoch,
                features: vendorScore.features.map((f) => ({
                  key: f.key,
                  value: f.value,
                  weightApplied: f.weightApplied,
                  observed: f.implemented,
                  note: f.note,
                })),
              },
            }
          : {}),
      } satisfies AuthorityOutcome;
    },

    async history(limit, agent) {
      return ledger.decisions(limit, partitionFor(policyId, agent ?? DEFAULT_AGENT));
    },

    async score(payee) {
      return scoreFor(payee, Date.now());
    },

    async resolveEscalation({ id, code, operator, action }) {
      const verdict = await escalations.respond({
        channel: "http",
        senderHandle: operator,
        action,
        code,
        escalationId: id,
        receivedAtMs: Date.now(),
      });

      // Anything short of a clean approval changes no money.
      if (verdict.outcome !== "APPROVED") {
        return { mandate: verdict.outcome, status: verdict.status, detail: verdict.detail };
      }

      const rec = await escalations.get(id);
      if (!rec) {
        return { mandate: verdict.outcome, status: verdict.status, detail: "escalation vanished" };
      }

      /*
       * The budget is charged HERE, not when the escalation was opened.
       *
       * A held spend has not happened. Charging at creation would let an agent
       * exhaust the day's budget by raising escalations nobody ever answers --
       * a denial-of-service against its own operator. Charging at release means
       * an expired escalation costs nothing, and the release is still judged
       * against the budget as it stands at that moment rather than as it stood
       * when the request was made.
       */
      const now = Date.now();
      const held = rec.heldSpend as unknown as SpendRequest;
      const heldPart = partitionFor(policyId, held.agent ?? DEFAULT_AGENT);

      const released = await ledger.withLease(heldPart, async () => {
        const before = await ledger.read(heldPart, now);

        const { decision, effects } = proposeDecision(
          toIntent(held) as never,
          {
            ...POLICY_DOC,
            id: policyId,
            status: "ACTIVE",
            policyHash: POLICY_HASH,
            /*
             * The rule that escalated is relaxed for this one release, and
             * nothing else is. An operator answered exactly the question the
             * vendor floor asked; they did not waive the daily budget, the
             * per-call cap, the rate limit or the duplicate window, so those
             * are all still enforced against current state.
             */
            rules: { ...POLICY_DOC.rules, vendors: undefined },
          } as never,
          before as never,
          { nowMs: now }
        );

        if (decision.decision !== "APPROVED" || !effects) {
          return {
            blocked: decision.decision,
            reason: decision.reasons?.[0] ?? decision.decision,
            before,
          } as const;
        }

        // Same re-keying on the release path, for the same reason.
        await ledger.apply({ ...effects, partitionKey: heldPart } as never);
        const run = await runTransfer(decision, rec.recipient, rec.amount);
        const after = await ledger.read(heldPart, now);
        return { decision, run, before, after } as const;
      });

      if ("blocked" in released) {
        await escalations.recordExecution(id, {
          error: `approved by operator but ${released.blocked}: ${released.reason}`,
        });
        return {
          mandate: "APPROVED",
          status: "APPROVED",
          detail: `operator approved, but the spend is now ${released.blocked}: ${released.reason}`,
        };
      }

      await escalations.recordExecution(id, released.run);
      const limit = dailyLimit;
      return {
        mandate: "APPROVED",
        status: "APPROVED",
        detail: "released by bound operator",
        ...(released.run.executionId ? { executionId: released.run.executionId } : {}),
        ...(released.run.transactionHash ? { transactionHash: released.run.transactionHash } : {}),
        ...(released.run.error ? { executionError: released.run.error } : {}),
        budget: {
          spentBefore: released.before.budgetUsage.effectiveToday,
          spentAfter: released.after.budgetUsage.effectiveToday,
          remaining: Math.max(0, limit - released.after.budgetUsage.effectiveToday),
        },
      };
    },

    async escalations(limit, status, agent) {
      const all = await escalations.list(limit, status as never);
      if (!agent) return all;
      // An operator should see their own agent's held spends, not everyone's.
      return all.filter((e) => (e.heldSpend as { agent?: string })?.agent === agent);
    },

    async sweepEscalations() {
      return escalations.sweep();
    },

    async tickReceipts() {
      return receipts.tick();
    },

    async receipts(limit) {
      return receipts.recent(limit);
    },

    async receiptProof(receiptId) {
      return receipts.proof(receiptId);
    },

    async state(agent) {
      const now = Date.now();
      const part = partitionFor(policyId, agent ?? DEFAULT_AGENT);
      const [w, s, totals] = await Promise.all([
        ledger.read(part, now),
        ledger.stats(part, now),
        ledger.totals(),
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
        agent: agent ?? DEFAULT_AGENT,
        policyId,
        policyHash: POLICY_HASH,
        rules: POLICY_DOC.rules,
        onChain,
        spentToday: w.budgetUsage.effectiveToday,
        remaining: Math.max(0, dailyLimit - w.budgetUsage.effectiveToday),
        callsInLastHour: w.callsInLastHour,
        decisions: { total: s.total, approved: s.approved, refused: s.refused },
        totals,
        vendorFloor: vendorFloor ?? null,
      };
    },
  };
}
