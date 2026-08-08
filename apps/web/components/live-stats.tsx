"use client";

import Link from "next/link";
import { useIntents, useEscrowed } from "outcome-sdk/react";

import { amount, DEPLOYMENT } from "@/lib/outcome";

/**
 * The headline numbers, read live.
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
      <div className="rounded-[2px] border border-[var(--assay)] bg-transparent p-5">
        <div className="font-mono text-xs uppercase tracking-wide text-[var(--assay)]">
          could not read the chain
        </div>
        <p className="mt-2 font-mono text-xs leading-relaxed text-[var(--quiet)]">{error}</p>
        <a
          href={`${DEPLOYMENT.explorer}/address/${DEPLOYMENT.escrow}#events`}
          target="_blank"
          rel="noopener"
          className="mt-3 inline-block font-mono text-xs underline-offset-4 hover:text-[var(--ink)] hover:underline"
        >
          read the events on Etherscan instead →
        </a>
      </div>
    );
  }

  return (
    <Link
      href="/explorer"
      className="group grid gap-px overflow-hidden rounded-[2px] border border-[var(--rule)] bg-border/60 sm:grid-cols-4"
    >
      {stats.map((s) => (
        <div key={s.label} className="bg-background p-5 transition-colors group-hover:bg-[var(--bench)]">
          <div className="font-mono text-xs uppercase tracking-wide text-[var(--quiet)]">
            {s.label}
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold tabular-nums">{s.value}</div>
        </div>
      ))}
    </Link>
  );
}
