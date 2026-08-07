"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/x402", label: "x402" },
  { href: "/verify", label: "Verify" },
  { href: "/explorer", label: "Explorer" },
  { href: "/docs", label: "Docs" },
];

export function SiteHeader() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2.5 font-mono text-sm font-semibold tracking-tight">
          <span className="inline-block size-2 rounded-full bg-emerald-400 shadow-[0_0_12px] shadow-emerald-400/70" />
          outcome
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "rounded-md px-2.5 py-1.5 transition-colors",
                active(n.href)
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 font-mono text-xs text-muted-foreground">
          <span className="hidden sm:inline">Sepolia</span>
          <a
            href="https://github.com/nickthelegend/outcome"
            target="_blank"
            rel="noopener"
            className="rounded-md border border-border/70 px-2.5 py-1 transition-colors hover:border-foreground/40 hover:text-foreground"
          >
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}
