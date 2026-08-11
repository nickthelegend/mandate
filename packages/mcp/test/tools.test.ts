/**
 * Tests for the MCP layer.
 *
 * What is under test here is not arithmetic — the fifteen rules live in
 * `mandate-policy` and are tested there, and this package deliberately does not
 * re-implement them. What is under test is the two things this layer is
 * uniquely able to get wrong.
 *
 * The first is the boundary. `mandate_can_spend` must reach the preflight route
 * and nothing else; the moment it reaches `/authority/spend` it stops being a
 * preflight and starts being a payment, and the tool description promising
 * "writes nothing" becomes a lie a model will act on.
 *
 * The second is the prose. Every tool returns text, and that text is the entire
 * interface — a model has no structured field to consult and no way to check
 * the sentence against the record. So a refusal that reads as an approval, an
 * escalation that does not say "do not retry", or a score summary that presents
 * the point estimate as the thing enforcement compares, are all defects of the
 * same severity as returning a wrong number.
 *
 * The network is substituted, because a client is exactly the thing whose job
 * is to talk to a server. The server it talks to is exercised for real by
 * qa-infra against the deployed gateway.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createAuthorityClient, AuthorityError, type Decision } from "../src/authority-client.ts";
import { createTools } from "../src/tools.ts";
import { loadConfig, DEFAULT_AUTHORITY } from "../src/config.ts";
import { createServer, VERSION } from "../src/server.ts";

const BASE = "https://authority.test";

/** Records every request, answers with whatever the case under test needs. */
function stubFetch(reply: (url: string, init?: RequestInit) => { status?: number; body: unknown }) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const { status = 200, body } = reply(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

const REFUSAL: Decision = {
  decision: "BLOCKED_PER_CALL_CAP",
  approved: false,
  failedRule: "perCall.cap",
  reason: "amount 5000 exceeds the per-call cap of 1",
  rules: [
    { rule: "policy.active", result: "PASS" },
    { rule: "perCall.cap", result: "FAIL", observed: 5000, limit: 1 },
  ],
  budget: { limit: 5, spentBefore: 0.4, spentAfter: 0.4, remaining: 4.6 },
};

const APPROVAL: Decision = {
  decision: "APPROVED",
  approved: true,
  failedRule: null,
  reason: "within every limit",
  rules: Array.from({ length: 15 }, (_, i) => ({ rule: `rule.${i}`, result: "PASS" })),
  budget: { limit: 5, spentBefore: 0.4, spentAfter: 0.8, remaining: 4.2 },
  transactionHash: "0x" + "ab".repeat(32),
};

const withTools = async (
  reply: (url: string, init?: RequestInit) => { status?: number; body: unknown },
  run: (tools: ReturnType<typeof createTools>, calls: { url: string; method: string; body: unknown }[]) => Promise<void>
) => {
  const s = stubFetch(reply);
  try {
    await run(createTools(createAuthorityClient(BASE)), s.calls);
  } finally {
    s.restore();
  }
};

// ── the boundary ────────────────────────────────────────────────────────────

test("can_spend reaches the preflight route and never the spending one", async () => {
  await withTools(
    () => ({ body: REFUSAL }),
    async (tools, calls) => {
      await tools.canSpend({ agent: "a1", amount: 5000 });
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /\/authority\/preflight$/);
      assert.ok(!calls.some((c) => c.url.endsWith("/authority/spend")), "a preflight hit the spend route");
    }
  );
});

test("spend reaches the spending route and carries a nonce", async () => {
  await withTools(
    () => ({ body: APPROVAL }),
    async (tools, calls) => {
      await tools.spend({ agent: "a1", amount: 0.4 });
      assert.match(calls[0].url, /\/authority\/spend$/);
      // Without a nonce the authority cannot tell a retry from a fresh request.
      assert.equal(typeof (calls[0].body as { nonce: number }).nonce, "number");
    }
  );
});

test("every read-only tool uses GET, so none of them can write", async () => {
  await withTools(
    (url) => {
      if (url.includes("/score/")) return { body: { subject: "0xdead", score: 70, sigma: 20, lcb: 44, band: "CAUTION", features: [] } };
      if (url.includes("/log")) return { body: { entries: [] } };
      if (url.includes("/escalations")) return { body: { entries: [] } };
      return { body: { agent: "a1", policyId: "1", policyHash: "0x0", rules: { budgets: { daily: 5 }, perCallCap: 1, rateLimit: { callsPerHour: 20 } }, onChain: { status: "ACTIVE", usable: true, version: 1, expiry: "2027-01-01" }, spentToday: 0, remaining: 5, callsInLastHour: 0 } };
    },
    async (tools, calls) => {
      await tools.budget("a1");
      await tools.policy();
      await tools.score("0x000000000000000000000000000000000000dEaD");
      await tools.decisions(5);
      await tools.escalations(5);
      assert.equal(calls.length, 5);
      for (const c of calls) assert.equal(c.method, "GET", `${c.url} was not a GET`);
    }
  );
});

