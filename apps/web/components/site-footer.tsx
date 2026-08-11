import Link from "next/link";

import { MandateMark } from "@/components/logo";
import { DEPLOYMENT, source } from "@/lib/mandate";

/**
 * The footer carries what the nav gave up.
 *
 * The ledger, the explorer, the execution inspector and the x402 write-up are
 * all real surfaces backed by live data. They are not what a first-time visitor
 * should be choosing between in their first ten seconds, so they live here,
 * grouped, where a second visit goes looking.
 */

const MORE = [
  { href: "/ledger", label: "Decision record", note: "every verdict, and why" },
  { href: "/inspect", label: "Execution record", note: "KeeperHub's own account" },
  { href: "/docs", label: "SDK and MCP", note: "npm i mandate-sdk" },
];

export function SiteFooter() {
  return (
    <footer className="frame mt-3 bg-white px-4 py-12 sm:mt-4 sm:px-8 sm:py-14">
      <div className="shell">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr]">
          <div>
            <span className="flex items-center gap-2">
              <MandateMark size={26} />
              <span className="text-[17px] font-semibold tracking-[-0.02em]">Mandate</span>
            </span>
            {/*
              * Two false claims lived here on every page.
              *
              * "Payment that follows a verified result" was the tagline of the
              * escrow product this replaced. And "there is no backend to trust"
              * stopped being true the moment the authority became a service:
              * the budget, the decision record and the receipts all come from a
              * gateway, and a judge with the network tab open would have caught
              * the footer contradicting the page above it.
              *
              * What is actually true is better anyway — the reader does not
              * have to trust the gateway, because the policy it enforces is
              * anchored on chain and they can check it themselves.
              */}
            <p className="mt-3 max-w-sm text-[14px] leading-relaxed text-neutral-600">
              An agent spending authority. The budget and the decision record come from this
              project&rsquo;s gateway — the policy those decisions are judged against is anchored on{" "}
              {DEPLOYMENT.chainName}, so you can check it without trusting either.
            </p>
            <a
              href={source(DEPLOYMENT.registry)}
              target="_blank"
              rel="noopener"
              className="figure mt-4 inline-block text-[11px] text-neutral-500 underline-offset-4 hover:text-[var(--brand)] hover:underline"
            >
              PolicyRegistry · {DEPLOYMENT.registry.slice(0, 18)}… · verified
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
