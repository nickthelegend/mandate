"use client";

/**
 * The register's running head.
 *
 * A rule of struck labels with the current entry underlined in ink. No pill, no
 * filled tab, no status dot: an assay office marks the current page the way a
 * bound register marks the open one, by where the ribbon sits.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/demo", label: "Strike" },
  { href: "/agent", label: "Agent" },
  { href: "/ledger", label: "Ledger" },
  { href: "/explorer", label: "Register" },
  { href: "/verify", label: "Assay" },
  { href: "/inspect", label: "Inspect" },
  { href: "/x402", label: "x402" },
  { href: "/docs", label: "Docs" },
];

export function SiteHeader() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--rule)] bg-[var(--sheet)]">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 overflow-hidden px-6">
        <Link href="/" className="flex items-baseline gap-2.5 whitespace-nowrap">
          <span className="font-display text-sm font-bold uppercase tracking-[0.14em] text-[var(--ink)]">
            Outcome
          </span>
          <span className="rubric hidden md:inline">Assay Office</span>
        </Link>

        <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-5 overflow-x-auto">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={cn(
                "rubric whitespace-nowrap border-b-2 pb-0.5 transition-colors",
                active(n.href)
                  ? "border-[var(--ink)] text-[var(--ink)]"
                  : "border-transparent hover:text-[var(--ink)]"
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
          className="rubric hidden whitespace-nowrap hover:text-[var(--ink)] lg:inline"
        >
          Source
        </a>
      </div>
    </header>
  );
}
