"use client";

/**
 * Watch the agent work.
 *
 * A payer posts a job, escrows against it, and walks away. The agent finds the
 * intent, does the work through KeeperHub, hands the verifier a transaction
 * hash, and is paid only because the transfer was proven.
 *
 * It holds no private key and no ETH. That is the claim, and this page is where
 * it is easiest to check: every transaction below was signed by KeeperHub, and
 * the agent's own address appears only as the payee.
 */

import { useEffect, useRef, useState } from "react";
import { Bot, CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { tx } from "@/lib/outcome";
import { cn } from "@/lib/utils";
import { PageHead } from "@/components/page-head";

/**
 * A live countdown after the gateway asks you to wait.
 *
 * These routes run several real transactions, so the gateway rate-limits them
 * and answers 429 with `retryAfterSeconds`. Showing that number once and then
 * letting it go stale invites the obvious behaviour -- clicking again, getting
 * refused again -- so it ticks, and the button stays out of action until it
 * reaches zero. A control that is going to refuse should say so before it is
 * pressed, not after.
 */
function useCooldown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [left]);
  return [left, setLeft] as const;
}


const GATEWAY =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "https://gateway-production-944e.up.railway.app";

type Report = {
  intentId: string;
  took: boolean;
  workTx?: string;
  outcome?: string;
  reason: string;
};
type Cycle = {
  task: string;
  intentId: string;
  claimTransactionHash: string;
  agentAddress: string;
  reports: Report[];
  declinedOthers: number;
};

export default function AgentPage() {
  const [running, setRunning] = useState(false);
  /*
   * A visible clock. This cycle is four real transactions and takes the better
   * part of a minute; a bare spinner for that long reads as a hang, and the
   * person watching gives up before the thing they came to see happens.
   */
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [error, setError] = useState<string | null>(null);

  /*
   * Synchronous in-flight guard. `disabled` comes from state and state lands on
   * the next render, so two clicks in one frame both fire a request -- and on
   * the paid routes the second one is a real duplicate attempt, not just noise.
   */
  const [cooldown, setCooldown] = useCooldown();
  const inFlight = useRef(false);

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    setCycle(null);
    setError(null);
    try {
      const res = await fetch(`${GATEWAY}/agent`);
      const body = await res.json();
      if (!res.ok) {
        if (body.retryAfterSeconds) setCooldown(Number(body.retryAfterSeconds));
        setError(body.error ?? `gateway returned ${res.status}`);
        return;
      }
      setCycle(body as Cycle);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }

  const paid = cycle?.reports.some((r) => r.outcome?.startsWith("release"));

  return (
    <>
      <PageHead
        rubric="No private key · no ETH"
        title="An agent that gets paid without holding a key."
      >
        A payer posts a job, escrows the money, and walks away. Nothing after that is driven by a
        human. The agent finds the work, does it through KeeperHub, and hands the verifier a
        transaction hash — never a verdict. It gets paid only because the transfer was proven, and
        it can lose: unproven work refunds the payer and the agent earns nothing.
      </PageHead>

      <div className="shell py-10 sm:py-14">
      <div className="max-w-3xl">
      <p className="mt-6 text-[12px] leading-relaxed text-[var(--ink-3)]">
        Four real Sepolia transactions — post, escrow, work, settle — so this takes roughly 40
        seconds. The timer runs on the button.
      </p>

      <Button size="lg" className="mt-3 gap-2" disabled={running || cooldown > 0} onClick={() => void run()}>
        {running ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
        {running ? `Working… ${elapsed}s` : "Post a job and let it run"}
      </Button>

      <p className="mt-3 font-mono text-xs text-[var(--ink-3)]">
        A cycle is four real transactions — approve, claim, deliver, settle — so give it a moment.
      </p>

      {cooldown > 0 && (
        <p className="mt-4 text-[12px] text-[var(--ink-3)]">
          Ready again in <span className="figure">{cooldown}s</span> — these runs are several real
          transactions, so the gateway paces them.
        </p>
      )}

      {error && (
        <p className="mt-6 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-4 font-mono text-sm text-[var(--ink-3)]">
          {error}
        </p>
      )}

      {cycle && (
        <div className="mt-8 space-y-4">
          <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-5">
            <div className="field-label">
              the payer posts and leaves
            </div>
            <p className="mt-2 font-mono text-sm">{cycle.task}</p>
            <dl className="mt-3 grid gap-1.5 font-mono text-xs sm:grid-cols-[130px_1fr]">
              <dt className="text-[var(--ink-3)]">intent</dt>
              <dd className="break-all">{cycle.intentId}</dd>
              <dt className="text-[var(--ink-3)]">escrowed in</dt>
              <dd>
                <a
                  href={tx(cycle.claimTransactionHash)}
                  target="_blank"
                  rel="noopener"
                  className="underline underline-offset-4 hover:text-[var(--ink)]"
                >
                  {cycle.claimTransactionHash.slice(0, 22)}…
                </a>
              </dd>
              <dt className="text-[var(--ink-3)]">agent address</dt>
              <dd className="break-all">{cycle.agentAddress}</dd>
            </dl>
          </div>

          {cycle.declinedOthers > 0 && (
            <p className="font-mono text-xs text-[var(--ink-3)]">
              It also looked at {cycle.declinedOthers} older intent
              {cycle.declinedOthers === 1 ? "" : "s"} and declined {cycle.declinedOthers === 1 ? "it" : "them"} —
              it will not take money for work whose task it cannot reconstruct.
            </p>
          )}

          {cycle.reports.length === 0 && (
            <p className="rounded-[10px] border border-[var(--line)] p-5 font-mono text-sm text-[var(--ink-3)]">
              The agent found no open work this cycle.
            </p>
          )}

          {cycle.reports.map((r) => {
            const released = r.outcome?.startsWith("release");
            return (
              <div
                key={r.intentId}
                className={cn(
                  "rounded-[10px] border p-5",
                  released
                    ? "border-[var(--line)] bg-[var(--surface)]"
                    : "border-[var(--refused)] bg-transparent"
                )}
              >
                <div className="flex flex-wrap items-center gap-3">
                  {released ? (
                    <CheckCircle2 className="size-4 text-[var(--ink)]" />
                  ) : (
                    <XCircle className="size-4 text-[var(--refused)]" />
                  )}
                  <span className="font-mono text-sm font-medium">
                    {r.took ? (r.outcome ?? "settled") : "declined"}
                  </span>
                </div>

                <p className="mt-3 break-words font-mono text-xs leading-relaxed text-[var(--ink)]">
                  {r.reason}
                </p>

                {r.workTx && (
                  <a
                    href={tx(r.workTx)}
                    target="_blank"
                    rel="noopener"
                    className="mt-3 inline-block font-mono text-xs underline-offset-4 hover:text-[var(--ink)] hover:underline"
                  >
                    the work it did: {r.workTx.slice(0, 22)}… →
                  </a>
                )}
              </div>
            );
          })}

          {paid && (
            <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-5">
              <h2 className="font-mono text-sm font-medium">Who signed all that</h2>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-[var(--ink-3)]">
                Not the agent. Open the work transaction and the sender is KeeperHub&rsquo;s relayer;
                the wallet holding the tokens has <code className="font-mono text-[var(--ink)]">0.0 ETH</code>.
                The agent&rsquo;s address appears only as the payee — it signed nothing, funded
                nothing, and still got paid for proven work.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
      </div>
    </>
  );
}
