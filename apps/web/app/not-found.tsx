import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { PageHead } from "@/components/page-head";

/**
 * The page you get when a link is wrong.
 *
 * Without this file Next serves its own: black text on white, no navbar, no
 * theme, no way back. That page is reached by exactly the people you least want
 * to lose — someone following a stale link from a write-up, or a reader who
 * mistyped — and it tells them the site is broken rather than that one URL is.
 *
 * So it looks like the rest of the site and, more usefully, it points at the
 * four things worth reaching. A dead end that offers the way out stops being a
 * dead end.
 */

export const metadata = {
  title: "Not found — Outcome",
  description: "That page does not exist. The authority, the verifier and the docs do.",
};

const WAYS_OUT = [
  { href: "/authority", label: "The authority", note: "spend it down, live" },
  { href: "/verify", label: "Verify a payment", note: "check one yourself" },
  { href: "/agent", label: "The agent", note: "no key, no ETH" },
  { href: "/docs", label: "Docs", note: "the SDK and the MCP tools" },
];

export default function NotFound() {
  return (
    <>
      <PageHead rubric="404" title="No such page.">
        The link is wrong, not the site. Everything below is live.
      </PageHead>

      <div className="shell py-10 sm:py-14">
        <div className="grid max-w-3xl gap-2 sm:grid-cols-2">
          {WAYS_OUT.map((w) => (
            <Link
              key={w.href}
              href={w.href}
              className="group flex items-center justify-between gap-3 rounded-[10px] border border-[var(--line)] bg-[var(--card)] px-4 py-3 transition-colors hover:border-[var(--ink)]"
            >
              <span>
                <span className="block text-sm font-medium">{w.label}</span>
                <span className="block text-[12px] text-[var(--ink-3)]">{w.note}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-[var(--ink-4)] transition-colors group-hover:text-[var(--ink)]" />
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