test("the client surfaces the authority's own words, not a wrapper's", async () => {
  const s = stubFetch(() => ({ status: 400, body: { error: "amount must be a positive number of USDT" } }));
  try {
    const client = createAuthorityClient(BASE);
    await assert.rejects(
      () => client.preflight({ agent: "a1", amount: -1 }),
      (e: unknown) => {
        assert.ok(e instanceof AuthorityError);
        assert.equal(e.status, 400);
        assert.equal(e.message, "amount must be a positive number of USDT");
        return true;
      }
    );
  } finally {
    s.restore();
  }
});

test("a trailing slash on the authority url does not double up the path", async () => {
  const s = stubFetch(() => ({ body: REFUSAL }));
  try {
    await createAuthorityClient(`${BASE}///`).preflight({ agent: "a1", amount: 1 });
    assert.equal(s.calls[0].url, `${BASE}/authority/preflight`);
  } finally {
    s.restore();
  }
});

// ── the prose, which is the whole interface ─────────────────────────────────

test("a refusal names the rule and says how far the chain got", async () => {
  await withTools(
    () => ({ body: REFUSAL }),
    async (tools) => {
      const text = await tools.canSpend({ agent: "a1", amount: 5000 });
      assert.match(text, /BLOCKED_PER_CALL_CAP/);
      assert.match(text, /`perCall\.cap`/);
      // "2 of 15" — a model that is told 15 rules ran learns nothing about
      // short-circuiting, which is the property that makes the trace readable.
      assert.match(text, /2 of 15 rules/);
      assert.match(text, /never consulted/);
      assert.match(text, /Observed 5000 against a limit of 1/);
    }
  );
});

test("a refusal never reports a transaction", async () => {
  await withTools(
    () => ({ body: REFUSAL }),
    async (tools) => {
      const text = await tools.spend({ agent: "a1", amount: 5000 });
      assert.ok(!/Transaction 0x/.test(text), "a refusal claimed a transaction");
      assert.ok(!/APPROVED/.test(text), "a refusal read as an approval");
    }
  );
});

test("an approval reports the hash and the budget it just moved", async () => {
  await withTools(
    () => ({ body: APPROVAL }),
    async (tools) => {
      const text = await tools.spend({ agent: "a1", amount: 0.4 });
      assert.match(text, /APPROVED\. All 15 rules passed\./);
      assert.match(text, new RegExp(`Transaction ${APPROVAL.transactionHash}`));
      assert.match(text, /\$0\.80 of \$5\.00 used today, \$4\.20 left/);
    }
  );
});

test("a held spend says it is held, that nothing moved, and not to retry", async () => {
  /*
   * The most consequential sentence in the package. An agent that reads an
   * escalation as a refusal gives up on a payment a human was about to
   * approve; one that reads it as a failure retries, and every retry raises
   * another escalation for a person to work through.
   */
  const held: Decision = {
    ...REFUSAL,
    decision: "ESCALATED_VENDOR_RISK",
    failedRule: "vendor.lcbFloor",
    reason: "vendor LCB 19.5 below floor 20",
    escalation: { id: "esc_abc", expiresAt: "2026-08-12T00:00:00.000Z" },
  };
  await withTools(
    () => ({ body: held }),
    async (tools) => {
      const text = await tools.spend({ agent: "a1", amount: 0.2 });
      assert.match(text, /HELD for a human/);
      assert.match(text, /nothing has been charged and nothing has moved/i);
      assert.match(text, /Do not retry it/);
      assert.match(text, /esc_abc/);
    }
  );
});

test("an execution failure is reported as one, not swallowed into the verdict", async () => {
  await withTools(
    () => ({ body: { ...APPROVAL, transactionHash: undefined, executionError: "insufficient gas sponsorship" } }),
    async (tools) => {
      const text = await tools.spend({ agent: "a1", amount: 0.4 });
      assert.match(text, /The execution failed: insufficient gas sponsorship/);
    }
  );
});

test("the score summary puts the bound in front, not the score", async () => {
  /*
   * Enforcement compares the lower bound. A summary that leads with the point
   * estimate teaches a model to predict approvals from the wrong number, and
   * the whole reason the bound exists is that thin evidence should tighten the
   * limit rather than flatter it.
   */
  await withTools(
    () => ({
      body: {
        subject: "0x000000000000000000000000000000000000dEaD",
        score: 70.2,
        sigma: 20.4,
        lcb: 44.1,
        band: "CAUTION",
        features: [
          { key: "track_record_depth", value: 80, implemented: true },
          { key: "settlement_consistency", value: 90, implemented: true },
          { key: "dispute_signal", value: 100, implemented: true },
          { key: "wallet_operational_profile", value: 60, implemented: true },
          { key: "kyb_status", value: 50, implemented: false },
          { key: "chargeback_history", value: 50, implemented: false },
          { key: "external_attestations", value: 50, implemented: false },
        ],
      },
    }),
    async (tools) => {
      const text = await tools.score("0x000000000000000000000000000000000000dEaD");
      assert.match(text, /lower bound 44\.1/);
      assert.match(text, /compares the BOUND, never the score/);
      assert.match(text, /4 observed signals/);
      assert.match(text, /3 carried as priors/);
      assert.match(text, /widens sigma rather than flattering the score/);
    }
  );
});

