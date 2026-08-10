/**
 * mandate-escalation — the third answer a policy decision can have.
 *
 * Ported from untch's `@untch/escalation`: the lifecycle, the single-use hashed
 * approval codes, and the authority-boundary check that re-verifies every
 * condition rather than trusting the channel that carried the response.
 *
 * This exists because `ESCALATED_*` had nowhere to go. The engine produced it,
 * the gateway recorded it like a refusal, and the distinction the rule drew was
 * discarded. An escalation is now a durable, answerable thing, and approving
 * one executes the spend it was holding.
 */

export { generateCode, hashCode, codeMatchesHash } from "./codes.ts";
export {
  EscalationService,
  type EscalationStore,
  type CreateEscalationInput,
  type CreatedEscalation,
} from "./service.ts";
export { mongoEscalations } from "./mongo.ts";
export type {
  ApprovalsConfig,
  ChannelLogEntry,
  EscalationRecord,
  EscalationStatus,
  InboundOutcome,
  InboundResponse,
  InboundResult,
} from "./types.ts";
