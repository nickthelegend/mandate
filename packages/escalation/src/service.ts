/**
 * The service that carries a decision to a person and carries the answer back,
 * without ever letting the channel decide.
 *
 * The distinction is the whole design. A channel — an HTTP call, a chat bot,
 * anything — reports that someone said APPROVE. It does not get to conclude
 * that the spend is approved. This service re-checks every condition against
 * the escalation's own snapshot: is the responder a bound operator, is the code
 * valid and unused, is the amount within what that operator may approve, is the
 * escalation still open. Any failure is logged as a failed control event and
 * the escalation stays exactly where it was.
 *
 * That ordering is deliberate. A control that resolves on an unverifiable
 * response is not a control, and one that silently discards the responses it
 * rejects cannot be audited afterwards — so every rejection is an entry.
 *
 * Ported from untch's `@untch/escalation`. The lifecycle and the
 * authority-boundary check are theirs; the store is Mongo and the channel is
 * Mandate's own authenticated HTTP surface, which is the analogue of untch's
 * dashboard channel (the one they bind by wallet rather than by chat handle).
 */

import { codeMatchesHash, generateCode, hashCode } from "./codes.ts";
import type {
  ApprovalsConfig,
  ChannelLogEntry,
  EscalationRecord,
  EscalationStatus,
  InboundResponse,
  InboundResult,
} from "./types.ts";

/** Everything the service needs from storage. Implemented against Mongo in `mongo.ts`. */
export interface EscalationStore {
  insert(rec: EscalationRecord): Promise<void>;
  byId(id: string): Promise<EscalationRecord | null>;
  byCodeHash(hash: string): Promise<EscalationRecord | null>;
  update(id: string, patch: Partial<EscalationRecord>, append?: ChannelLogEntry): Promise<void>;
  list(limit: number, status?: EscalationStatus): Promise<EscalationRecord[]>;
  /** Open escalations already past their expiry, for the sweep. */
  overdue(nowIso: string): Promise<EscalationRecord[]>;
}

export interface CreateEscalationInput {
  readonly intentHash: string;
  readonly policyId: string;
  readonly decision: string;
  readonly reason: string;
  readonly failedRule: string | null;
  readonly amount: number;
  readonly token: string;
  readonly recipient: string;
  readonly heldSpend: Record<string, unknown>;
}

export interface CreatedEscalation {
  readonly id: string;
  /** Returned ONCE, at creation. Only its hash is stored. */
  readonly code: string;
  readonly expiresAt: string;
}

const OPEN: EscalationStatus = "PENDING";

function nowIso(ms: number): string {
  return new Date(ms).toISOString();
}

function result(
  outcome: InboundResult["outcome"],
  status: EscalationStatus | null,
  escalationId: string | null,
  detail: string
): InboundResult {
  return { outcome, status, escalationId, detail };
}

export class EscalationService {
  // Declared rather than constructor parameter properties: this package runs
  // directly under `--experimental-strip-types`, which cannot compile those.
  private readonly store: EscalationStore;
  private readonly approvals: ApprovalsConfig;
  private readonly clock: () => number;

  constructor(store: EscalationStore, approvals: ApprovalsConfig, clock: () => number = Date.now) {
    this.store = store;
    this.approvals = approvals;
    this.clock = clock;
  }

  /**
   * Open an escalation for a decision the engine escalated.
   *
   * The approvals config is snapshotted onto the record rather than read at
   * resolve time. An escalation must be judged against the rules that were in
   * force when it was raised — otherwise widening `maxApprovalAmount` later
   * retroactively authorises everything still pending.
   */
  async create(input: CreateEscalationInput): Promise<CreatedEscalation> {
    const now = this.clock();
    const code = generateCode();
    const id = `esc_${hashCode(`${input.intentHash}:${now}`).slice(0, 20)}`;
    const expiresAt = nowIso(now + this.approvals.timeoutSeconds * 1000);

    await this.store.insert({
      id,
      intentHash: input.intentHash,
      policyId: input.policyId,
      status: OPEN,
      decision: input.decision,
      reason: input.reason,
      failedRule: input.failedRule,
      amount: input.amount,
      token: input.token,
      recipient: input.recipient,
      heldSpend: input.heldSpend,
      approvals: this.approvals,
      approvalCodeHash: hashCode(code),
      expiresAt,
      channelLog: [
        {
          at: nowIso(now),
          channel: "system",
          kind: "CREATED",
          detail: `${input.decision}: ${input.reason}`,
        },
      ],
      resolvedBy: null,
      resolvedAt: null,
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
    });

    return { id, code, expiresAt };
  }

