"use client";

/**
 * The machine's channel plates.
 *
 * A row of label-plate legends with the current one underscored. No pill, no
 * filled tab, no status dot: the machine names its channels on engraved plates,
 * and the one running is the one the operator underlined.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/demo", label: "Wire" },
  { href: "/agent", label: "Agent" },
  { href: "/ledger", label: "Ledger" },
  { href: "/explorer", label: "Intents" },
  { href: "/verify", label: "Read" },
  { href: "/inspect", label: "Inspect" },
  { href: "/x402", label: "x402" },
  { href: "/docs", label: "Docs" },
];

export function SiteHeader() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header className="iron sticky top-0 z-50 border-b border-[var(--iron-rule)]">
      <div className="shell flex h-14 items-center gap-8 overflow-hidden">
        <Link href="/" className="flex items-baseline gap-2.5 whitespace-nowrap">
          <span className="font-display text-sm font-bold uppercase tracking-[0.16em] text-[var(--stock-inv)]">
            Outcome
          </span>
          <span className="plate-label hidden md:inline">Tape Reader</span>
        </Link>

        <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-5 overflow-x-auto">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={cn(
                "plate-label whitespace-nowrap border-b-2 pb-0.5 transition-colors",
                active(n.href)
                  ? "border-[var(--stock-inv)] text-[var(--stock-inv)]"
                  : "border-transparent hover:text-[var(--stock-inv)]"
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <a
          href="https://github.com/nickthelegend/outcome"
          target="_blank"
          rel="noopener"
          className="plate-label hidden whitespace-nowrap hover:text-[var(--stock-inv)] lg:inline"
        >
          Source
        </a>
      </div>
    </header>
  );
}
