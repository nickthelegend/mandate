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

import { useState } from "react";
import { Bot, CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { tx } from "@/lib/outcome";
import { cn } from "@/lib/utils";

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
};

export default function AgentPage() {
  const [running, setRunning] = useState(false);
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setCycle(null);
    setError(null);
    try {
      const res = await fetch(`${GATEWAY}/agent`);
      const body = await res.json();
      if (!res.ok) {
        setError(
          body.retryAfterSeconds
            ? `${body.error} Try again in ${body.retryAfterSeconds}s.`
            : (body.error ?? `gateway returned ${res.status}`)
        );
        return;
      }
      setCycle(body as Cycle);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const paid = cycle?.reports.some((r) => r.outcome?.startsWith("release"));

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/30 px-3 py-1 font-mono text-xs text-muted-foreground">
        <Bot className="size-3" /> no private key · no ETH
      </div>

      <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-tight text-balance">
        An agent that gets paid without holding a key.
      </h1>

      <p className="mt-5 text-pretty leading-relaxed text-muted-foreground">
        A payer posts a job, escrows the money, and walks away. Nothing after that is driven by a
        human. The agent finds the work, does it through KeeperHub, and hands the verifier a
        transaction hash — never a verdict. It gets paid only because the transfer was proven, and
        it can lose: unproven work refunds the payer and the agent earns nothing.
      </p>

      <Button size="lg" className="mt-8 gap-2" disabled={running} onClick={() => void run()}>
        {running ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
        {running ? "Working…" : "Post a job and let it run"}
      </Button>

      <p className="mt-3 font-mono text-xs text-muted-foreground">
        A cycle is four real transactions — approve, claim, deliver, settle — so give it a moment.
      </p>

      {error && (
        <p className="mt-6 rounded-lg border border-border/70 bg-secondary/40 p-4 font-mono text-sm text-muted-foreground">
          {error}
        </p>
      )}

      {cycle && (
        <div className="mt-8 space-y-4">
          <div className="rounded-xl border border-border/60 bg-secondary/20 p-5">
            <div className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              the payer posts and leaves
            </div>
            <p className="mt-2 font-mono text-sm">{cycle.task}</p>
            <dl className="mt-3 grid gap-1.5 font-mono text-xs sm:grid-cols-[130px_1fr]">
              <dt className="text-muted-foreground">intent</dt>
              <dd className="break-all">{cycle.intentId}</dd>
              <dt className="text-muted-foreground">escrowed in</dt>
              <dd>
                <a
                  href={tx(cycle.claimTransactionHash)}
                  target="_blank"
                  rel="noopener"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {cycle.claimTransactionHash.slice(0, 22)}…
                </a>
              </dd>
              <dt className="text-muted-foreground">agent address</dt>
              <dd className="break-all">{cycle.agentAddress}</dd>
            </dl>
          </div>

          {cycle.reports.length === 0 && (
            <p className="rounded-xl border border-border/60 p-5 font-mono text-sm text-muted-foreground">
              The agent found no open work this cycle.
            </p>
          )}

          {cycle.reports.map((r) => {
            const released = r.outcome?.startsWith("release");
            return (
              <div
                key={r.intentId}
                className={cn(
                  "rounded-xl border p-5",
                  released
                    ? "border-emerald-400/25 bg-emerald-400/[0.04]"
                    : "border-amber-400/25 bg-amber-400/[0.04]"
                )}
              >
                <div className="flex flex-wrap items-center gap-3">
                  {released ? (
                    <CheckCircle2 className="size-4 text-emerald-400" />
                  ) : (
                    <XCircle className="size-4 text-amber-400" />
                  )}
                  <span className="font-mono text-sm font-medium">
                    {r.took ? (r.outcome ?? "settled") : "declined"}
                  </span>
                </div>

                <p className="mt-3 break-words font-mono text-xs leading-relaxed text-foreground/85">
                  {r.reason}
                </p>

                {r.workTx && (
                  <a
                    href={tx(r.workTx)}
                    target="_blank"
                    rel="noopener"
                    className="mt-3 inline-block font-mono text-xs underline-offset-4 hover:text-foreground hover:underline"
                  >
                    the work it did: {r.workTx.slice(0, 22)}… →
                  </a>
                )}
              </div>
            );
          })}

          {paid && (
            <div className="rounded-xl border border-border/60 bg-secondary/20 p-5">
              <h2 className="font-mono text-sm font-medium">Who signed all that</h2>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
                Not the agent. Open the work transaction and the sender is KeeperHub&rsquo;s relayer;
                the wallet holding the tokens has <code className="font-mono text-foreground/80">0.0 ETH</code>.
                The agent&rsquo;s address appears only as the payee — it signed nothing, funded
                nothing, and still got paid for proven work.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
