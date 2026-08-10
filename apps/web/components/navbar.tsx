"use client";

/**
 * The floating pill navbar.
 *
 * Lives inside the hero frame rather than in the layout, because it sits over
 * the video and is clipped by the same rounded corners.
 *
 * Four links, not ten. They are the demo path in order: watch it fail, check it
 * yourself, watch an agent do it unattended, install it. Everything else the
 * project built is in the footer.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Menu, X } from "lucide-react";

import { OutcomeMark } from "@/components/logo";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/demo", label: "Live demo" },
  { href: "/verify", label: "Verify" },
  { href: "/agent", label: "Agent" },
  { href: "/docs", label: "Docs" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const active = (href: string) => path.startsWith(href);

  return (
    <div className="flex justify-center px-3 pt-4 sm:px-4 sm:pt-6">
      <div className="relative w-full max-w-[760px] rounded-full border border-neutral-200 bg-white py-2 pl-2 pr-2 shadow-sm">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex shrink-0 items-center gap-2 pl-1" aria-label="Outcome home">
            <OutcomeMark className="h-7 w-7 sm:h-8 sm:w-8" />
            <span className="text-[15px] font-semibold tracking-[-0.02em]">Outcome</span>
          </Link>

          <nav className="hidden items-center gap-6 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active(n.href) ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 text-[14px] transition-colors",
                  active(n.href)
                    ? "text-[var(--brand)]"
                    : "text-neutral-700 hover:text-[var(--ink)]"
                )}
              >
                {active(n.href) && (
                  <span className="inline-block size-1.5 rounded-full bg-[var(--brand)]" />
                )}
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Link href="/demo" className="btn btn--brand shrink-0">
              <span className="hidden sm:inline">Run the live demo</span>
              <span className="sm:hidden">Live demo</span>
              <span className="btn__dot">
                <ChevronRight className="size-3.5" />
              </span>
            </Link>

            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={open ? "Close menu" : "Open menu"}
              className="flex size-9 items-center justify-center rounded-full text-neutral-700 transition-colors hover:bg-neutral-100 md:hidden"
            >
              {open ? <Menu className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>

        {open && (
          <div className="absolute left-2 right-2 top-full z-20 mt-2 rounded-2xl border border-neutral-200 bg-white p-3 shadow-lg md:hidden">
            <div className="flex items-center justify-between px-2 pb-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                Menu
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="text-neutral-500 hover:text-[var(--ink)]"
              >
                <X className="size-4" />
              </button>
            </div>
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "block rounded-xl px-3 py-2.5 text-[14px] transition-colors",
                  active(n.href)
                    ? "bg-[var(--brand-wash)] text-[var(--brand)]"
                    : "text-neutral-700 hover:bg-neutral-50"
                )}
              >
                {n.label}
              </Link>
            ))}
            <a
              href="https://github.com/nickthelegend/outcome"
              target="_blank"
              rel="noopener"
              className="block rounded-xl px-3 py-2.5 text-[14px] text-neutral-700 transition-colors hover:bg-neutral-50"
            >
              GitHub
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
