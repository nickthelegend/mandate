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
  const { data: rows } = useIntents();
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

  return (
    <Link
      href="/explorer"
      className="group grid gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60 sm:grid-cols-4"
    >
      {stats.map((s) => (
        <div key={s.label} className="bg-background p-5 transition-colors group-hover:bg-secondary/20">
          <div className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
            {s.label}
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold tabular-nums">{s.value}</div>
        </div>
      ))}
    </Link>
  );
}
