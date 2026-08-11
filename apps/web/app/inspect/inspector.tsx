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
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Fuel, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tx } from "@/lib/mandate";
import { unreachable } from "@/lib/unreachable";
import { cn } from "@/lib/utils";
import { PageHead } from "@/components/page-head";

/** The gateway's own shape for an execution id, mirrored so it can be checked locally. */
const EXECUTION_ID = /^[a-z0-9]{6,64}$/i;

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
      <dt className="text-[var(--ink-3)]">{label}</dt>
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
    const id = executionId.trim();
    if (!id) return;

    /*
     * Checked here before the request, against the same shape the gateway
     * enforces. The server would answer 400 either way and the message would
     * read the same, but a round trip to be told the id was never plausible is
     * a slower answer and a red 400 in the console of anyone with devtools
     * open. Malformed input is knowable locally, so it is answered locally.
     */
    if (!EXECUTION_ID.test(id)) {
      setData(null);
      setError("An execution id is 6-64 letters and digits. Every approved spend on the authority carries one.");
      return;
    }

    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`${GATEWAY}/execution/${id}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `gateway returned ${res.status}`);
        return;
      }
      setData(body as Execution);
    } catch (e: unknown) {
      setError(unreachable(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Deep link, so an approved spend can lead straight to its execution record.
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
    <>
      <PageHead rubric="KeeperHub" title="Open the execution record.">
        Every settlement here runs through KeeperHub, which keeps its own account of what it did.
        Paste an execution id to read it — simulated, sent, sponsored, confirmed. No key required:
        a record only the trusting party can read is not evidence.
      </PageHead>

      <div className="shell py-10 sm:py-14">
      <div className="max-w-3xl">

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

      <p className="mt-3 font-mono text-xs text-[var(--ink-3)]">
        Every approved spend on the{" "}
        <Link href="/authority" className="underline underline-offset-4 hover:text-[var(--ink)]">
          authority
        </Link>{" "}
        carries one of these ids — take it from there and read it here.
      </p>

      {error && (
        <p className="mt-6 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-4 font-mono text-sm text-[var(--ink-3)]">
          {error}
        </p>
      )}

      {data && (
        <div className="mt-8 space-y-4">
          <div
            className={cn(
              "rounded-[10px] border p-5",
              data.status === "completed"
                ? "border-[var(--line)] bg-[var(--surface)]"
                : "border-[var(--refused)] bg-transparent"
            )}
          >
            <div className="flex flex-wrap items-center gap-3">
              {data.status === "completed" && <CheckCircle2 className="size-4 text-[var(--ink)]" />}
              <span className="font-mono text-sm font-medium">{data.status}</span>
              {data.sponsored && (
                <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-2.5 py-0.5 font-mono text-xs text-[var(--ink)]">
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
                    className="underline underline-offset-4 hover:text-[var(--ink)]"
                  >
                    {data.transactionHash}
                  </a>
                </Row>
              )}
            </dl>
          </div>

          <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-5">
            <h2 className="font-mono text-sm font-medium">What this record does not tell you</h2>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-[var(--ink-3)]">
              That <code className="font-mono text-[var(--ink)]">status: completed</code> means
              KeeperHub sent the transaction and it mined. It does not mean value moved — a
              transaction can mine, emit no <code className="font-mono text-[var(--ink)]">Transfer</code>,
              and pay nobody. Nor does it say whether the spend was <em>allowed</em>: that decision
              was made before this record existed, and it is the one worth reading.
            </p>
            {/*
              * Straight to Etherscan's own log view.
              *
              * This used to point at an internal /verify page that was deleted
              * with the product it belonged to — so the button inviting a
              * sceptic to check for themselves was a 404, which is the worst
              * possible link to have broken.
              */}
            {data.transactionHash && (
              <Button asChild variant="outline" size="sm" className="mt-4">
                <a href={tx(data.transactionHash)} target="_blank" rel="noreferrer">
                  Read the logs on Etherscan
                </a>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
      </div>
    </>
  );
}
