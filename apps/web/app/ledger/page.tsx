"use client";

/**
 * The decision record, in public.
 *
 * Every verdict this system reaches is written down: what was checked, what was
 * decided, and why. Then it is readable by anyone, without a credential.
 *
 * That second part is the whole point. KeeperHub keeps an agent-action trail and
 * exposes no agent-reachable read -- both routes are session-cookie only and no
 * MCP tool touches it -- so an agent cannot audit the service deciding whether
 * it gets paid. A record only the deciding party can read is a private note.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { PageHead } from "@/components/page-head";
import { VerdictMark, stateOf } from "@/components/verdict";

const GATEWAY =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "https://gateway-production-944e.up.railway.app";

/**
 * One decision, as the authority recorded it.
 *
 * This page used to read the x402 audit trail from a product that no longer
 * exists, and the route it fetched was deleted with it — so it 404'd while
 * looking, to a reader, like an empty ledger. It now reads the authority's own
 * decision record: what was asked for, what was decided, and which rule decided
 * it, refusals included.
 */
type Entry = {
  at: string;
  decision: string;
  failedRule: string | null;
  reason: string;
  amount: number;
  recipient: string;
  category: string;
  transactionHash?: string;
};

const money = (n: number) => `$${n.toFixed(2)}`;

export default function LedgerPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${GATEWAY}/authority/log?limit=100`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `gateway returned ${res.status}`);
        return;
      }
      // The API already answers newest-first, which is the order a reader wants.
      setEntries(body.entries as Entry[]);
      /*
       * `returned`, not `total` — the route has no `total` field, so this used
       * to set undefined, pass the `!== null` guard, and render "  decisions on
       * record" with a hole where the number goes.
       */
      setTotal(body.returned as number);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHead rubric="Decision ledger" title="Every verdict, and why.">
        A service that decides whether an agent gets paid owes it an account of why. This is that
        account — persisted, append-only, and readable without a credential.
      </PageHead>

      <div className="shell py-10 sm:py-14">
      <div className="flex flex-wrap items-center gap-5">
        <button type="button" className="btn btn--outline" onClick={() => void load()} disabled={loading}>
          Re-read
        </button>
        {total !== null && (
          <span className="figure text-xs text-[var(--ink-3)]">
            the last {total} decision{total === 1 ? "" : "s"}, every agent
          </span>
        )}
      </div>

      {loading && entries.length === 0 && (
        <div className="mt-10 divide-y divide-[var(--line)]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-6 border-b border-[var(--line)] py-4">
              <span className="h-3 w-28 bg-[var(--line)]" />
              <span className="h-3 w-24 bg-[var(--line)]" />
              <span className="h-3 flex-1 bg-[var(--line)]" />
            </div>
          ))}
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500 mt-4">Reading the record…</p>
        </div>
      )}

      {error && (
        <p className="mt-8 border-t-2 border-[var(--refused)] pt-3 font-mono text-sm text-[var(--ink-3)]">
          {error}
        </p>
      )}

      {!error && !loading && entries.length === 0 && (
        <p className="mt-10 max-w-[60ch] text-sm leading-relaxed text-[var(--ink-3)]">
          Nothing struck yet. Ask the{" "}
          <Link href="/authority" className="text-[var(--ink)] underline underline-offset-4">
            authority to spend
          </Link>{" "}
          and the first verdict lands here.
        </p>
      )}

      {entries.length > 0 && (
        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[840px] border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-[var(--ink)] text-left">
                <th className="text-[11px] font-medium uppercase tracking-wide text-neutral-500 px-3 pb-2 text-left">When</th>
                <th className="text-[11px] font-medium uppercase tracking-wide text-neutral-500 px-3 pb-2 text-right">Asked for</th>
                <th className="text-[11px] font-medium uppercase tracking-wide text-neutral-500 px-3 pb-2 text-left">Decision</th>
                <th className="text-[11px] font-medium uppercase tracking-wide text-neutral-500 px-3 pb-2 text-left">Rule</th>
                <th className="text-[11px] font-medium uppercase tracking-wide text-neutral-500 px-3 pb-2 text-left">Why</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.at}-${i}`} className="border-b border-[var(--line)] align-top">
                  <td className="figure whitespace-nowrap px-3 py-4 text-xs text-[var(--ink-3)]">
                    {e.at.replace("T", " ").slice(0, 19)}
                  </td>
                  <td className="figure whitespace-nowrap px-3 py-4 text-right text-xs">{money(e.amount)}</td>
                  <td className="whitespace-nowrap px-3 py-4">
                    <VerdictMark state={stateOf(e.decision)} />
                    {/*
                      * The mark says approved / refused / held; this says which
                      * of the refusals it was. A reader comparing two rows
                      * needs the constant, not a colour they have to decode.
                      */}
                    <span className="figure mt-1 block text-[10px] text-[var(--ink-4)]">{e.decision}</span>
                  </td>
                  <td className="figure whitespace-nowrap px-3 py-4 text-xs">{e.failedRule ?? "—"}</td>
                  <td className="max-w-[46ch] px-3 py-4 font-mono text-xs leading-relaxed text-[var(--ink-3)]">
                    {e.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-16 border-t border-[var(--line)] pt-8">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Why this is public</h2>
        <p className="mt-4 max-w-[68ch] text-pretty text-sm leading-relaxed text-[var(--ink-3)]">
          KeeperHub records agent actions to an append-only trail and gives agents no way to read
          it: both routes are session-cookie only and no MCP tool exposes it. So the agent whose
          payment is being decided cannot see the reasoning. This record is served without
          authentication for the same reason a decision states the rule and the number it compared:
          if you have to take it on trust, it is not an account of anything.
        </p>
        <p className="mt-4 max-w-[68ch] text-pretty text-sm leading-relaxed text-[var(--ink-3)]">
          Append-only, and persisted in a database rather than on the container&rsquo;s disk. A
          record that empties on redeploy is a debug buffer.
        </p>
      </div>
      </div>
    </>
  );
}
