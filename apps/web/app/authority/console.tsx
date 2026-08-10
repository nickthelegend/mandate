"use client";

/**
 * The authority, operable.
 *
 * `/` argues that an agent can be given a budget it cannot exceed, and the
 * decision demo on that page runs the real engine -- but against a ledger it
 * makes up on the spot. Every case starts from zero spent, which is fine for
 * showing what the fifteen rules do and proves nothing about enforcement. A
 * budget that resets whenever you look at it is not a budget.
 *
 * This is the same authority with nothing supplied by the visitor. The policy
 * is read from PolicyRegistry on Sepolia, the ledger is in MongoDB, and an
 * approved spend moves real tUSDC through KeeperHub. Spend it down and the
 * refusal at the end is the `budget.daily` rule reading a number that was
 * already there before the page loaded.
 *
 * The reload button is not a convenience. It is the argument: press it, and
 * the spend is still gone.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RuleChain } from "@/components/rule-chain";
import { DEPLOYMENT, tx as txUrl, address as addressUrl, short } from "@/lib/outcome";
import { cn } from "@/lib/utils";

const GATEWAY =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "https://gateway-production-944e.up.railway.app";

type RuleTrace = {
  rule: string;
  result: string;
  observed?: string | number;
  limit?: string | number;
  token?: string;
  matchedList?: string;
  ttlRemainingSec?: number;
  priorIntentId?: string;
};

type Outcome = {
  decision: string;
  approved: boolean;
  failedRule: string | null;
  reason: string;
  intentHash: string;
  rules: RuleTrace[];
  budget: { limit: number; spentBefore: number; spentAfter: number; remaining: number };
  callsInLastHour: number;
  anchor: { registry: string; policyHash: string; onChainStatus: string; usable: boolean };
  executionId?: string;
  transactionHash?: string;
  executionError?: string;
};

type State = {
  policyId: string;
  policyHash: string;
  rules: {
    budgets: { daily: number; token: string };
    perCallCap: number;
    rateLimit: { callsPerHour: number };
    categories: { allow: string[] };
    duplicates: { ttlMin: number };
  };
  onChain: { status?: string; usable?: boolean; version?: number; expiry?: string; error?: string };
  spentToday: number;
  remaining: number;
  callsInLastHour: number;
  decisions: { total: number; approved: number; refused: number };
};

type LogRow = {
  at: string;
  decision: string;
  failedRule: string | null;
  reason: string;
  amount: number;
  endpoint: string;
  category: string;
  transactionHash?: string;
};

/**
 * The spends on offer.
 *
 * Each is one honest request, not a scripted outcome -- what comes back depends
 * entirely on what the ledger already holds. The $0.40 button approves on a
 * fresh day and is refused once the budget runs low, and neither is decided
 * here.
 */
const SPENDS = [
  {
    label: "Buy market data",
    sub: "$0.40 · inside every limit",
    body: { amount: 0.4, category: "market-data", endpoint: "https://api.example.com/v1/prices" },
  },
  {
    label: "Buy the same thing again",
    sub: "$0.40 · identical request",
    body: { amount: 0.4, category: "market-data", endpoint: "https://api.example.com/v1/prices" },
  },
  {
    label: "Spend $5,000",
    sub: "a prompt-injected agent",
    body: { amount: 5000, category: "market-data", endpoint: "https://api.example.com/v1/prices" },
  },
  {
    label: "Buy GPU time",
    sub: "$0.40 · outside its remit",
    body: { amount: 0.4, category: "compute", endpoint: "https://api.example.com/v1/gpu" },
  },
] as const;

const money = (n: number) => `$${n.toFixed(2)}`;

