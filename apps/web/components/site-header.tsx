"use client";

/**
 * The header.
 *
 * Four links, not ten. Ten was the whole sitemap pushed into the nav, which
 * tells a first-time visitor nothing about where to start and spends the one
 * thing a judge is short of. These four are the demo path in order: watch it
 * fail, check it yourself, watch an agent do it unattended, install it.
 *
 * Everything else the project built is real and still reachable -- it lives in
 * the footer, which is where a second visit goes looking.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/demo", label: "Live demo" },
  { href: "/verify", label: "Verify" },
  { href: "/agent", label: "Agent" },
  { href: "/docs", label: "Docs" },
];

export function SiteHeader() {
  const path = usePathname();
  const active = (href: string) => path.startsWith(href);

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-white/90 backdrop-blur-sm">
      <div className="shell flex h-16 items-center gap-6">
        <Link href="/" className="shrink-0">
          <Logo />
        </Link>

        <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={cn(
                "whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium transition-colors",
                active(n.href)
                  ? "bg-[var(--brand-wash)] text-[var(--brand-ink)]"
                  : "text-[var(--ink-2)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
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
          className="btn btn--outline hidden shrink-0 px-4! py-2! text-[13px]! sm:inline-flex"
        >
          GitHub
        </a>
      </div>
    </header>
  );
}
