/**
 * The authority, over HTTP.
 *
 * The MCP server talks to the gateway rather than reaching into MongoDB and the
 * chain itself, and that is a deliberate boundary rather than laziness. Two
 * things fall out of it.
 *
 * The read-only tools need no credential at all. Anyone can run this against
 * the hosted authority and ask what an agent is allowed to do, what it has
 * spent, and why something was refused — which matters because the party most
 * in need of that answer is rarely the one holding the operator's API key.
 *
 * And there is exactly one authority. If this package judged spends locally it
 * would be a second implementation of the same fifteen rules, reading a
 * different ledger, capable of disagreeing with the one that actually governs
 * the money. A client cannot drift from the thing it is a client of.
 */

export type SpendRequest = {
  amount: number;
  category?: string;
  endpoint?: string;
  recipient?: string;
  agent: string;
  nonce: number;
};

export type RuleTrace = {
  rule: string;
  result: string;
  observed?: unknown;
  limit?: unknown;
};

export type Decision = {
  decision: string;
  approved: boolean;
  failedRule: string | null;
  reason: string;
  rules: RuleTrace[];
  budget: { limit: number; spentBefore: number; spentAfter: number; remaining: number };
  transactionHash?: string;
  executionId?: string;
  executionError?: string;
  escalation?: { id: string; expiresAt: string };
};

export type AuthorityState = {
  agent: string;
  policyId: string;
  policyHash: string;
  rules: Record<string, unknown>;
  onChain: { status: string; usable: boolean; version: number; expiry: string } | { error: string };
  spentToday: number;
  remaining: number;
  callsInLastHour: number;
};

export type Score = {
  subject: string;
  score: number;
  sigma: number;
  lcb: number;
  band: string;
  features: { key: string; value: number; implemented: boolean }[];
};

export type DecisionRow = {
  at: string;
  decision: string;
  failedRule: string | null;
  amount: number;
  recipient: string;
  transactionHash?: string;
};

export type EscalationRow = {
  id: string;
  decision: string;
  reason: string;
  amount: number;
  recipient: string;
  expiresAt: string;
};

export class AuthorityError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "AuthorityError";
  }
}

export type Authority = ReturnType<typeof createAuthorityClient>;

export function createAuthorityClient(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");

  const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${base}${path}`, init);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      /*
       * The gateway's refusals are readable sentences, and a model is going to
       * show whatever comes back to a person. Surfacing its message beats
       * wrapping it in one of ours that says less.
       */
      throw new AuthorityError(res.status, String(body.error ?? `authority returned ${res.status}`));
    }
    return body as T;
  };

  const post = (path: string, payload: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  return {
    /** Judge a spend and write nothing. */
    preflight: (req: Omit<SpendRequest, "nonce">) =>
      call<Decision>("/authority/preflight", post("/authority/preflight", req)),

    /** Judge a spend and, on approval, move the money. */
    decide: (req: SpendRequest) => call<Decision>("/authority/spend", post("/authority/spend", req)),

    state: (agent?: string) =>
      call<AuthorityState>(`/authority${agent ? `?agent=${encodeURIComponent(agent)}` : ""}`),

    score: (payee: string) => call<Score>(`/authority/score/${payee}`),

    history: async (limit: number, agent?: string) => {
      const q = new URLSearchParams({ limit: String(limit), ...(agent ? { agent } : {}) });
      const b = await call<{ entries: DecisionRow[] }>(`/authority/log?${q}`);
      return b.entries;
    },

    escalations: async (limit: number, status?: string, agent?: string) => {
      const q = new URLSearchParams({
        limit: String(limit),
        ...(status ? { status } : {}),
        ...(agent ? { agent } : {}),
      });
      const b = await call<{ entries: EscalationRow[] }>(`/authority/escalations?${q}`);
      return b.entries;
    },
  };
}
