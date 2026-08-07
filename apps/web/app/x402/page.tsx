import Link from "next/link";
import { ArrowRight, ShieldCheck, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { tx } from "@/lib/outcome";

/**
 * The x402 argument, with both live transactions.
 *
 * These two hashes are the whole submission in one comparison: identical
 * protocol flow, identical facilitator response, opposite outcomes once someone
 * reads the receipt.
 */
const RUNS = [
  {
    kind: "honest" as const,
    title: "An honest facilitator",
    says: "success: true",
    chain: "1000000 reached the merchant",
    result: "HTTP 200 — article served",
    hash: "0x3aac3134ba7c4ce4e12c04e206ad7ce468318607fdb7a8e7ad85e91a70fe72ee",
  },
  {
    kind: "lying" as const,
    title: "A facilitator that reports success and pays nobody",
    says: "success: true",
    chain: "0 reached the merchant",
    result: "HTTP 402 — resource withheld",
    hash: "0x6db7218d717f5be3c3b37f386593bf0bdf3760b0407ac1145c617ac172136603",
  },
];

export default function X402Page() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-secondary/30 px-3 py-1 font-mono text-xs text-muted-foreground">
        x402 · scheme <code>exact</code> · EIP-3009 · Sepolia
      </div>

      <h1 className="mt-6 text-4xl font-semibold leading-tight tracking-tight text-balance">
        x402 never checks the transaction it was handed.
      </h1>

      <div className="mt-6 space-y-4 leading-relaxed text-muted-foreground">
        <p>
          The flow is: a server answers <code className="font-mono text-foreground/80">402</code> with
          what it wants paid, the client signs an EIP-3009 authorisation into an{" "}
          <code className="font-mono text-foreground/80">X-PAYMENT</code> header, and a facilitator
          submits it and reports back. The report carries{" "}
          <code className="font-mono text-foreground/80">success: true</code> and a transaction hash.
        </p>
        <p className="text-foreground">
          The resource server reads <code className="font-mono">success</code>, believes it, and
          serves the resource. That field is produced by the one party with an incentive to say yes,
          and the transaction hash beside it is a citation nobody follows.
        </p>
        <p>
          A settlement that mined with <code className="font-mono text-foreground/80">status: 0x1</code>,
          emitted no <code className="font-mono text-foreground/80">Transfer</code>, and moved nothing
          satisfies every check the protocol actually performs.
        </p>
      </div>

      <h2 className="mt-14 text-xl font-semibold tracking-tight">Both runs, on Sepolia</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Same protocol, same client, same <code className="font-mono">success: true</code>. The only
        difference is that one of them was checked.
      </p>

      <div className="mt-6 space-y-4">
        {RUNS.map((r) => {
          const good = r.kind === "honest";
          const Icon = good ? ShieldCheck : ShieldAlert;
          return (
            <div
              key={r.hash}
              className={`rounded-xl border p-5 ${
                good
                  ? "border-emerald-400/25 bg-emerald-400/[0.04]"
                  : "border-amber-400/25 bg-amber-400/[0.04]"
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`size-4 ${good ? "text-emerald-400" : "text-amber-400"}`} />
                <h3 className="font-medium tracking-tight">{r.title}</h3>
              </div>

              <dl className="mt-4 grid gap-2 font-mono text-xs sm:grid-cols-[130px_1fr]">
                <dt className="text-muted-foreground">facilitator says</dt>
                <dd>{r.says}</dd>
                <dt className="text-muted-foreground">chain says</dt>
                <dd className={good ? "" : "text-amber-200/90"}>{r.chain}</dd>
                <dt className="text-muted-foreground">result</dt>
                <dd className="font-medium">{r.result}</dd>
              </dl>

              <a
                href={tx(r.hash)}
                target="_blank"
                rel="noopener"
                className="mt-4 inline-block font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {r.hash.slice(0, 18)}… on Etherscan →
              </a>
            </div>
          );
        })}
      </div>

      <h2 className="mt-14 text-xl font-semibold tracking-tight">The step that was added</h2>
      <pre className="mt-4 overflow-x-auto rounded-xl border border-border/60 bg-secondary/20 p-5 font-mono text-xs leading-relaxed text-foreground/85">
{`import { verifySettlement } from "outcome-sdk/x402";

// after the facilitator returns, before the resource is served
const verdict = await verifySettlement(outcome, {
  requirements,   // what you asked to be paid
  settlement,     // what the facilitator says it did
});

if (!verdict.proven) return respond402(verdict.reason);
return serve(resource);`}
      </pre>

      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        A facilitator reporting <em>failure</em> is taken at its word — claiming failure is against
        its interest and there is nothing to check. A facilitator reporting success is not. That
        asymmetry is the whole of it.
      </p>

      <div className="mt-10 rounded-xl border border-border/60 bg-secondary/20 p-5">
        <h3 className="font-mono text-sm font-medium">Run it yourself</h3>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-background/60 p-4 font-mono text-xs leading-relaxed text-foreground/80">
{`git clone https://github.com/nickthelegend/outcome
cd outcome && npm install

npm start --prefix apps/gateway     # the resource server
npm run pay --prefix apps/gateway         # honest  -> 200
npm run pay:lying --prefix apps/gateway   # lying   -> 402`}
        </pre>
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Button asChild className="gap-2">
          <Link href="/verify">
            Check a transaction yourself <ArrowRight className="size-4" />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/docs">Read the quickstart</Link>
        </Button>
      </div>
    </div>
  );
}
