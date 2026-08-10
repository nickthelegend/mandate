/**
 * The escalation state machine.
 *
 * A policy decision has three outcomes, not two. APPROVED and BLOCKED_* are
 * settled; ESCALATED_* is the one that needs a person. Before this package
 * Outcome had nowhere to put that third answer, so an escalated spend was
 * recorded like a refusal and quietly dropped — the rule fired, produced a
 * distinct verdict, and nothing acted on it.
 *
 *   ESCALATED_* ─▶ PENDING ─┬─ APPROVE (bound operator, valid code) ─▶ APPROVED ─▶ spend executes
 *                           ├─ DENY                                  ─▶ DENIED
 *                           ├─ anything invalid ─▶ IGNORED_* (logged; stays PENDING)
 *                           └─ timeout                               ─▶ EXPIRED ─▶ denied
 *
 * Two properties matter more than the diagram.
 *
 * **An invalid response never resolves anything.** A wrong code, an unbound
 * operator, a reply after expiry: each is logged as a failed control event and
 * the escalation stays open. Nothing here treats "we could not verify this" as
 * a decision.
 *
 * **Timeout defaults to denied.** An escalation nobody answers must not become
 * an approval by exhaustion. The money stays where it is.
 *
 * Ported from untch's `@untch/escalation` §7.2 lifecycle and §27
 * authority-boundary check.
 */

export type EscalationStatus = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED";

/**
 * Everything an inbound response can result in.
 *
 * The `IGNORED_*` set is the important half. Each one is a distinct reason a
 * plausible-looking approval was not honoured, and each is recorded — a control
 * that silently drops the responses it rejects cannot be audited.
 */
export type InboundOutcome =
  | "APPROVED"
  | "DENIED"
  | "IGNORED_UNBOUND"
  | "IGNORED_BAD_CODE"
  | "IGNORED_OVER_CAP"
  | "IGNORED_EXPIRED"
  | "IGNORED_ALREADY_RESOLVED"
  | "IGNORED_NOT_FOUND";

/** One appended event on an escalation's trail. Failures are entries too, never omissions. */
export interface ChannelLogEntry {
  readonly at: string;
  readonly channel: string;
  readonly kind: "CREATED" | "INBOUND" | "SYSTEM";
  readonly handle?: string;
  readonly outcome?: InboundOutcome;
  readonly detail?: string;
}

/** Who may approve, and up to how much. Snapshotted at creation, not read live. */
export interface ApprovalsConfig {
  /** Operator identities that may resolve. An EVM address, compared case-insensitively. */
  readonly operators: readonly string[];
  /** The most an operator may approve here. Above it, no approval is valid. */
  readonly maxApprovalAmount: number;
  /** How long the escalation stays answerable, in seconds. */
  readonly timeoutSeconds: number;
}

/**
 * A stored escalation.
 *
 * `heldSpend` is what makes this more than a notification: the exact request
 * that was escalated, kept so approving it executes the spend that was asked
 * for rather than a re-derived approximation of it.
 */
export interface EscalationRecord {
  readonly id: string;
  readonly intentHash: string;
  readonly policyId: string;
  readonly status: EscalationStatus;
  /** The decision code that escalated, e.g. ESCALATED_VENDOR_RISK. */
  readonly decision: string;
  readonly reason: string;
  readonly failedRule: string | null;
  readonly amount: number;
  readonly token: string;
  readonly recipient: string;
  readonly heldSpend: Record<string, unknown>;
  readonly approvals: ApprovalsConfig;
  readonly approvalCodeHash: string;
  readonly expiresAt: string;
  readonly channelLog: readonly ChannelLogEntry[];
  readonly resolvedBy: { channel: string; handle: string } | null;
  readonly resolvedAt: string | null;
  /** Set once an approved escalation's spend has actually executed. */
  readonly executionId?: string;
  readonly transactionHash?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** An operator's response, normalized by whatever carried it. */
export interface InboundResponse {
  readonly channel: string;
  /** The operator's stable identity on that channel. */
  readonly senderHandle: string;
  readonly action: "APPROVE" | "DENY";
  readonly code: string;
  readonly escalationId?: string;
  readonly receivedAtMs: number;
}

export interface InboundResult {
  readonly outcome: InboundOutcome;
  readonly status: EscalationStatus | null;
  readonly escalationId: string | null;
  readonly detail: string;
}
