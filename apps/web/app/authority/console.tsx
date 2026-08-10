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

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RuleChain } from "@/components/rule-chain";
import { DEPLOYMENT, tx as txUrl, address as addressUrl, short } from "@/lib/outcome";
import { cn } from "@/lib/utils";

const GATEWAY =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "https://gateway-production-944e.up.railway.app";

/**
 * This browser's agent under the shared policy.
 *
 * One policy, many agents, each with its own budget and duplicate window -- so
 * two people trying this at once are not fighting over the same $5 and the same
 * hour-long duplicate lock. Before this, the first visitor to buy market data
 * locked that exact purchase for everyone else for an hour and the button
 * labelled "inside every limit" answered BLOCKED_DUPLICATE to the next person.
 *
 * Kept in localStorage rather than a cookie so it survives a reload -- which is
 * the whole demonstration. The spend is still gone when you come back because
 * you are still the same agent.
 */
function agentId(): string {
  if (typeof window === "undefined") return "shared";
  const KEY = "outcome.agent";
  let id = window.localStorage.getItem(KEY);
  if (!id || !/^[a-z0-9][a-z0-9_-]{2,63}$/i.test(id)) {
    id = `agent-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(KEY, id);
  }
  return id;
}

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
  vendor?: {
    payee: string;
    lcb: number;
    score: number;
    sigma: number;
    band: string;
    floor: number;
    features: { key: string; value: number; weightApplied: number; observed: boolean; note: string }[];
  };
  escalation?: { id: string; code: string; expiresAt: string };
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
  vendorFloor: number | null;
};

type Escalation = {
  id: string;
  status: string;
  decision: string;
  reason: string;
  amount: number;
  recipient: string;
  expiresAt: string;
  transactionHash?: string;
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
  {
    /*
     * A payee this system has never paid. The bureau scores it from no history
     * at all, the lower bound lands under the floor, and the policy escalates
     * rather than refusing -- which is the honest answer: unknown is not the
     * same as untrustworthy, and it is a question for a person.
     */
    label: "Pay someone new",
    sub: "$0.20 · no history — needs a human",
    escalates: true,
    body: { amount: 0.2, category: "market-data", endpoint: "https://api.example.com/v1/new" },
  },
] as const;

/** The policy owner. Only a bound operator can release a held spend. */
const OPERATOR = "0x7A2E11B3ECEBaB8Ea46966eDaDD4092583809b67";

const money = (n: number) => `$${n.toFixed(2)}`;

/** A payee nobody has paid before, so the bureau has genuinely nothing on it. */
function randomPayee(): string {
  const b = new Uint8Array(20);
  crypto.getRandomValues(b);
  return `0x${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function AuthorityConsole() {
  const [state, setState] = useState<State | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [held, setHeld] = useState<Escalation[]>([]);
  /** The code is returned once, at creation, so the page has to keep it. */
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [resolving, setResolving] = useState<string | null>(null);
  /*
   * An in-flight guard that does not wait for a render.
   *
   * `disabled={busy !== null}` is set from state, and state lands on the next
   * render — so two clicks inside the same frame both get through, the second
   * request hits the server's throttle, and the user is shown "one decision at
   * a time" for doing nothing worse than double-clicking. A ref flips
   * synchronously, so the second click is dropped before a request exists.
   */
  const inFlight = useRef(false);
  /** Seconds the current request has been running, so a wait never looks hung. */
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (busy === null && resolving === null) {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [busy, resolving]);

  const refresh = useCallback(async () => {
    try {
      const a = agentId();
      const [s, l, e] = await Promise.all([
        fetch(`${GATEWAY}/authority?agent=${a}`).then((r) => r.json()),
        fetch(`${GATEWAY}/authority/log?limit=12&agent=${a}`).then((r) => r.json()),
        fetch(`${GATEWAY}/authority/escalations?limit=5&agent=${a}`).then((r) => r.json()),
      ]);
      if (s.error) setError(s.error);
      else {
        setState(s);
        setError(null);
      }
      setLog(l.entries ?? []);
      setHeld((e.entries ?? []).filter((x: Escalation) => x.status === "PENDING"));
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
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(i);
    setOutcome(null);
    setError(null);
    try {
      const res = await fetch(`${GATEWAY}/authority/spend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...SPENDS[i].body,
          agent: agentId(),
          /*
           * A different unknown payee every time. Reusing one would make it
           * known after the first release -- the score would rise and the case
           * would stop escalating, which is correct behaviour and a useless
           * button.
           */
          ...("escalates" in SPENDS[i] && SPENDS[i].escalates
            ? { recipient: randomPayee() }
            : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? `gateway returned ${res.status}`);
      else {
        setOutcome(body);
        // Held spends carry a single-use code the server never returns again.
        if (body.escalation?.id) {
          setCodes((c) => ({ ...c, [body.escalation.id]: body.escalation.code }));
        }
        /*
         * Apply the server's own figures immediately.
         *
         * The verdict used to appear while the header still showed the old
         * budget, because everything except the verdict waited on a refetch --
         * so for about a second the panel said "budget after this spend $0.40"
         * directly under a header reading $0.00. The response already carries
         * the authoritative number; waiting to be told it again is a lag with
         * nothing to gain. The refetch still runs underneath and reconciles.
         */
        setState((prev) =>
          prev
            ? {
                ...prev,
                spentToday: body.budget.spentAfter,
                remaining: body.budget.remaining,
                callsInLastHour: body.callsInLastHour ?? prev.callsInLastHour,
              }
            : prev
        );
        if (body.escalation?.id) {
          // Show the held spend the moment it exists, for the same reason.
          setHeld((h) => [
            {
              id: body.escalation.id,
              status: "PENDING",
              decision: body.decision,
              reason: body.reason,
              amount: body.budget ? SPENDS[i].body.amount : 0,
              recipient: body.vendor?.payee ?? "",
              expiresAt: body.escalation.expiresAt,
            },
            ...h.filter((x) => x.id !== body.escalation.id),
          ]);
        }
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function resolve(id: string, action: "APPROVE" | "DENY") {
    if (inFlight.current) return;
    inFlight.current = true;
    setResolving(id);
    setError(null);
    try {
      const res = await fetch(`${GATEWAY}/authority/escalation/${id}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: codes[id], operator: OPERATOR, action }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? `gateway returned ${res.status}`);
      else if (body.outcome !== "APPROVED" && body.outcome !== "DENIED") {
        // The ignored outcomes are the interesting ones: the service verified
        // the response and declined to honour it, and says which check refused.
        setError(`${body.outcome}: ${body.detail}`);
      } else {
        // Drop the released row and take the new budget straight from the
        // response, rather than leaving a resolved spend on screen until the
        // refetch lands.
        setHeld((h) => h.filter((x) => x.id !== id));
        if (body.transactionHash) {
          setOutcome((o) => (o ? { ...o, transactionHash: body.transactionHash } : o));
        }
        if (body.budget) {
          setState((prev) =>
            prev
              ? { ...prev, spentToday: body.budget.spentAfter, remaining: body.budget.remaining }
              : prev
          );
        }
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setResolving(null);
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
      <p className="text-[12px] leading-relaxed text-[var(--ink-3)]">
        A refusal is instant — nothing reaches the chain. An <em>approval</em> is a real Sepolia
        transfer signed by KeeperHub, so it takes roughly 20–40 seconds. The timer is on the button.
      </p>

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
            {busy === i && (
              <span className="flex shrink-0 items-center gap-2 text-[12px] text-[var(--ink-3)]">
                <Loader2 className="size-4 animate-spin" />
                <span className="figure">{elapsed}s</span>
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-[10px] border border-[var(--refused-line)] bg-[var(--refused-wash)] p-4 text-sm text-[var(--refused)]">
          {error}
        </p>
      )}

      {/* ── Held spends, waiting on a person ──────────────────────────── */}
      {held.length > 0 && (
        <div className="card-p card-p--bordered p-5 ring-1 ring-[var(--brand)]/25">
          <p className="field-label">Waiting on you</p>
          <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-[var(--ink-2)]">
            The engine would neither approve nor refuse these. Nothing is charged and nothing has
            moved; releasing one spends it, and the budget is charged then rather than now — so a
            held spend nobody answers costs nothing.
          </p>

          <div className="mt-4 space-y-2">
            {held.map((h) => (
              <div
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {money(h.amount)} to <span className="figure">{short(h.recipient, 6, 4)}</span>
                  </p>
                  <p className="text-[12px] text-[var(--ink-3)]">{h.reason}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {resolving === h.id ? (
                    <span className="flex items-center gap-2 text-[12px] text-[var(--ink-3)]">
                      <Loader2 className="size-4 animate-spin" />
                      <span className="figure">{elapsed}s</span>
                    </span>
                  ) : codes[h.id] ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => void resolve(h.id, "DENY")}>
                        Deny
                      </Button>
                      <Button size="sm" onClick={() => void resolve(h.id, "APPROVE")}>
                        Release it
                      </Button>
                    </>
                  ) : (
                    /*
                     * A held spend this browser cannot action.
                     *
                     * The approval code is returned exactly once, at creation,
                     * and only its sha256 is stored -- so a spend raised in an
                     * earlier session is genuinely unreleasable from here. That
                     * is the correct security property and it used to render as
                     * two dead buttons with no explanation, which reads as a
                     * bug. Say what happened instead.
                     */
                    <span className="max-w-[220px] text-right text-[11px] leading-snug text-[var(--ink-4)]">
                      Raised in an earlier session — the single-use code was shown once and is not
                      held here. It expires on its own.
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="mt-3 border-t border-[var(--line)] pt-3 text-[12px] leading-relaxed text-[var(--ink-3)]">
            Releasing needs the bound operator and the single-use code this page was handed once. The
            server stores only its sha256, re-checks both, and relaxes <em>only</em> the rule that
            escalated — the budget, the per-call cap and the rate limit are all still enforced.
          </p>
        </div>
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

          {/*
            * What the vendor floor actually compared.
            *
            * The bound, not the score. A payee can sit at 68 and still be
            * refused because three of the seven signals are priors and the
            * uncertainty they carry drags the bound below the floor -- which is
            * the entire point of enforcing on the lower bound, and impossible
            * to see from a verdict alone.
            */}
          {outcome.vendor && (
            <div className="mt-5 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="field-label">What the payee scored</p>
                <span className="text-[11px] text-[var(--ink-4)]">{outcome.vendor.band}</span>
              </div>
              <p className="figure mt-1 text-sm">
                score {outcome.vendor.score.toFixed(1)} − 1.28 × σ {outcome.vendor.sigma.toFixed(1)}{" "}
                ={" "}
                <span
                  className={cn(
                    "font-semibold",
                    outcome.vendor.lcb >= outcome.vendor.floor
                      ? "text-[var(--proven)]"
                      : "text-[var(--refused)]"
                  )}
                >
                  {outcome.vendor.lcb.toFixed(1)}
                </span>{" "}
                <span className="text-[var(--ink-4)]">vs floor {outcome.vendor.floor}</span>
              </p>

              <div className="mt-3 space-y-1">
                {outcome.vendor.features.map((f) => (
                  <div key={f.key} className="flex items-center gap-3 text-[11px]">
                    <span
                      className={cn(
                        "w-[52px] shrink-0",
                        f.observed ? "text-[var(--ink-3)]" : "text-[var(--ink-4)]"
                      )}
                    >
                      {f.observed ? "observed" : "prior"}
                    </span>
                    <span className="figure w-[190px] shrink-0 truncate">{f.key}</span>
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--panel)]">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${f.value}%`,
                          background: f.observed ? "var(--brand)" : "var(--line-2)",
                        }}
                      />
                    </span>
                    <span className="figure w-[34px] shrink-0 text-right text-[var(--ink-3)]">
                      {f.value.toFixed(0)}
                    </span>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-[11px] leading-relaxed text-[var(--ink-4)]">
                Three signals have no honest source here, so they are carried as priors: they
                contribute nothing to the score and widen σ instead. Missing evidence tightens the
                floor rather than relaxing it.
              </p>
            </div>
          )}

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
