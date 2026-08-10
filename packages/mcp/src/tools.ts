/**
 * The authority, as tools an agent can call.
 *
 * The point of putting this on MCP rather than only on HTTP is that an agent
 * can ask *before* it acts. `mandate_can_spend` is a real preflight: the same
 * fifteen rules, against the same anchored policy and the same persisted
 * ledger, with nothing written and no money moved. An agent that checks first
 * and gets a reason back can adjust; one that only ever discovers a refusal by
 * attempting a payment cannot.
 *
 * Everything here except `mandate_spend` is read-only and needs no credential.
 * That is deliberate: the party most in need of knowing what an agent is
 * allowed to do is rarely the party holding the operator's API key.
 *
 * The tool descriptions are part of the product. A model choosing between these
 * has only the description to go on, so each says what it reads, what it will
 * refuse, and — for the one that moves money — that the answer is binding.
 */

import type { Authority, SpendRequest } from "./authority-client.ts";

export type Tools = ReturnType<typeof createTools>;

const money = (n: number) => `$${n.toFixed(2)}`;

/** A decision, rendered for a model rather than for a table. */
function explain(d: {
  decision: string;
  reason: string;
  failedRule: string | null;
  rules: { rule: string; result: string; observed?: unknown; limit?: unknown }[];
  budget: { limit: number; spentAfter: number; remaining: number };
}): string {
  const consulted = d.rules.length;
  const head =
    d.decision === "APPROVED"
      ? `APPROVED. All ${consulted} rules passed.`
      : `${d.decision}. Refused by \`${d.failedRule}\` after ${consulted} of 15 rules; the rest were never consulted.`;
  const detail = d.rules.find((r) => r.result === "FAIL");
  const numbers =
    detail?.observed !== undefined && detail?.limit !== undefined
      ? ` Observed ${detail.observed} against a limit of ${detail.limit}.`
      : "";
  return `${head} ${d.reason}.${numbers} Budget: ${money(d.budget.spentAfter)} of ${money(
    d.budget.limit
  )} used today, ${money(d.budget.remaining)} left.`;
}

export function createTools(authority: Authority) {
  return {
    /**
     * The preflight. Judges the spend and writes nothing.
     *
     * This is the tool an agent should reach for first, and the reason the
     * engine returns proposed effects rather than applying them: a decision
     * can be produced without any path through which state could change.
     */
    async canSpend(input: Omit<SpendRequest, "nonce">): Promise<string> {
      const d = await authority.preflight(input);
      return explain(d);
    },

    /** The binding one. On approval the money actually moves through KeeperHub. */
    async spend(input: Omit<SpendRequest, "nonce">): Promise<string> {
      const d = await authority.decide({ ...input, nonce: Date.now() });
      const base = explain(d);
      if (d.transactionHash) return `${base} Transaction ${d.transactionHash}.`;
      if (d.escalation) {
        return (
          `${base} This spend is HELD for a human operator, not refused — nothing has been ` +
          `charged and nothing has moved. Escalation ${d.escalation.id}, expires ${d.escalation.expiresAt}. ` +
          `Do not retry it; retrying raises a second escalation.`
        );
      }
      if (d.executionError) return `${base} The execution failed: ${d.executionError}.`;
      return base;
    },

    /** What is left, and what the limits are. */
    async budget(agent: string): Promise<string> {
      const s = await authority.state(agent);
      const r = s.rules as {
        budgets: { daily: number };
        perCallCap: number;
        rateLimit: { callsPerHour: number };
      };
      return (
        `Agent \`${s.agent}\`: ${money(s.spentToday)} of ${money(r.budgets.daily)} spent today, ` +
        `${money(s.remaining)} left. Per-call cap ${money(r.perCallCap)}. ` +
        `${s.callsInLastHour} of ${r.rateLimit.callsPerHour} calls this hour. ` +
        `Policy ${s.policyId} is ${"error" in s.onChain ? "UNREADABLE" : s.onChain.status} on chain.`
      );
    },

    /**
     * The policy itself, and whether the chain still says it is live.
     *
     * An agent reading its own limits is not a security hole — it cannot change
     * them, and a limit nobody can read is one nobody can respect on purpose.
     */
    async policy(): Promise<string> {
      const s = await authority.state();
      const chain =
        "error" in s.onChain
          ? `The registry could not be read: ${s.onChain.error}`
          : `The registry reports ${s.onChain.status}, version ${s.onChain.version}, expiring ${s.onChain.expiry}.`;
      return (
        `Policy ${s.policyId}, hash ${s.policyHash}, anchored in PolicyRegistry on Sepolia. ` +
        `${chain} Rules: ${JSON.stringify(s.rules)}`
      );
    },

    /** What the bureau makes of a payee, and why. */
    async score(payee: string): Promise<string> {
      const r = await authority.score(payee);
      const observed = r.features.filter((f) => f.implemented);
      const priors = r.features.filter((f) => !f.implemented);
      return (
        `${r.subject}: score ${r.score.toFixed(1)}, sigma ${r.sigma.toFixed(1)}, ` +
        `lower bound ${r.lcb.toFixed(1)} (${r.band}). Enforcement compares the BOUND, never the score. ` +
        `${observed.length} observed signals: ${observed.map((f) => `${f.key} ${f.value.toFixed(0)}`).join(", ")}. ` +
        `${priors.length} carried as priors with no honest source, which widens sigma rather than ` +
        `flattering the score.`
      );
    },

    /** Why anything was refused. Approvals and refusals both. */
    async decisions(limit: number, agent?: string): Promise<string> {
      const rows = await authority.history(Math.min(Math.max(limit, 1), 50), agent);
      if (rows.length === 0) return "No decisions on record for that agent yet.";
      return rows
        .map(
          (r) =>
            `${r.at} ${r.decision}${r.failedRule ? ` (${r.failedRule})` : ""} ` +
            `${money(r.amount)} to ${r.recipient}${r.transactionHash ? ` tx ${r.transactionHash}` : " — nothing moved"}`
        )
        .join("\n");
    },

    /** Spends waiting on a person. */
    async escalations(limit: number, agent?: string): Promise<string> {
      const rows = await authority.escalations(Math.min(Math.max(limit, 1), 50), "PENDING", agent);
      if (rows.length === 0) return "Nothing is currently held for an operator.";
      return rows
        .map(
          (e) =>
            `${e.id} ${e.decision} ${money(e.amount)} to ${e.recipient} — ${e.reason}. ` +
            `Expires ${e.expiresAt}. Only a bound operator with the single-use code can release it.`
        )
        .join("\n");
    },
  };
}
