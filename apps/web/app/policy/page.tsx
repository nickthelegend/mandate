import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { PageHead } from "@/components/page-head";
import { PolicyBuilder } from "@/components/policy-builder";
import { DEPLOYMENT, address } from "@/lib/mandate";

/*
 * The step nothing else on this site can show.
 *
 * Every other page starts from a policy that already exists — the console reads
 * one, the ledger judges against one, the agent obeys one. This is where a
 * policy comes from: an operator writes limits, they are canonicalised and
 * hashed, and that hash is what goes on chain. Doing it in the browser makes
 * the causal link visible, because the hash moves while you watch.
 */

export const metadata = {
  title: "Write a policy · Mandate",
  description:
    "Set an agent's limits and watch the on-chain commitment recompute. RFC 8785 canonical JSON, keccak256, anchored through KeeperHub.",
};

const STEPS = [
  {
    n: "01",
    title: "Write the limits",
    body: "A daily budget, a cap on any single call, which category may be bought, and what happens when a payee has no history. Fifteen rules in a fixed order — the first to fail decides, so a refusal can name the rule that refused it.",
  },
  {
    n: "02",
    title: "Canonicalise and hash",
    body: "The document is serialised by RFC 8785 and hashed with keccak256. Key order and number formatting cannot change the result, so the same rules always produce the same commitment — and different rules never do.",
  },
  {
    n: "03",
    title: "Register it through KeeperHub",
    body: "KeeperHub's Execute API sends the registration to PolicyRegistry, so the registry records KeeperHub's wallet as owner. The agent holds no key that can change what it is allowed to spend.",
  },
];

export default function PolicyPage() {
  return (
    <>
      <PageHead rubric="Policy · RFC 8785 · keccak256" title={<>Where a limit <span className="serif">comes from</span></>}>
        An agent&rsquo;s budget is a document, and the document&rsquo;s hash is what the chain holds.
        Change a number below and watch the commitment move.
      </PageHead>

      <section className="shell py-10 sm:py-14">
        <PolicyBuilder />
      </section>

      <section className="frame bg-[var(--tray)] px-4 py-14 sm:px-8 sm:py-16">
        <div className="shell">
          <h2
            className="max-w-2xl"
            style={{ fontSize: "clamp(24px, 3.4vw, 34px)", lineHeight: 1.1, fontWeight: 500, letterSpacing: "-0.02em" }}
          >
            Three steps, and only one of them is ours.
          </h2>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="card-p card-p--bordered p-5">
                <span className="figure text-[11px] text-[var(--ink-4)]">{s.n}</span>
                <p className="mt-2 text-[14px] font-semibold tracking-[-0.01em]">{s.title}</p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--ink-3)]">{s.body}</p>
              </div>
            ))}
          </div>

          <a
            href={address(DEPLOYMENT.registry)}
            target="_blank"
            rel="noopener"
            className="figure mt-6 inline-block text-[12px] text-[var(--ink-3)] underline-offset-4 hover:text-[var(--brand)] hover:underline"
          >
            PolicyRegistry · {DEPLOYMENT.registry} →
          </a>

          <div className="mt-8">
            <Link href="/connect" className="btn btn--dark">
              Now connect an agent to it
              <span className="btn__dot">
                <ChevronRight className="size-4" />
              </span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