test("an unreadable registry is said out loud, not rendered as ACTIVE", async () => {
  await withTools(
    () => ({
      body: {
        agent: "a1",
        policyId: "1",
        policyHash: "0xabc",
        rules: { budgets: { daily: 5 }, perCallCap: 1, rateLimit: { callsPerHour: 20 } },
        onChain: { error: "RPC timeout" },
        spentToday: 1.5,
        remaining: 3.5,
        callsInLastHour: 2,
      },
    }),
    async (tools) => {
      assert.match(await tools.budget("a1"), /UNREADABLE/);
      assert.match(await tools.policy(), /could not be read: RPC timeout/);
    }
  );
});

test("an empty record says so rather than returning a blank", async () => {
  await withTools(
    () => ({ body: { entries: [] } }),
    async (tools) => {
      assert.match(await tools.decisions(10, "nobody"), /No decisions on record/);
      assert.match(await tools.escalations(10, "nobody"), /Nothing is currently held/);
    }
  );
});

test("the decision record keeps refusals and marks that they moved nothing", async () => {
  await withTools(
    () => ({
      body: {
        entries: [
          { at: "2026-08-11T00:00:00Z", decision: "APPROVED", failedRule: null, amount: 0.4, recipient: "0xdead", transactionHash: "0xfeed" },
          { at: "2026-08-11T00:01:00Z", decision: "BLOCKED_CATEGORY", failedRule: "category.allow", amount: 0.4, recipient: "0xdead" },
        ],
      },
    }),
    async (tools) => {
      const text = await tools.decisions(10, "a1");
      assert.match(text, /APPROVED.*tx 0xfeed/);
      assert.match(text, /BLOCKED_CATEGORY \(category\.allow\).*nothing moved/);
    }
  );
});

test("limits are clamped, so a hostile argument cannot page the whole record", async () => {
  await withTools(
    () => ({ body: { entries: [] } }),
    async (tools, calls) => {
      await tools.decisions(5000);
      await tools.decisions(-1);
      await tools.escalations(5000);
      assert.match(calls[0].url, /limit=50/);
      assert.match(calls[1].url, /limit=1/);
      assert.match(calls[2].url, /limit=50/);
    }
  );
});

test("escalations are only ever listed as PENDING", async () => {
  // A resolved escalation in a list headed "waiting on a human" would send an
  // operator to answer something already answered.
  await withTools(
    () => ({ body: { entries: [] } }),
    async (tools, calls) => {
      await tools.escalations(10, "a1");
      assert.match(calls[0].url, /status=PENDING/);
    }
  );
});

// ── configuration and registration ──────────────────────────────────────────

test("with no configuration at all the tools point at the live authority", () => {
  // The read-only half must work for someone who holds no credential and has
  // set nothing up, or it is useless to the person most in need of it.
  assert.equal(loadConfig({}).authorityUrl, DEFAULT_AUTHORITY);
  assert.match(DEFAULT_AUTHORITY, /^https:\/\//);
});

test("the authority url is overridable, with MANDATE_ taking precedence", () => {
  assert.equal(loadConfig({ AUTHORITY_URL: "https://b.test" }).authorityUrl, "https://b.test");
  assert.equal(
    loadConfig({ AUTHORITY_URL: "https://b.test", MANDATE_AUTHORITY_URL: "https://a.test" }).authorityUrl,
    "https://a.test"
  );
});

test("the server registers exactly the seven tools, each with a description", async () => {
  const server = createServer({ authorityUrl: BASE });
  const registered = (server as unknown as { _registeredTools: Record<string, { description?: string }> })
    ._registeredTools;
  const names = Object.keys(registered).sort();
  assert.deepEqual(names, [
    "mandate_budget",
    "mandate_can_spend",
    "mandate_decisions",
    "mandate_escalations",
    "mandate_policy",
    "mandate_score",
    "mandate_spend",
  ]);
  // A model choosing between these has only the description to go on.
  for (const [name, tool] of Object.entries(registered)) {
    assert.ok((tool.description?.length ?? 0) > 80, `${name} has no usable description`);
  }
  assert.match(registered.mandate_can_spend.description!, /writes nothing/);
  assert.match(registered.mandate_spend.description!, /binding/);
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});