  /**
   * Process an operator's response.
   *
   * Every branch that does not resolve the escalation writes a log entry first.
   * The order of checks is not arbitrary — cheap identity checks run before the
   * code comparison so an unbound sender never gets timing information about a
   * code they were never entitled to present.
   */
  async respond(r: InboundResponse): Promise<InboundResult> {
    const now = this.clock();

    const rec = r.escalationId
      ? await this.store.byId(r.escalationId)
      : await this.store.byCodeHash(hashCode(r.code));

    if (!rec) {
      // Nothing to log against: there is no record to append to.
      return result("IGNORED_NOT_FOUND", null, null, "no escalation matches this id or code");
    }

    const log = async (outcome: InboundResult["outcome"], detail: string) => {
      await this.store.update(
        rec.id,
        { updatedAt: nowIso(now) },
        {
          at: nowIso(now),
          channel: r.channel,
          kind: "INBOUND",
          handle: r.senderHandle,
          outcome,
          detail,
        }
      );
    };

    if (rec.status !== "PENDING") {
      await log("IGNORED_ALREADY_RESOLVED", `already ${rec.status}`);
      return result("IGNORED_ALREADY_RESOLVED", rec.status, rec.id, `already ${rec.status}`);
    }

    if (Date.parse(rec.expiresAt) <= now) {
      /*
       * Expired on read. Recorded as EXPIRED here rather than waiting for the
       * sweep, so a late response cannot find an escalation still nominally
       * open and race the sweeper for it.
       */
      await this.store.update(
        rec.id,
        { status: "EXPIRED", resolvedAt: nowIso(now), updatedAt: nowIso(now) },
        {
          at: nowIso(now),
          channel: r.channel,
          kind: "INBOUND",
          handle: r.senderHandle,
          outcome: "IGNORED_EXPIRED",
          detail: "response arrived after expiry; defaulted to denied",
        }
      );
      return result("IGNORED_EXPIRED", "EXPIRED", rec.id, "response arrived after expiry");
    }

    const bound = rec.approvals.operators.some(
      (o) => o.toLowerCase() === r.senderHandle.toLowerCase()
    );
    if (!bound) {
      const detail = `${r.channel}:${r.senderHandle} is not a bound operator for this escalation`;
      await log("IGNORED_UNBOUND", detail);
      return result("IGNORED_UNBOUND", rec.status, rec.id, detail);
    }

    if (!codeMatchesHash(r.code, rec.approvalCodeHash)) {
      await log("IGNORED_BAD_CODE", "approval code did not match");
      return result("IGNORED_BAD_CODE", rec.status, rec.id, "approval code did not match");
    }

    if (r.action === "DENY") {
      await this.store.update(
        rec.id,
        {
          status: "DENIED",
          resolvedBy: { channel: r.channel, handle: r.senderHandle },
          resolvedAt: nowIso(now),
          updatedAt: nowIso(now),
        },
        {
          at: nowIso(now),
          channel: r.channel,
          kind: "INBOUND",
          handle: r.senderHandle,
          outcome: "DENIED",
          detail: "denied by operator",
        }
      );
      return result("DENIED", "DENIED", rec.id, "denied by operator");
    }

    /*
     * The cap is checked against the escalation's own snapshot and only on
     * APPROVE. A denial is always allowed: refusing to spend is not an exercise
     * of spending authority and must never be blocked by a limit on it.
     */
    if (rec.amount > rec.approvals.maxApprovalAmount) {
      const detail = `${rec.amount} exceeds the ${rec.approvals.maxApprovalAmount} an operator may approve here`;
      await log("IGNORED_OVER_CAP", detail);
      return result("IGNORED_OVER_CAP", rec.status, rec.id, detail);
    }

    await this.store.update(
      rec.id,
      {
        status: "APPROVED",
        resolvedBy: { channel: r.channel, handle: r.senderHandle },
        resolvedAt: nowIso(now),
        updatedAt: nowIso(now),
      },
      {
        at: nowIso(now),
        channel: r.channel,
        kind: "INBOUND",
        handle: r.senderHandle,
        outcome: "APPROVED",
        detail: "approved by bound operator",
      }
    );
    return result("APPROVED", "APPROVED", rec.id, "approved by bound operator");
  }

  /**
   * Expire anything past its deadline.
   *
   * Fail-closed by construction: an escalation nobody answered becomes EXPIRED,
   * which is a denial. There is no path here that turns silence into a spend.
   */
  async sweep(): Promise<{ expired: string[] }> {
    const now = this.clock();
    const overdue = await this.store.overdue(nowIso(now));
    const expired: string[] = [];
    for (const rec of overdue) {
      await this.store.update(
        rec.id,
        { status: "EXPIRED", resolvedAt: nowIso(now), updatedAt: nowIso(now) },
        {
          at: nowIso(now),
          channel: "system",
          kind: "SYSTEM",
          detail: "no operator response before the deadline; defaulted to denied",
        }
      );
      expired.push(rec.id);
    }
    return { expired };
  }

  /** Record that an approved escalation's held spend actually executed. */
  async recordExecution(
    id: string,
    exec: { executionId?: string; transactionHash?: string; error?: string }
  ): Promise<void> {
    const now = this.clock();
    await this.store.update(
      id,
      {
        updatedAt: nowIso(now),
        ...(exec.executionId ? { executionId: exec.executionId } : {}),
        ...(exec.transactionHash ? { transactionHash: exec.transactionHash } : {}),
      },
      {
        at: nowIso(now),
        channel: "system",
        kind: "SYSTEM",
        detail: exec.error
          ? `held spend failed to execute: ${exec.error}`
          : `held spend executed: ${exec.transactionHash ?? exec.executionId ?? "no hash"}`,
      }
    );
  }

  async get(id: string): Promise<EscalationRecord | null> {
    return this.store.byId(id);
  }

  async list(limit: number, status?: EscalationStatus): Promise<EscalationRecord[]> {
    return this.store.list(limit, status);
  }
}
