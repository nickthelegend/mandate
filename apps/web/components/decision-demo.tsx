"use client";

/**
 * The authority, judged live in the visitor's own browser.
 *
 * Pick a spend, watch the chain run, see which rule refuses it. This is the
 * real `outcome-policy` engine — the same fifteen rules that gate the on-chain
 * executions, running client-side with no server in the path, so the verdict a
 * judge sees is computed in front of them rather than fetched from somewhere
 * that could have made it up.
 *
 * The cases are the ones worth showing: an ordinary approved spend, and the
 * four distinct ways a policy refuses one. Each names its own rule, because
 * "refused" is not an answer anybody can act on.
 */

import { useMemo, useState } from "react";
import { evaluateIntent } from "outcome-policy";

import { RuleChain } from "@/components/rule-chain";
import { cn } from "@/lib/utils";

const b32 = (x: string) => `0x${x.repeat(32)}`;

/** The policy every case below is judged against. */
const POLICY = {
  id: "agent-alpha",
  version: 2,
  status: "ACTIVE",
  rules: {
    budgets: { daily: 25, token: "USDT" },
    perCallCap: 5,
    onPerCallCapExceeded: "BLOCK",
    escalateAbove: 1000,
    categories: { allow: ["market-data"], deny: [] },
    recipients: { allow: [], deny: [] },
    agents: { allowWorkerIds: [], denyWorkerIds: [] },
    duplicates: { ttlMin: 60, keys: ["taskHash", "endpoint", "paramsHash"] },
    cooldowns: { sameServiceMin: 5 },
    rateLimit: { callsPerHour: 40 },
    expiry: "2999-12-31T00:00:00Z",
  },
} as const;

const BASE_INTENT = {
  owner: "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67",
  buyerAgentId: 1n,
  workerAgentId: 0n,
  token: "0x49C86277a91002c4943837bf20F6ED41976Db09F",
  maxAmount: 1_000_000n,
  taskHash: b32("11"),
  acceptanceHash: b32("22"),
  schemaHash: b32("33"),
  policyHash: b32("44"),
  deadline: 9_999_999_999n,
  nonce: 1n,
  endpoint: "https://api.example.com/v1/data?b=2&a=1",
  paramsHash: b32("55"),
  recipientAddress: "0x000000000000000000000000000000000000dEaD",
  category: "market-data",
  amount: 0.05,
};

const EMPTY_LEDGER = {
  budgetUsage: { settledToday: 0, reservedActiveToday: 0, effectiveToday: 0 },
  recentIntents: [],
  lastCallByService: {},
  callsInLastHour: 0,
};

/** Each case changes exactly one thing, so the rule it trips is unambiguous. */
const CASES = [
  {
    id: "ok",
    label: "A $0.05 data call",
    note: "Inside every limit.",
    policy: POLICY,
    intent: BASE_INTENT,
    ledger: EMPTY_LEDGER,
  },
  {
    id: "cap",
    label: "Agent tries to spend $5,000",
    note: "A prompt-injected agent asking for the whole treasury.",
    policy: POLICY,
    intent: { ...BASE_INTENT, amount: 5000 },
    ledger: EMPTY_LEDGER,
  },
  {
    id: "budget",
    label: "Today's budget already spent",
    note: "$25 of $25 gone. The next call is not a judgement call.",
    policy: POLICY,
    intent: BASE_INTENT,
    ledger: {
      ...EMPTY_LEDGER,
      budgetUsage: { settledToday: 25, reservedActiveToday: 0, effectiveToday: 25 },
    },
  },
  {
    id: "category",
    label: "Buying outside its remit",
    note: "The policy allows market-data. This is compute.",
    policy: POLICY,
    intent: { ...BASE_INTENT, category: "compute" },
    ledger: EMPTY_LEDGER,
  },
  {
    id: "rate",
    label: "Looping — 40 calls this hour",
    note: "A runaway agent hammering the same endpoint.",
    policy: { ...POLICY, rules: { ...POLICY.rules, rateLimit: { callsPerHour: 40 } } },
    intent: BASE_INTENT,
    ledger: { ...EMPTY_LEDGER, callsInLastHour: 40 },
  },
  {
    id: "paused",
    label: "Kill switch pulled on chain",
    note: "The policy is paused in the registry. Nothing is judged at all.",
    policy: { ...POLICY, status: "PAUSED" },
    intent: BASE_INTENT,
    ledger: EMPTY_LEDGER,
  },
] as const;

export function DecisionDemo() {
  const [active, setActive] = useState(0);
  const chosen = CASES[active];

  const decision = useMemo(() => {
    // The real engine. No server, no fixture — judged here, now.
    return evaluateIntent(
      chosen.intent as never,
      chosen.policy as never,
      chosen.ledger as never
    );
  }, [chosen]);

  const failed = decision.rules.find((r) => r.result === "FAIL")?.rule ?? null;
  const approved = decision.decision === "APPROVED";

  return (
    <div className="card-p card-p--bordered overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[260px_1fr]">
        <div className="border-b border-[var(--line)] p-3 md:border-b-0 md:border-r">
          <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--ink-4)]">
            Try a spend
          </p>
          <div className="flex gap-1.5 overflow-x-auto md:flex-col md:overflow-visible">
            {CASES.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActive(i)}
                aria-pressed={i === active}
                className={cn(
                  "whitespace-nowrap rounded-[10px] px-3 py-2 text-left text-[13px] transition-colors md:whitespace-normal",
                  i === active
                    ? "bg-[var(--brand-wash)] font-medium text-[var(--brand-ink)]"
                    : "text-[var(--ink-2)] hover:bg-[var(--panel)]"
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span
              className={cn(
                "verdict",
                approved ? "verdict--proven" : "verdict--not_proven"
              )}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="10" r="8" />
                {!approved && <path d="M3 17 L17 3" stroke="currentColor" strokeWidth="2.5" />}
              </svg>
              {decision.decision}
            </span>
            <span className="text-[12px] text-[var(--ink-4)]">
              judged in your browser · no server
            </span>
          </div>

          <p className="mt-3 text-[13px] leading-relaxed text-[var(--ink-2)]">{chosen.note}</p>

          <RuleChain className="mt-5" failedAt={failed} decision={decision.decision} />
        </div>
      </div>
    </div>
  );
}
