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

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const GATEWAY =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "https://gateway-production-944e.up.railway.app";

type Entry = {
  at: string;
  tool: string;
  intentId?: string;
  outcome: string;
  detail: string;
};

/** Verdicts that mean money moved, so the row can say so at a glance. */
const GOOD = new Set(["proven", "release:succeeded"]);
const BAD = new Set(["not_proven", "refund:succeeded", "refused"]);

export default function LedgerPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${GATEWAY}/audit?limit=100`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `gateway returned ${res.status}`);
        return;
      }
      // Newest first for reading; the API hands them back oldest-first.
      setEntries([...(body.entries as Entry[])].reverse());
      setTotal(body.total as number);
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
    <div className="mx-auto max-w-4xl px-5 py-14">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        Every verdict, and why.
      </h1>
      <p className="mt-3 max-w-2xl text-pretty leading-relaxed text-muted-foreground">
        A service that decides whether an agent gets paid owes it an account of why. This is that
        account — persisted, append-only, and readable without a credential.
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Refresh
        </Button>
        {total !== null && (
          <span className="font-mono text-xs text-muted-foreground">
            {total} decision{total === 1 ? "" : "s"} on record
          </span>
        )}
      </div>

      {error && (
        <p className="mt-6 rounded-lg border border-border/70 bg-secondary/40 p-4 font-mono text-sm text-muted-foreground">
          {error}
        </p>
      )}

      {!error && !loading && entries.length === 0 && (
        <p className="mt-8 font-mono text-sm text-muted-foreground">
          Nothing on record yet. Run the{" "}
          <a href="/outcome/demo/" className="underline underline-offset-4 hover:text-foreground">
            live demo
          </a>{" "}
          and a verdict will appear here.
        </p>
      )}

      {entries.length > 0 && (
        <div className="mt-8 overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-secondary/30 text-left font-mono text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Decision</th>
                <th className="px-4 py-3 font-medium">Verdict</th>
                <th className="px-4 py-3 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const good = GOOD.has(e.outcome);
                const bad = BAD.has(e.outcome);
                return (
                  <tr key={`${e.at}-${i}`} className="border-b border-border/40 last:border-0 align-top">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                      {e.at.replace("T", " ").slice(0, 19)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{e.tool}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs",
                          good && "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
                          bad && "border-amber-400/30 bg-amber-400/10 text-amber-300",
                          !good && !bad && "border-border/70 text-muted-foreground"
                        )}
                      >
                        {good && <CheckCircle2 className="size-3" />}
                        {bad && <XCircle className="size-3" />}
                        {e.outcome}
                      </span>
                    </td>
                    <td className="max-w-[420px] px-4 py-3 font-mono text-xs leading-relaxed text-muted-foreground">
                      {e.detail}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-12 rounded-xl border border-border/60 bg-secondary/20 p-5">
        <h2 className="font-mono text-sm font-medium">Why this is public</h2>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
          KeeperHub records agent actions to an append-only trail and gives agents no way to read
          it: both routes are session-cookie only and no MCP tool exposes it. So the agent whose
          payment is being decided cannot see the reasoning. This record is served without
          authentication for the same reason the verifier reads a receipt instead of a status byte —
          if you have to take it on trust, it is not evidence.
        </p>
        <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">
          Append-only, and persisted in a database rather than on the container&rsquo;s disk. A
          record that empties on redeploy is a debug buffer.
        </p>
      </div>
    </div>
  );
}
