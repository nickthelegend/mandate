"use client";

/**
 * The dashboard tray under the hero.
 *
 * Three cards, and the numbers in them are read from Sepolia in the visitor's
 * own browser -- not screenshots and not seeded. That matters more here than
 * anywhere else on the site: this is the first thing a visitor sees, and a
 * product whose entire argument is "check it yourself" cannot open with a
 * picture of a dashboard.
 *
 * While the chain read is in flight every figure is an em dash. A zero that
 * later becomes a nineteen is a number the page was willing to state before it
 * knew.
 */

import { useState } from "react";
import Link from "next/link";
import { useIntents, useEscrowed } from "outcome-sdk/react";
import { ChevronDown, ChevronRight, TrendingDown, TrendingUp, X } from "lucide-react";

import { Gauge } from "@/components/gauge";
import { amount, DEPLOYMENT } from "@/lib/outcome";

const DEAD = "0x000000000000000000000000000000000000dEaD";

export function DashboardPreview() {
  const { data: rows, error } = useIntents();
  const { data: escrowed } = useEscrowed();
  const [metric, setMetric] = useState<"released" | "refunded">("released");

  const known = rows !== undefined && !error;
  const total = rows?.length ?? 0;
  const released = rows?.filter((r) => r.state === "released").length ?? 0;
  const refunded = rows?.filter((r) => r.state === "refunded").length ?? 0;

  const dash = (v: string | number) => (known ? String(v) : "—");
  const pct = (n: number) => (known && total > 0 ? Math.round((n / total) * 100) : 0);

  return (
    <div className="tray mx-auto w-full max-w-[880px] p-4 sm:p-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {/* 1 — what the chain says happened. */}
        <div className="rounded-2xl bg-white p-5">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="font-medium text-[var(--brand)]">Settled</span>
            <span className="text-neutral-500">All time</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[28px] font-semibold leading-none">{dash(total)}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
              <TrendingUp className="size-3" />
              {dash(released)} paid
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-neutral-500">Intents this escrow has seen</p>

          <p className="mt-4 text-center text-[11px] text-neutral-500">
            {metric === "released" ? "Proven and paid" : "Not proven, refunded"}
          </p>
          <div className="mt-1 text-[var(--ink)]">
            <Gauge
              value={pct(metric === "released" ? released : refunded)}
              color="#ef4d23"
              showLabels
              min={String(metric === "released" ? released : refunded)}
              max={String(total)}
            />
          </div>

          <div className="mt-3 flex rounded-full bg-neutral-100 p-1">
            {(["released", "refunded"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                className={`flex-1 rounded-full px-3 py-1.5 text-[12px] capitalize transition-colors ${
                  metric === m ? "bg-white text-[var(--ink)] shadow-sm" : "text-neutral-500"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* 2 — the check itself, as it appears on /verify. */}
        <div className="flex flex-col gap-3 rounded-2xl bg-white p-5">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="font-medium text-[var(--brand)]">Verify a payment</span>
            <span className="text-neutral-500">no key</span>
          </div>

          <div>
            <label className="block text-[12px] text-neutral-700">Paid in which token</label>
            <div className="mt-1 flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-[12px]">
              <span className="figure truncate">{DEPLOYMENT.token.slice(0, 18)}…</span>
              <ChevronDown className="size-3.5 shrink-0 text-neutral-400" />
            </div>
          </div>

          <div>
            <label className="block text-[12px] text-neutral-700">Who had to be paid</label>
            <div className="mt-1 flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-[12px]">
              <span className="figure truncate">{DEAD.slice(0, 18)}…</span>
              <ChevronDown className="size-3.5 shrink-0 text-neutral-400" />
            </div>
          </div>

          <div>
            <label className="block text-[12px] text-neutral-700">At least (base units)</label>
            <div className="mt-1 flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-[12px]">
              <span className="text-neutral-400">#</span>
              <span className="figure">1000000</span>
            </div>
          </div>

          <div className="mt-auto flex items-center gap-4 pt-1">
            <Link href="/verify" className="btn btn--plain !text-[13px]">
              Check it
            </Link>
            <Link href="/docs" className="text-[12px] text-neutral-600 underline underline-offset-4">
              Read the docs
            </Link>
            <X className="ml-auto size-4 text-neutral-300" />
          </div>
        </div>

        {/* 3 — the state nobody else renders. */}
        <div className="rounded-2xl bg-white p-5">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="font-medium text-[var(--brand)]">Refused</span>
            <span className="text-neutral-500">held back</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[28px] font-semibold leading-none">{dash(refunded)}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-red-600">
              <TrendingDown className="size-3" />
              paid nobody
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-neutral-500">
            Reported success, moved no money
          </p>

          <p className="mt-4 text-center text-[11px] text-neutral-500">Still in escrow</p>
          <div className="mt-1 text-[var(--ink)]">
            <Gauge value={pct(total - released - refunded)} color="#9ca3af" />
          </div>

          <p className="mt-2 text-center text-[12px]">
            <span className="figure font-semibold">
              {escrowed === undefined ? "—" : amount(escrowed)}
            </span>{" "}
            <span className="text-neutral-500">{DEPLOYMENT.tokenSymbol} held</span>
          </p>

          <Link
            href="/ledger"
            className="mt-3 flex items-center justify-center gap-1 rounded-full bg-neutral-100 px-3 py-2 text-[12px] text-neutral-700 transition-colors hover:bg-neutral-200"
          >
            Every verdict, and why
            <ChevronRight className="size-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
