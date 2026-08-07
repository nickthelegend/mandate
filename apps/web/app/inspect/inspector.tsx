"use client";

/**
 * KeeperHub's own execution record, opened up.
 *
 * Everywhere else on this site shows what the chain says. This shows what the
 * executor says about itself: what it simulated, what it sent, whether the gas
 * was sponsored, and how long it took to confirm.
 *
 * That record is what a resource server is implicitly trusting when it decides
 * to serve, and a record only the trusting party can read is not evidence. So
 * it is readable here without a key -- the gateway proxies it, because a static
 * site must never hold one.
 */

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Fuel, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tx } from "@/lib/outcome";
import { cn } from "@/lib/utils";

const GATEWAY =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "https://gateway-production-944e.up.railway.app";

type Execution = {
  executionId: string;
  status: string;
  type?: string;
  transactionHash?: string;
  transactionLink?: string;
  sponsored?: boolean;
  gasUsedWei?: string;
  error?: string;
  createdAt?: string;
  completedAt?: string;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all">{children}</dd>
    </>
  );
}

export function Inspector() {
  const params = useSearchParams();
  const [id, setId] = useState("");
  const [data, setData] = useState<Execution | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async (executionId: string) => {
    if (!executionId.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`${GATEWAY}/execution/${executionId.trim()}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `gateway returned ${res.status}`);
        return;
      }
      setData(body as Execution);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Deep link from the demo page, so a settlement leads straight to its record.
  useEffect(() => {
    const fromUrl = params.get("id");
    if (fromUrl) {
      setId(fromUrl);
      void lookup(fromUrl);
    }
  }, [params, lookup]);

  const elapsed =
    data?.createdAt && data?.completedAt
      ? `${((Date.parse(data.completedAt) - Date.parse(data.createdAt)) / 1000).toFixed(1)}s`
      : null;

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        Open the execution record.
      </h1>
      <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
        Every settlement here runs through KeeperHub, which keeps its own account of what it did.
        Paste an execution id to read it — simulated, sent, sponsored, confirmed. No key required:
        a record only the trusting party can read is not evidence.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void lookup(id);
        }}
        className="mt-8 flex flex-wrap gap-3"
      >
        <Input
          value={id}
          onChange={(e) => setId(e.target.value)}
          spellCheck={false}
          placeholder="ks5osjqmpj0lrw3exqhov"
          className="min-w-[260px] flex-1 font-mono text-sm"
        />
        <Button type="submit" disabled={loading} className="gap-2">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          {loading ? "Reading…" : "Read the record"}
        </Button>
      </form>

      <p className="mt-3 font-mono text-xs text-muted-foreground">
        Run the <a href="/outcome/demo/" className="underline underline-offset-4 hover:text-foreground">live demo</a>{" "}
        and it will link you straight here with its own id.
      </p>

      {error && (
        <p className="mt-6 rounded-lg border border-border/70 bg-secondary/40 p-4 font-mono text-sm text-muted-foreground">
          {error}
        </p>
      )}

      {data && (
        <div className="mt-8 space-y-4">
          <div
            className={cn(
              "rounded-xl border p-5",
              data.status === "completed"
                ? "border-emerald-400/25 bg-emerald-400/[0.04]"
                : "border-amber-400/25 bg-amber-400/[0.04]"
            )}
          >
            <div className="flex flex-wrap items-center gap-3">
              {data.status === "completed" && <CheckCircle2 className="size-4 text-emerald-400" />}
              <span className="font-mono text-sm font-medium">{data.status}</span>
              {data.sponsored && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 font-mono text-xs text-emerald-300">
                  <Fuel className="size-3" /> gas sponsored
                </span>
              )}
            </div>

            <dl className="mt-4 grid gap-1.5 font-mono text-xs sm:grid-cols-[150px_1fr]">
              <Row label="execution id">{data.executionId}</Row>
              {data.type && <Row label="type">{data.type}</Row>}
              {data.gasUsedWei && <Row label="gas used">{data.gasUsedWei}</Row>}
              {elapsed && <Row label="accepted to confirmed">{elapsed}</Row>}
              {data.error && <Row label="error">{data.error}</Row>}
              {data.transactionHash && (
                <Row label="transaction">
                  <a
                    href={tx(data.transactionHash)}
                    target="_blank"
                    rel="noopener"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    {data.transactionHash}
                  </a>
                </Row>
              )}
            </dl>
          </div>

          <div className="rounded-xl border border-border/60 bg-secondary/20 p-5">
            <h2 className="font-mono text-sm font-medium">What this record does not tell you</h2>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
              That <code className="font-mono text-foreground/80">status: completed</code> means
              KeeperHub sent the transaction and it mined. It does not mean value moved — a
              transaction can mine, emit no <code className="font-mono text-foreground/80">Transfer</code>,
              and pay nobody. That is the gap this project fills, and why the settlement is checked
              against the receipt before anything is released.
            </p>
            {data.transactionHash && (
              <Button asChild variant="outline" size="sm" className="mt-4">
                <a href={`/outcome/verify/?hash=${data.transactionHash}`}>Check this one yourself</a>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
