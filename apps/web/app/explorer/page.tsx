"use client";

/**
 * Every intent the escrow has seen, assembled from events in the browser.
 *
 * The refunded rows are the ones to read. Each carries the verifier's own words
 * for why the money went back, recorded on chain at the time of the decision --
 * not a status this page inferred afterwards.
 */

import { useIntents, useEscrowed } from "outcome-sdk/react";
import { ExternalLink, Loader2 } from "lucide-react";

import { VerdictBadge } from "@/components/verdict";
import { amount, short, tx, DEPLOYMENT } from "@/lib/outcome";
import { cn } from "@/lib/utils";
import { PageHead } from "@/components/page-head";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="field-label">{label}</div>
      <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-[var(--ink-3)]">{hint}</div>}
    </div>
  );
}

export default function ExplorerPage() {
  const { data: rows, loading, error } = useIntents();
  const { data: escrowed } = useEscrowed();

  const released = rows?.filter((r) => r.state === "released").length ?? 0;
  const refunded = rows?.filter((r) => r.state === "refunded").length ?? 0;
  const open = rows?.filter((r) => r.state === "open").length ?? 0;

  return (
    <>
      <PageHead rubric="Intent explorer" title="Every intent, read from the chain.">
        Assembled from {DEPLOYMENT.chainName} events in your browser. Nothing here is seeded, cached,
        or served from a database — each row is an event this contract emitted.
      </PageHead>

      <div className="shell py-10 sm:py-14">

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Intents" value={rows ? String(rows.length) : "—"} />
        <Stat label="Released" value={String(released)} hint="work proven on chain" />
        <Stat label="Refunded" value={String(refunded)} hint="work not proven" />
        <Stat
          label="In escrow"
          value={escrowed === undefined ? "—" : amount(escrowed)}
          hint={open ? `${open} awaiting a verdict` : "nothing outstanding"}
        />
      </div>

      {loading && (
        <div className="mt-10 flex items-center gap-2 font-mono text-sm text-[var(--ink-3)]">
          <Loader2 className="size-4 animate-spin" /> reading the chain…
        </div>
      )}

      {error && (
        <p className="mt-10 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-4 font-mono text-sm text-[var(--ink-3)]">
          {error}
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="mt-8 overflow-x-auto rounded-[10px] border border-[var(--line)]">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--surface)] text-left field-label">
                <th className="px-4 py-3 font-medium">Intent</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Outcome</th>
                <th className="px-4 py-3 font-medium">Why</th>
                <th className="px-4 py-3 font-medium">Tx</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.intentId} className="border-b border-[var(--line)] last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-[var(--ink-3)]">
                    {short(r.intentId, 8, 6)}
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums">
                    {amount(r.amount)}{" "}
                    <span className="text-xs text-[var(--ink-3)]">{DEPLOYMENT.tokenSymbol}</span>
                  </td>
                  <td className="px-4 py-3">
                    {r.state === "open" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--line)] px-2.5 py-0.5 font-mono text-xs text-[var(--ink-3)]">
                        awaiting verdict
                      </span>
                    ) : (
                      <VerdictBadge proven={r.state === "released"} />
                    )}
                  </td>
                  <td
                    className={cn(
                      "max-w-[380px] px-4 py-3 font-mono text-xs leading-relaxed",
                      r.state === "refunded" ? "text-[var(--refused)]" : "text-[var(--ink-3)]"
                    )}
                  >
                    {r.reason ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={tx(r.outcomeTransactionHash ?? r.claimTransactionHash)}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1 font-mono text-xs text-[var(--ink-3)] transition-colors hover:text-[var(--ink)]"
                    >
                      {short(r.outcomeTransactionHash ?? r.claimTransactionHash)}
                      <ExternalLink className="size-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows && rows.length === 0 && (
        <p className="mt-10 font-mono text-sm text-[var(--ink-3)]">
          No intents in the last 45,000 blocks.
        </p>
      )}
    </div>
    </>
  );
}
