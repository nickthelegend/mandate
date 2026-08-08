import Link from "next/link";

import { OutcomeMark } from "@/components/logo";
import { DEPLOYMENT, source } from "@/lib/outcome";

/**
 * The footer carries what the nav gave up.
 *
 * The ledger, the explorer, the execution inspector and the x402 write-up are
 * all real surfaces backed by live data. They are not what a first-time visitor
 * should be choosing between in their first ten seconds, so they live here,
 * grouped, where a second visit goes looking.
 */

const MORE = [
  { href: "/ledger", label: "Decision ledger", note: "every verdict, and why" },
  { href: "/explorer", label: "Intent explorer", note: "read from the chain" },
  { href: "/inspect", label: "Execution record", note: "KeeperHub's own account" },
  { href: "/x402", label: "The x402 gap", note: "what the spec leaves open" },
  { href: "/claim", label: "Post a job", note: "with your own wallet" },
];

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-[var(--line)] bg-[var(--surface)]">
      <div className="shell py-14">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr]">
          <div>
            <span className="flex items-center gap-2">
              <OutcomeMark size={24} />
              <span className="text-[17px] font-bold tracking-[-0.03em] text-[var(--ink)]">
                Outcome
              </span>
            </span>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-[var(--ink-3)]">
              Payment that follows a verified result. Every number on this site is read from{" "}
              {DEPLOYMENT.chainName} in your browser — there is no backend to trust.
            </p>
            <a
              href={source(DEPLOYMENT.escrow)}
              target="_blank"
              rel="noopener"
              className="figure mt-4 inline-block text-xs text-[var(--ink-3)] underline-offset-4 hover:text-[var(--brand)] hover:underline"
            >
              OutcomeEscrow · {DEPLOYMENT.escrow.slice(0, 18)}… · verified
            </a>
          </div>

          <div>
            <p className="text-xs font-semibold text-[var(--ink)]">Everything else</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {MORE.map((m) => (
                <li key={m.href}>
                  <Link href={m.href} className="group block">
                    <span className="text-sm font-medium text-[var(--ink-2)] group-hover:text-[var(--brand)]">
                      {m.label}
                    </span>
                    <span className="block text-xs text-[var(--ink-4)]">{m.note}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
