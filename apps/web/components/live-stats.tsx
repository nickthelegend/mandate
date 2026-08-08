"use client";

import Link from "next/link";
import { useIntents, useEscrowed } from "outcome-sdk/react";

import { amount, DEPLOYMENT } from "@/lib/outcome";

/**
 * The standing totals, read live.
 *
 * Written as one line of running totals rather than four cards of
 * big-number-over-small-label: these are the running totals struck at the foot of
 * a run, and a printout does not box its own subtotals.
 *
 * Deliberately shows an em dash while loading rather than a zero. A zero that
 * later becomes a three is a number the page was willing to state before it
 * knew, which is a small version of exactly the habit this project objects to.
 */
export function LiveStats() {
  const { data: rows, error } = useIntents();
  const { data: escrowed } = useEscrowed();

  const count = (s: string) => (rows ? String(rows.filter((r) => r.state === s).length) : "—");

  const stats = [
    { label: "Intents", value: rows ? String(rows.length) : "—" },
    { label: "Released", value: count("released") },
    { label: "Refunded", value: count("refunded") },
    {
      label: `In escrow (${DEPLOYMENT.tokenSymbol})`,
      value: escrowed === undefined ? "—" : amount(escrowed),
    },
  ];

  /*
   * A read that failed says so. The em dash means "not known yet"; leaving it
   * there after a failure would be the page quietly claiming to still be
   * loading, which is the habit this whole project objects to.
   */
  if (error) {
    return (
      <div className="border-t-2 border-[var(--refused)] pt-3">
        <div className="eyebrow text-[#b42318]">could not read the chain</div>
        <p className="figure mt-2 text-xs leading-relaxed text-[var(--ink-3)]">{error}</p>
        <a
          href={`${DEPLOYMENT.explorer}/address/${DEPLOYMENT.escrow}#events`}
          target="_blank"
          rel="noopener"
          className="figure mt-3 inline-block text-xs underline-offset-4 hover:text-[var(--ink)] hover:underline"
        >
          read the events on Etherscan instead →
        </a>
      </div>
    );
  }

  return (
    <Link href="/explorer" className="group block">
      <div className="flex items-baseline justify-between border-b border-[var(--line)] pb-2">
        <span className="eyebrow">On chain so far</span>
        <span className="eyebrow transition-colors group-hover:text-[var(--ink)]">
          open the explorer →
        </span>
      </div>

      <dl className="flex flex-wrap items-baseline gap-x-12 gap-y-5 border-b-2 border-[var(--ink)] py-6">
        {stats.map((s) => (
          <div key={s.label} className="flex items-baseline gap-3">
            <dt className="eyebrow">{s.label}</dt>
            <dd className="figure text-2xl font-semibold tracking-[-0.03em]">{s.value}</dd>
          </div>
        ))}
      </dl>
    </Link>
  );
}
