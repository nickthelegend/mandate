import Link from "next/link";
import { ArrowRight, Fingerprint, LifeBuoy, ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LiveStats } from "@/components/live-stats";
import { CodeTabs } from "@/components/code-tabs";
import { DEPLOYMENT } from "@/lib/outcome";

const GUARANTEES = [
  {
    icon: Fingerprint,
    n: "01",
    title: "An agent can't double-pay",
    body: "The intent id is derived from the work itself, so two agents independently told to do the same job produce the same id and collide on chain instead of both paying. This is the half of an idempotency key a header cannot provide — a header can be rotated, a mapping cannot.",
  },
  {
    icon: ScanLine,
    n: "02",
    title: "An agent can't be lied to",
    body: "Payment settles on a receipt read, never a status byte. A transaction can mine with status 0x1, emit no logs, transfer nothing, and still be recorded as paid by every rail that only checks whether the EVM reverted. Unreadable evidence resolves to not proven — a false negative costs a retry, a false positive pays for nothing.",
  },
  {
    icon: LifeBuoy,
    n: "03",
    title: "An agent can't get stuck",
    body: "A failure is diagnosed before it is retried. An unknown outcome is classified as in-flight and never resent, because the first attempt may still land and resending pays twice. Funds sit in escrow until a verdict, and the payer can always reclaim if no verdict ever comes.",
  },
];

export default function Home() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-5 pt-20 pb-14">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/30 px-3 py-1 font-mono text-xs text-muted-foreground">
          <span className="inline-block size-1.5 rounded-full bg-emerald-400" />
          live on {DEPLOYMENT.chainName} · settles through KeeperHub
        </div>

        <h1 className="mt-6 max-w-3xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          Pay agents for verified results, not attempts.
        </h1>

        <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted-foreground">
          x402 releases funds when a facilitator returns success, and the buyer is expected to trust
          it. Across roughly 900 submissions to eight x402 hackathons, receipts are everywhere and
          verification is nowhere. Outcome is the settlement layer that reads the receipt — an SDK and
          an MCP server your agent installs.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg" className="gap-2">
            <Link href="/verify">
              Check a payment yourself <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/docs">Read the quickstart</Link>
          </Button>
        </div>

        <div className="mt-14">
          <LiveStats />
        </div>
      </section>

      <section className="border-y border-border/60 bg-secondary/10">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="font-mono text-sm uppercase tracking-wide text-muted-foreground">
            Three guarantees
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {GUARANTEES.map((g) => (
              <div key={g.n} className="rounded-xl border border-border/60 bg-background/40 p-6">
                <div className="flex items-center gap-3">
                  <g.icon className="size-4 text-emerald-400" />
                  <span className="font-mono text-xs text-muted-foreground">{g.n}</span>
                </div>
                <h3 className="mt-4 text-lg font-medium tracking-tight text-balance">{g.title}</h3>
                <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">{g.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-balance">
              Two lines to install. One call to stop trusting.
            </h2>
            <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
              The SDK runs anywhere — browser, edge, or an agent runtime. The MCP server runs with no
              configuration at all: the defaults point at the live deployment, and every read-only tool
              works without a credential. Only settlement moves money, and only settlement needs a key.
            </p>
            <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
              This site is built on the published SDK, not a private copy of the logic. If the package
              could not drive this page, it would not be worth publishing.
            </p>
            <Button asChild variant="outline" className="mt-6 gap-2">
              <Link href="/docs">
                Full quickstart <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>

          <CodeTabs />
        </div>
      </section>

      <section className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.04] p-8">
            <div className="font-mono text-xs uppercase tracking-wide text-amber-300">
              the same failure, inside x402
            </div>
            <h2 className="mt-4 max-w-2xl text-2xl font-semibold tracking-tight text-balance">
              A facilitator reported <code className="font-mono">success: true</code>. The chain says
              nothing moved. The article was withheld.
            </h2>
            <p className="mt-4 max-w-2xl text-pretty leading-relaxed text-muted-foreground">
              x402 ends at the facilitator&rsquo;s word. Both runs are live on Sepolia with the same
              protocol flow and the same success response — one of them paid nobody.
            </p>
            <Button asChild variant="outline" className="mt-6 gap-2">
              <Link href="/x402">
                See both transactions <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="border-t border-border/60 bg-secondary/10">
        <div className="mx-auto max-w-3xl px-5 py-16 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-balance">
            No AI adjudicator. On purpose.
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
            Every comparable project resolves payment disputes with an LLM judge. When the chain
            already knows whether value moved, adjudication is a lookup, not an opinion. There is no
            model anywhere in the money path.
          </p>
        </div>
      </section>
    </>
  );
}
