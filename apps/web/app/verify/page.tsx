"use client";

/**
 * The interactive claim.
 *
 * Everything else on this site is something I am telling you. This is the page
 * where you check it yourself: paste any Sepolia transaction, say who was
 * supposed to be paid and how much, and the verdict is computed in your browser
 * from the receipt. No backend answers this question, which is the only way an
 * answer about trust is worth anything.
 */

import { useState } from "react";
import { useVerify } from "outcome-sdk/react";
import { ArrowRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { VerdictPanel } from "@/components/verdict";
import { DEPLOYMENT, tx } from "@/lib/outcome";

const DEAD = "0x000000000000000000000000000000000000dEaD";

/** Both endings, from the live deployment, so the page is useful with one click. */
const SAMPLES = [
  {
    label: "Paid — a real transfer",
    blurb: "1.00 tUSDC actually reached the recipient.",
    transactionHash: "0x749a8459508963b5a85533767b934c20bc3c38656984d711380046cd5346665a",
    recipient: DEAD,
    minAmount: "1000000",
  },
  {
    label: "Mined, moved nothing",
    blurb: "status 0x1, one log, an Approval — and no money.",
    transactionHash: "0xf2c4055d08d9b52ca5f4f89fe2cd6c670e2204c2458e4731fd3c0ae0eda5073c",
    recipient: DEAD,
    minAmount: "2000000",
  },
] as const;

export default function VerifyPage() {
  const { verify, result, loading, error, reset } = useVerify();
  const [form, setForm] = useState({ transactionHash: "", recipient: DEAD, minAmount: "1000000" });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const load = (s: (typeof SAMPLES)[number]) => {
    reset();
    setForm({ transactionHash: s.transactionHash, recipient: s.recipient, minAmount: s.minAmount });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void verify(form);
  };

  return (
    <div className="mx-auto max-w-3xl px-5 py-14">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        Check a payment yourself.
      </h1>
      <p className="mt-3 text-pretty leading-relaxed text-[var(--quiet)]">
        Paste any {DEPLOYMENT.chainName} transaction. Your browser fetches the receipt from a public
        RPC and reads it for a real ERC-20 <code className="font-mono text-[var(--ink)]">Transfer</code>{" "}
        to the recipient. Nothing is sent to a server — this page has none.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {SAMPLES.map((s) => (
          <button
            key={s.transactionHash}
            onClick={() => load(s)}
            className="group rounded-[2px] border border-[var(--rule)] px-3 py-2 text-left transition-colors hover:border-[var(--ink)] hover:bg-[var(--bench)]"
          >
            <span className="block text-sm font-medium">{s.label}</span>
            <span className="block font-mono text-xs text-[var(--quiet)]">{s.blurb}</span>
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="hash" className="font-mono text-xs uppercase tracking-wide text-[var(--quiet)]">
            Transaction hash
          </Label>
          <Input
            id="hash"
            required
            spellCheck={false}
            placeholder="0x…"
            value={form.transactionHash}
            onChange={set("transactionHash")}
            className="font-mono text-sm"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <div className="space-y-2">
            <Label htmlFor="to" className="font-mono text-xs uppercase tracking-wide text-[var(--quiet)]">
              Who had to be paid
            </Label>
            <Input
              id="to"
              required
              spellCheck={false}
              value={form.recipient}
              onChange={set("recipient")}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="amt" className="font-mono text-xs uppercase tracking-wide text-[var(--quiet)]">
              At least (base units)
            </Label>
            <Input
              id="amt"
              required
              inputMode="numeric"
              value={form.minAmount}
              onChange={set("minAmount")}
              className="font-mono text-sm"
            />
          </div>
        </div>

        <Button type="submit" disabled={loading} className="gap-2">
          {loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
          {loading ? "Reading the receipt…" : "Read the receipt"}
        </Button>
      </form>

      {error && (
        <p className="mt-6 rounded-[2px] border border-[var(--rule)] bg-[var(--bench)] p-4 font-mono text-sm text-[var(--quiet)]">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-6 space-y-3">
          <VerdictPanel verdict={result} />
          <a
            href={tx(form.transactionHash)}
            target="_blank"
            rel="noopener"
            className="inline-block font-mono text-xs text-[var(--quiet)] underline-offset-4 hover:text-[var(--ink)] hover:underline"
          >
            open this transaction on Etherscan and check for yourself →
          </a>
        </div>
      )}

      <div className="mt-14 rounded-[2px] border border-[var(--rule)] bg-[var(--bench)] p-5">
        <h2 className="font-mono text-sm font-medium">The same call, in your own code</h2>
        <pre className="mt-3 overflow-x-auto rounded-[2px] bg-[var(--sheet)] p-4 font-mono text-xs leading-relaxed text-[var(--ink)]">
{`import { OutcomeClient } from "outcome-sdk";

const outcome = new OutcomeClient({
  provider: "${DEPLOYMENT.rpcUrl}",
  escrow: "${DEPLOYMENT.escrow}",
  token: "${DEPLOYMENT.token}",
});

const verdict = await outcome.verify({
  transactionHash,
  recipient,
  minAmount: 1_000_000n,
});
// -> { proven, reason, observed, proof }`}
        </pre>
      </div>
    </div>
  );
}