export function AuthorityConsole() {
  const [state, setState] = useState<State | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        fetch(`${GATEWAY}/authority`).then((r) => r.json()),
        fetch(`${GATEWAY}/authority/log?limit=12`).then((r) => r.json()),
      ]);
      if (s.error) setError(s.error);
      else {
        setState(s);
        setError(null);
      }
      setLog(l.entries ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function spend(i: number) {
    setBusy(i);
    setOutcome(null);
    setError(null);
    try {
      const res = await fetch(`${GATEWAY}/authority/spend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(SPENDS[i].body),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? `gateway returned ${res.status}`);
      else setOutcome(body);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const limit = state?.rules.budgets.daily ?? 5;
  const spent = state?.spentToday ?? 0;
  const pct = Math.min(100, (spent / limit) * 100);
  const paused = state ? state.onChain.status !== "ACTIVE" : false;

  return (
    <div className="space-y-6">
      {/* ── The budget, as it actually stands ─────────────────────────── */}
      <div className="card-p card-p--bordered p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="field-label">Spent today, from the persisted ledger</p>
            <p className="mt-1 text-3xl font-medium tracking-tight">
              <span className="figure">{money(spent)}</span>
              <span className="text-[var(--ink-4)]"> / {money(limit)}</span>
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
            className="gap-2"
            aria-label="Reload from the server"
          >
            <RotateCw className="size-3.5" />
            Reload the page state
          </Button>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--panel)]">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${pct}%`,
              background: pct >= 100 ? "var(--refused)" : "var(--brand)",
            }}
          />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
          {[
            ["Remaining", money(state?.remaining ?? limit)],
            ["Per call", money(state?.rules.perCallCap ?? 1)],
            [
              "Calls this hour",
              `${state?.callsInLastHour ?? 0} / ${state?.rules.rateLimit.callsPerHour ?? 20}`,
            ],
            [
              "Decisions on record",
              `${state?.decisions.total ?? 0} (${state?.decisions.refused ?? 0} refused)`,
            ],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="field-label">{k}</dt>
              <dd className="figure mt-0.5">{v}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-4 border-t border-[var(--line)] pt-3 text-[12px] leading-relaxed text-[var(--ink-3)]">
          This number is in MongoDB, not in this page. Reload, open it in another
          browser, or come back tomorrow — the spend is still gone, and it resets
          only when the UTC day rolls.
        </p>
      </div>

      {/* ── The anchor ────────────────────────────────────────────────── */}
      <div
        className={cn(
          "card-p card-p--bordered flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-[13px]",
          paused && "ring-1 ring-[var(--refused-line)]"
        )}
      >
        <span
          className={cn("verdict", paused ? "verdict--not_proven" : "verdict--proven")}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="8" />
            {paused && <path d="M3 17 L17 3" stroke="currentColor" strokeWidth="2.5" />}
          </svg>
          {loading ? "reading chain" : paused ? "PAUSED ON CHAIN" : "ACTIVE ON CHAIN"}
        </span>
        <span className="text-[var(--ink-3)]">
          Policy{" "}
          <a
            href={addressUrl(DEPLOYMENT.registry)}
            target="_blank"
            rel="noopener"
            className="figure underline-offset-4 hover:text-[var(--ink)] hover:underline"
          >
            {state ? short(state.policyHash, 8, 6) : "…"}
          </a>{" "}
          in PolicyRegistry, Sepolia
        </span>
        {state?.onChain.expiry && (
          <span className="text-[var(--ink-4)]">
            expires {state.onChain.expiry.slice(0, 10)}
          </span>
        )}
      </div>

      {/* ── The spends ────────────────────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2">
        {SPENDS.map((s, i) => (
          <button
            key={s.label}
            type="button"
            disabled={busy !== null}
            onClick={() => void spend(i)}
            className={cn(
              "group flex items-center justify-between gap-3 rounded-[10px] border border-[var(--line)] bg-[var(--card)] px-4 py-3 text-left transition-colors",
              "hover:border-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            <span>
              <span className="block text-sm font-medium">{s.label}</span>
              <span className="block text-[12px] text-[var(--ink-3)]">{s.sub}</span>
            </span>
            {busy === i && <Loader2 className="size-4 shrink-0 animate-spin" />}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-[10px] border border-[var(--refused-line)] bg-[var(--refused-wash)] p-4 text-sm text-[var(--refused)]">
          {error}
        </p>
      )}

      {/* ── The decision ──────────────────────────────────────────────── */}
      {outcome && (
        <div className="card-p card-p--bordered p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span
              className={cn(
                "verdict",
                outcome.approved ? "verdict--proven" : "verdict--not_proven"
              )}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="10" r="8" />
                {!outcome.approved && (
                  <path d="M3 17 L17 3" stroke="currentColor" strokeWidth="2.5" />
                )}
              </svg>
              {outcome.decision}
            </span>
            <span className="text-[12px] text-[var(--ink-4)]">
              judged on the server, against the chain and the ledger
            </span>
          </div>

          <p className="mt-3 text-[13px] leading-relaxed text-[var(--ink-2)]">{outcome.reason}</p>

          {/* Only an approval moved money, and only a hash proves it did. */}
          {outcome.transactionHash ? (
            <div className="settlement mt-4">
              <div>
                <p className="field-label">Budget after this spend</p>
                <p className="figure mt-1">
                  {money(outcome.budget.spentAfter)} of {money(outcome.budget.limit)}
                </p>
              </div>
              <div>
                <p className="field-label">What moved on Sepolia</p>
                <a
                  href={txUrl(outcome.transactionHash)}
                  target="_blank"
                  rel="noopener"
                  className="figure mt-1 block break-all underline-offset-4 hover:text-[var(--ink)] hover:underline"
                >
                  {short(outcome.transactionHash, 10, 8)} →
                </a>
              </div>
            </div>
          ) : outcome.executionError ? (
            <p className="mt-4 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3 text-[12px] text-[var(--ink-3)]">
              Authorised, but the execution did not confirm: {outcome.executionError}. The budget
              stays charged — un-charging a failed execution would make retries free.
            </p>
          ) : null}

          <RuleChain
            className="mt-5"
            failedAt={outcome.failedRule}
            decision={outcome.decision}
          />

          {/* The refusing rule's own numbers, which is what makes it checkable. */}
          {(() => {
            const f = outcome.rules.find((r) => r.result === "FAIL");
            if (!f || (f.observed === undefined && f.priorIntentId === undefined)) return null;
            return (
              <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--line)] pt-3 text-[12px]">
                {f.observed !== undefined && (
                  <div>
                    <dt className="field-label">Observed</dt>
                    <dd className="figure">
                      {f.observed} {f.token ?? ""}
                    </dd>
                  </div>
                )}
                {f.limit !== undefined && (
                  <div>
                    <dt className="field-label">Limit</dt>
                    <dd className="figure">
                      {f.limit} {f.token ?? ""}
                    </dd>
                  </div>
                )}
                {f.priorIntentId && (
                  <div>
                    <dt className="field-label">Prior intent</dt>
                    <dd className="figure">{f.priorIntentId}</dd>
                  </div>
                )}
                {f.ttlRemainingSec !== undefined && (
                  <div>
                    <dt className="field-label">TTL remaining</dt>
                    <dd className="figure">{Math.round(f.ttlRemainingSec / 60)}m</dd>
                  </div>
                )}
              </dl>
            );
          })()}
        </div>
      )}

      {/* ── The record ────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Every decision, kept</h2>
        <p className="mt-2 max-w-[60ch] text-[13px] leading-relaxed text-[var(--ink-3)]">
          Refusals as well as approvals. A record that keeps only what it allowed
          cannot answer the question an audit actually asks — what did this agent
          try to do, and what stopped it.
        </p>

        <div className="mt-4 overflow-x-auto rounded-[10px] border border-[var(--line)]">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--surface)] text-left text-[12px] font-medium text-[var(--ink-3)]">
                <th className="px-4 py-2.5 font-medium">When</th>
                <th className="px-4 py-2.5 font-medium">Asked for</th>
                <th className="px-4 py-2.5 font-medium">Decision</th>
                <th className="px-4 py-2.5 font-medium">Stopped by</th>
                <th className="px-4 py-2.5 font-medium">On chain</th>
              </tr>
            </thead>
            <tbody>
              {log.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[var(--ink-4)]">
                    {loading ? "reading the record…" : "no decisions on record yet"}
                  </td>
                </tr>
              )}
              {log.map((r) => (
                <tr key={r.at + r.decision} className="border-b border-[var(--line)] last:border-0">
                  <td className="figure px-4 py-2.5 text-xs whitespace-nowrap">
                    {r.at.slice(11, 19)}
                  </td>
                  <td className="figure px-4 py-2.5 text-xs">
                    {money(r.amount)} · {r.category}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={cn(
                        "text-xs font-medium",
                        r.decision === "APPROVED"
                          ? "text-[var(--proven)]"
                          : "text-[var(--refused)]"
                      )}
                    >
                      {r.decision}
                    </span>
                  </td>
                  <td className="figure px-4 py-2.5 text-xs text-[var(--ink-3)]">
                    {r.failedRule ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {r.transactionHash ? (
                      <a
                        href={txUrl(r.transactionHash)}
                        target="_blank"
                        rel="noopener"
                        className="figure underline-offset-4 hover:text-[var(--ink)] hover:underline"
                      >
                        {short(r.transactionHash, 6, 4)}
                      </a>
                    ) : (
                      <span className="text-[var(--ink-4)]">nothing moved</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
