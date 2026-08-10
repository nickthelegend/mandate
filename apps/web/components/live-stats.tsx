"use client";

/**
 * The authority's standing totals, read live from the gateway.
 *
 * These used to be escrow counts — intents seen, amount held, work released —
 * from a product this no longer is. What matters now is what the authority has
 * actually decided: how many spends it judged, how many it refused, and how
 * much has been let through today. A number that describes the wrong product
 * is worse than no number, because a reader takes it as the point.
 *
 * Written as one line of running totals rather than four cards of
 * big-number-over-small-label: these are the subtotals struck at the foot of a
 * run, and a printout does not box its own subtotals.
 *
 * Shows an em dash while loading rather than a zero. A zero that later becomes
 * a three is a number the page was willing to state before it knew, which is a
 * small version of exactly the habit this project objects to.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { GATEWAY } from "@/lib/mandate";

type Totals = {
  decisions: { total: number; approved: number; refused: number };
  spentToday: number;
  rules: { budgets: { daily: number } };
};

export function LiveStats() {
  const [t, setT] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${GATEWAY}/authority`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        if (d.error) setError(d.error);
        else setT(d);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, []);

  const dash = (v: string | number) => (t ? String(v) : "—");

  const stats = [
    { label: "Decisions", value: dash(t?.decisions.total ?? 0) },
    { label: "Refused", value: dash(t?.decisions.refused ?? 0) },
    { label: "Approved", value: dash(t?.decisions.approved ?? 0) },
    {
      label: "Spent today",
      value: t ? `$${t.spentToday.toFixed(2)} / $${t.rules.budgets.daily.toFixed(2)}` : "—",
    },
  ];

  return (
    <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
      {stats.map((s) => (
        <span key={s.label} className="inline-flex items-baseline gap-2">
          <span className="figure text-lg font-medium">{s.value}</span>
          <span className="text-[12px] text-[var(--ink-3)]">{s.label}</span>
        </span>
      ))}
      <Link
        href="/authority"
        className="text-[12px] text-[var(--ink-3)] underline-offset-4 hover:text-[var(--ink)] hover:underline"
      >
        {error ? "the authority is not answering — open it" : "spend it down yourself →"}
      </Link>
    </div>
  );
}
