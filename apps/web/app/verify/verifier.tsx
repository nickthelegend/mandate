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

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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

/*
 * Validated here, before the SDK is touched.
 *
 * Without this the raw failures reach the user: a malformed hash surfaces as
 * ethers' "could not coalesce error", and a non-numeric amount as "Cannot
 * convert abc to a BigInt". Both are internals, and neither tells anyone what
 * to do about it.
 *
 * Kept in JS rather than a `pattern` attribute on the input: native constraint
 * validation refuses the submit event outright, so the handler below never runs
 * and the message never renders -- the field just goes red with nothing to read.
 */
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DIGITS = /^\d+$/;

function validate(f: { transactionHash: string; recipient: string; minAmount: string }) {
  const errors: Partial<Record<keyof typeof f, string>> = {};
  if (!HASH.test(f.transactionHash.trim())) {
    errors.transactionHash = "A transaction hash is 0x followed by 64 hex characters.";
  }
  if (!ADDRESS.test(f.recipient.trim())) {
    errors.recipient = "An address is 0x followed by 40 hex characters.";
  }
  if (!DIGITS.test(f.minAmount.trim())) {
    errors.minAmount = "Base units are whole digits only — 1000000, not 1.0.";
  }
  return errors;
}

export function Verifier() {
  const params = useSearchParams();
  const { verify, result, loading, error, reset } = useVerify();
  const [form, setForm] = useState({ transactionHash: "", recipient: DEAD, minAmount: "1000000" });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [fromLink, setFromLink] = useState(false);

  /*
   * Arriving from the execution record, which links here with the hash it just
   * showed you. Without this the deep link lands on an empty form and the whole
   * "check this one yourself" invitation is a dead end.
   *
   * The hash is all that carries over. Who was supposed to be paid is the
   * question the visitor has to answer -- prefilling a guess would put a verdict
   * on screen that nobody asked for.
   */
  useEffect(() => {
    const hash = params.get("hash");
    if (!hash) return;
    setForm((f) => ({ ...f, transactionHash: hash }));
    setFromLink(true);
  }, [params]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    // Clear a field's error as soon as the user starts correcting it.
    setErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev));
  };

  const load = (s: (typeof SAMPLES)[number]) => {
    reset();
    setErrors({});
    setFromLink(false);
    setForm({ transactionHash: s.transactionHash, recipient: s.recipient, minAmount: s.minAmount });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    void verify({
      transactionHash: form.transactionHash.trim(),
      recipient: form.recipient.trim(),
      minAmount: form.minAmount.trim(),
    });
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
            aria-invalid={errors.transactionHash ? true : undefined}
            aria-describedby={errors.transactionHash ? "hash-error" : undefined}
            placeholder="0x…"
            value={form.transactionHash}
            onChange={set("transactionHash")}
            className="font-mono text-sm"
          />
          {errors.transactionHash && (
            <p id="hash-error" className="text-xs text-[var(--assay)]">{errors.transactionHash}</p>
          )}
          {fromLink && !errors.transactionHash && (
            <p className="text-xs text-[var(--quiet)]">
              Filled from the execution record. Now say who was supposed to be paid.
            </p>
          )}
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
              aria-invalid={errors.recipient ? true : undefined}
              aria-describedby={errors.recipient ? "to-error" : undefined}
              value={form.recipient}
              onChange={set("recipient")}
              className="font-mono text-sm"
            />
            {errors.recipient && (
              <p id="to-error" className="text-xs text-[var(--assay)]">{errors.recipient}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="amt" className="font-mono text-xs uppercase tracking-wide text-[var(--quiet)]">
              At least (base units)
            </Label>
            <Input
              id="amt"
              required
              inputMode="numeric"
              aria-invalid={errors.minAmount ? true : undefined}
              aria-describedby={errors.minAmount ? "amt-error" : undefined}
              value={form.minAmount}
              onChange={set("minAmount")}
              className="font-mono text-sm"
            />
            {errors.minAmount && (
              <p id="amt-error" className="text-xs text-[var(--assay)]">{errors.minAmount}</p>
            )}
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
