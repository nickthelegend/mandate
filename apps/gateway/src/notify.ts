/**
 * Telling a person that a spend is waiting on them.
 *
 * `ESCALATED` is the third answer and the only one that needs somebody. Until
 * this existed the escalation service kept a channel log in which every entry
 * said `http`, because the only way to discover a held spend was to already be
 * looking at the console — which makes "held for a human" a refusal with a
 * longer name.
 *
 * Two properties matter, and they shape everything below.
 *
 * **It never blocks a decision.** A notification is downstream of the verdict.
 * If the operator's endpoint is down, the spend is still correctly held and the
 * money is still correctly not moved. Awaiting delivery on the decision path
 * would mean an outage at the messenger becomes an outage at the authority, and
 * that failure points the wrong way.
 *
 * **A failure is recorded as loudly as a success.** `notified.error` is written
 * to the escalation and rendered in the console. An escalation nobody was told
 * about is one nobody is coming to answer, and a notifier that quietly degrades
 * to "we tried" is the exact shape of claim this project exists to refuse.
 *
 * WHY THIS IS NOT ROUTED THROUGH KEEPERHUB
 *
 * It should be, and it cannot be on this plan. Routing the delivery through a
 * KeeperHub workflow would mean the answer to "was the operator reached" came
 * from KeeperHub's execution record rather than from the party who was supposed
 * to do the reaching — a strictly better property. Both actions that could
 * carry it, `webhook/send-webhook` and the System `HTTP Request`, answer
 * `402 upgrade_required` (`featureId: action.webhook` / `action.http-request`,
 * `requiredPlan: pro`). The workflow definition is written and ready in
 * `scripts/create-notify-workflow.mjs`; it is one plan upgrade from running,
 * and the gateway side would not move.
 *
 * What is kept in the meantime is the half that does not need a plan: the
 * receiving end writes the delivery down. Point `MANDATE_OPERATOR_WEBHOOK` at
 * the gateway's own `/hook/operator` and the arrival is a row in Mongo written
 * by the receiver, readable at `/authority/deliveries` — evidence of arrival
 * rather than an assertion of dispatch.
 */

export type NotifyOutcome = {
  /** What was attempted. `none` means it was never configured. */
  via: "http" | "none";
  /** Where it went, so a reader can check the other end. */
  to?: string;
  /** The receiving end's own id for the delivery, when it returns one. */
  deliveryId?: string | null;
  at: string;
  /** Present only when the attempt failed. The operator was NOT reached. */
  error?: string;
};

export interface HeldSpendNotice {
  escalationId: string;
  amount: number;
  recipient: string;
  reason: string;
  expiresAt: string;
}

export interface NotifierConfig {
  /** Where the operator wants to be reached. Their endpoint, not ours. */
  operatorUrl: string;
  /** Deep link back into the console, so the notice is actionable. */
  consoleUrl: string;
  /** Give up after this long. A slow endpoint must not pin a socket open. */
  timeoutMs?: number;
}

export function notifierFromEnv(): Notifier | null {
  const operatorUrl = process.env.MANDATE_OPERATOR_WEBHOOK;
  /*
   * No destination, no notifier — and the escalation then records
   * `via: "none"`, which is a more honest statement than an absent field.
   */
  if (!operatorUrl) return null;
  return new Notifier({
    operatorUrl,
    consoleUrl: process.env.MANDATE_CONSOLE_URL ?? "https://nickthelegend.github.io/mandate/authority/",
  });
}

export class Notifier {
  private readonly cfg: Required<NotifierConfig>;

  constructor(cfg: NotifierConfig) {
    this.cfg = { timeoutMs: 10_000, ...cfg };
  }

  get destination(): string {
    return this.cfg.operatorUrl;
  }

  /**
   * Fire the notice. Resolves with what happened; never throws.
   *
   * The body carries the amount, the payee and why it was held — enough for a
   * person to decide without opening anything. Deliberately **not** the
   * approval code: a webhook body is not a place to put a bearer secret, and
   * the code is returned once, to whoever raised the spend.
   */
  async heldSpend(notice: HeldSpendNotice): Promise<NotifyOutcome> {
    const at = new Date().toISOString();
    const to = this.cfg.operatorUrl;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(to, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctl.signal,
        body: JSON.stringify({
          kind: "held-spend",
          escalationId: notice.escalationId,
          amount: notice.amount.toFixed(2),
          recipient: notice.recipient,
          reason: notice.reason,
          expiresAt: notice.expiresAt,
          console: this.cfg.consoleUrl,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) {
        return { via: "http", to, at, error: body.error ?? `the operator's endpoint answered ${res.status}` };
      }
      return { via: "http", to, at, deliveryId: body.id ?? null };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        via: "http",
        to,
        at,
        error: ctl.signal.aborted ? `no answer within ${this.cfg.timeoutMs}ms` : msg,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
