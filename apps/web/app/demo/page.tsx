"use client";

/**
 * The demo, in a browser.
 *
 * Two buttons, one difference. Both run a real x402 purchase against the hosted
 * gateway: a real 402, a real EIP-3009 signature, a real Sepolia settlement.
 * The only thing that changes is whether the facilitator actually paid.
 *
 * The payer signs server-side because a browser cannot hold a key, and a page
 * that shipped one would be worse than having no demo. The gateway runs the
 * same `runPurchase` the CLI client uses -- not a reimplementation -- so what
 * is on screen is what the code does.
 */

import { useState } from "react";
import { CheckCircle2, Loader2, ShieldAlert, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { tx } from "@/lib/outcome";
import { cn } from "@/lib/utils";

const GATEWAY =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "https://gateway-production-944e.up.railway.app";

type FlowStep = { label: string; detail: string; transactionHash?: string; status?: number };
type FlowResult = {
  facilitator: "honest" | "lying";
  served: boolean;
  httpStatus: number;
  steps: FlowStep[];
  facilitatorClaimedSuccess: boolean;
  observed: string;
  reason: string;
  transactionHash?: string;
  submittedVia?: string;
  article?: { title: string; body: string };
};

export default function DemoPage() {
  const [running, setRunning] = useState<"honest" | "lying" | null>(null);
  const [result, setResult] = useState<FlowResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(facilitator: "honest" | "lying") {
    setRunning(facilitator);
    setResult(null);
    setError(null);
    try {
      const res = await fetch(`${GATEWAY}/demo?facilitator=${facilitator}`);
      const body = await res.json();
      if (!res.ok) {
        setError(
          body.retryAfterSeconds
            ? `${body.error} Try again in ${body.retryAfterSeconds}s.`
            : (body.error ?? `gateway returned ${res.status}`)
        );
        return;
      }
      setResult(body as FlowResult);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/30 px-3 py-1 font-mono text-xs text-muted-foreground">
        <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
        every run is a real Sepolia transaction
      </div>

      <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-tight text-balance">
        Buy an article twice. Once you get it, once you don&rsquo;t.
      </h1>

      <p className="mt-5 text-pretty leading-relaxed text-muted-foreground">
        Same protocol, same client, same <code className="font-mono text-foreground/80">success: true</code>{" "}
        from the facilitator. The only difference is that one of the two settlements actually moved
        money — and only one of them gets the article.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Button size="lg" className="gap-2" disabled={running !== null} onClick={() => run("honest")}>
          {running === "honest" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          {running === "honest" ? "Paying…" : "Pay honestly"}
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="gap-2 border-amber-400/40 hover:bg-amber-400/10"
          disabled={running !== null}
          onClick={() => run("lying")}
        >
          {running === "lying" ? <Loader2 className="size-4 animate-spin" /> : <ShieldAlert className="size-4" />}
          {running === "lying" ? "Settling…" : "Pay with a lying facilitator"}
        </Button>
      </div>

      <p className="mt-3 font-mono text-xs text-muted-foreground">
        Each run signs an authorisation and settles on chain, so it takes a few seconds.
      </p>

      {error && (
        <p className="mt-6 rounded-lg border border-border/70 bg-secondary/40 p-4 font-mono text-sm text-muted-foreground">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-8">
          <div
            className={cn(
              "rounded-xl border p-5",
              result.served
                ? "border-emerald-400/25 bg-emerald-400/[0.04]"
                : "border-amber-400/25 bg-amber-400/[0.04]"
            )}
          >
            <div className="flex flex-wrap items-center gap-3">
              {result.served ? (
                <CheckCircle2 className="size-5 text-emerald-400" />
              ) : (
                <XCircle className="size-5 text-amber-400" />
              )}
              <span className="font-mono text-sm font-medium">
                HTTP {result.httpStatus} — {result.served ? "resource served" : "resource withheld"}
              </span>
            </div>

            <dl className="mt-4 grid gap-1.5 font-mono text-xs sm:grid-cols-[190px_1fr]">
              <dt className="text-muted-foreground">facilitator claimed</dt>
              <dd>{String(result.facilitatorClaimedSuccess)}</dd>
              <dt className="text-muted-foreground">chain actually moved</dt>
              <dd className={result.served ? "" : "text-amber-200/90"}>{result.observed}</dd>
              {result.submittedVia && (
                <>
                  <dt className="text-muted-foreground">submitted via</dt>
                  <dd>{result.submittedVia}</dd>
                </>
              )}
            </dl>

            <p className="mt-4 break-words font-mono text-xs leading-relaxed text-foreground/85">
              {result.reason}
            </p>
          </div>

          <ol className="mt-6 space-y-px overflow-hidden rounded-xl border border-border/60">
            {result.steps.map((s, i) => (
              <li key={`${s.label}-${i}`} className="bg-background p-4">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm font-medium">{s.label}</span>
                </div>
                <p className="mt-1 break-words pl-8 font-mono text-xs leading-relaxed text-muted-foreground">
                  {s.detail}
                </p>
                {s.transactionHash && (
                  <a
                    href={tx(s.transactionHash)}
                    target="_blank"
                    rel="noopener"
                    className="mt-1.5 inline-block pl-8 font-mono text-xs underline-offset-4 hover:text-foreground hover:underline"
                  >
                    {s.transactionHash.slice(0, 22)}… on Etherscan →
                  </a>
                )}
              </li>
            ))}
          </ol>

          {result.article && (
            <div className="mt-6 rounded-xl border border-border/60 bg-secondary/20 p-5">
              <h2 className="font-medium tracking-tight">{result.article.title}</h2>
              <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
                {result.article.body}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-14 rounded-xl border border-border/60 bg-secondary/20 p-5">
        <h2 className="font-mono text-sm font-medium">What the lying facilitator does</h2>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
          It submits an <code className="font-mono text-foreground/80">approve</code> instead of the
          transfer. That mines, emits a log, costs it nothing, and moves no money — then it returns{" "}
          <code className="font-mono text-foreground/80">success: true</code> with that hash. It is a
          legal x402 settlement response, and a stock resource server hands over the article.
        </p>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">
          The point is not that facilitators are malicious. It is that x402 has no way to find out.
        </p>
      </div>
    </div>
  );
}
