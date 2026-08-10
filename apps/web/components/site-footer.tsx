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
  { href: "/demo", label: "The x402 gap, live", note: "a settlement that pays nobody" },
  { href: "/ledger", label: "Decision ledger", note: "every verdict, and why" },
  { href: "/explorer", label: "Intent explorer", note: "read from the chain" },
  { href: "/inspect", label: "Execution record", note: "KeeperHub's own account" },
  { href: "/x402", label: "The x402 gap", note: "what the spec leaves open" },
  { href: "/claim", label: "Post a job", note: "with your own wallet" },
];

export function SiteFooter() {
  return (
    <footer className="frame mt-3 bg-white px-4 py-12 sm:mt-4 sm:px-8 sm:py-14">
      <div className="shell">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr]">
          <div>
            <span className="flex items-center gap-2">
              <OutcomeMark size={26} />
              <span className="text-[17px] font-semibold tracking-[-0.02em]">Outcome</span>
            </span>
            <p className="mt-3 max-w-sm text-[14px] leading-relaxed text-neutral-600">
              Payment that follows a verified result. Every number on this site is read from{" "}
              {DEPLOYMENT.chainName} in your browser — there is no backend to trust.
            </p>
            <a
              href={source(DEPLOYMENT.escrow)}
              target="_blank"
              rel="noopener"
              className="figure mt-4 inline-block text-[11px] text-neutral-500 underline-offset-4 hover:text-[var(--brand)] hover:underline"
            >
              OutcomeEscrow · {DEPLOYMENT.escrow.slice(0, 18)}… · verified
            </a>
          </div>

          <div>
            <p className="text-[12px] font-semibold">Everything else</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {MORE.map((m) => (
                <li key={m.href}>
                  <Link href={m.href} className="group block">
                    <span className="text-[14px] text-neutral-700 group-hover:text-[var(--brand)]">
                      {m.label}
                    </span>
                    <span className="block text-[12px] text-neutral-400">{m.note}</span>
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
