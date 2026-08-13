"use client";

/**
 * Write a policy, and watch its hash move.
 *
 * The console can only ever show a policy that already exists. This is the step
 * before that: an operator setting limits, and the commitment those limits
 * produce being recomputed on every keystroke — in the visitor's own browser,
 * with the same `mandate-policy` canonicaliser the gateway and the registry use.
 *
 * The point it exists to make is not that a form can emit JSON. It is that the
 * hash is a function of the document and nothing else, so moving a single
 * number produces a different commitment, and a different commitment is one the
 * registry has never seen. Change the daily budget from five to fifty and the
 * badge flips from ANCHORED to NOT ANCHORED, which is exactly what the gateway
 * would do to a spend judged against it.
 */

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";

import { hashCanonicalJson, canonicalize } from "mandate-policy/canon";
import { cn } from "@/lib/utils";

/*
 * The document the live authority is enforcing, byte for byte — this is
 * `apps/gateway/policy.json`. It is the starting point so that the first thing
 * on screen is the real thing, and any edit is visibly a departure from it.
 */
const ANCHORED_RULES = {
  budgets: { daily: 5, token: "USDT" },
  perCallCap: 1,
  onPerCallCapExceeded: "BLOCK",
  escalateAbove: 1000,
  categories: { allow: ["market-data"], deny: [] as string[] },
  recipients: { allow: [] as string[], deny: [] as string[] },
  vendors: {
    minScoreLCB: 20,
    onBelowFloor: "ESCALATE",
    onScoreUnavailable: "ESCALATE",
    staleScoreMaxAgeH: 24,
  },
  agents: { allowWorkerIds: [] as string[], denyWorkerIds: [] as string[] },
  duplicates: { ttlMin: 60, keys: ["taskHash", "endpoint", "paramsHash"] },
  cooldowns: { sameServiceMin: 0 },
  rateLimit: { callsPerHour: 20 },
  expiry: "2026-09-09T00:00:00Z",
};

/** The commitment the registry holds for that document, on Sepolia. */
const ANCHORED_HASH = hashCanonicalJson(ANCHORED_RULES);

type Draft = {
  daily: number;
  perCallCap: number;
  onExceeded: "BLOCK" | "ESCALATE";
  escalateAbove: number;
  category: string;
  minScoreLCB: number;
  onBelowFloor: "ESCALATE" | "BLOCK";
  ttlMin: number;
  callsPerHour: number;
};

const START: Draft = {
  daily: 5,
  perCallCap: 1,
  onExceeded: "BLOCK",
  escalateAbove: 1000,
  category: "market-data",
  minScoreLCB: 20,
  onBelowFloor: "ESCALATE",
  ttlMin: 60,
  callsPerHour: 20,
};

/** Build the full rules document from the handful of fields worth exposing. */
function rulesFrom(d: Draft) {
  return {
    ...ANCHORED_RULES,
    budgets: { daily: d.daily, token: "USDT" },
    perCallCap: d.perCallCap,
    onPerCallCapExceeded: d.onExceeded,
    escalateAbove: d.escalateAbove,
    categories: { allow: [d.category], deny: [] as string[] },
    vendors: { ...ANCHORED_RULES.vendors, minScoreLCB: d.minScoreLCB, onBelowFloor: d.onBelowFloor },
    duplicates: { ttlMin: d.ttlMin, keys: ["taskHash", "endpoint", "paramsHash"] },
    rateLimit: { callsPerHour: d.callsPerHour },
  };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-[13px] font-medium tracking-[-0.01em]">{label}</p>
        <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--ink-4)]">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Num({
  value,
  onChange,
  prefix,
  suffix,
  step = 1,
  min = 0,
}: {
  value: number;
  onChange: (n: number) => void;
  prefix?: string;
  suffix?: string;
  step?: number;
  min?: number;
}) {
  return (
    <label className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 focus-within:border-[var(--brand)]">
      {prefix && <span className="figure text-[12px] text-[var(--ink-4)]">{prefix}</span>}
      <input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="figure w-16 bg-transparent text-right text-[13px] outline-none"
      />
      {suffix && <span className="figure text-[11px] text-[var(--ink-4)]">{suffix}</span>}
    </label>
  );
}

function Toggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg border border-[var(--line)] bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={cn(
            "figure rounded-[6px] px-2.5 py-1 text-[11px] transition-colors",
            value === o ? "bg-[var(--ink)] text-white" : "text-[var(--ink-4)] hover:text-[var(--ink)]"
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function PolicyBuilder() {
  const [d, setD] = useState<Draft>(START);
  const [copied, setCopied] = useState<string | null>(null);

  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const { rules, canonical, hash, anchored } = useMemo(() => {
    const rules = rulesFrom(d);
    /*
     * RFC 8785, not `JSON.stringify` — two documents differing only in key
     * order are the same policy and must produce the same commitment, or an
     * operator could re-anchor identical rules and get a different hash.
     */
    const canonical = canonicalize(rules);
    const hash = hashCanonicalJson(rules);
    return { rules, canonical, hash, anchored: hash.toLowerCase() === ANCHORED_HASH.toLowerCase() };
  }, [d]);

  const copy = (what: string, text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };

  const command = `node scripts/new-policy.mjs apps/gateway/policy.json`;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start">
      {/* The rules an operator sets. */}
      <div className="card-p card-p--bordered p-5">
        <p className="field-label">The rules</p>

        <div className="mt-2">
          <Field label="Daily budget" hint="Everything this agent may spend in a day.">
            <Num value={d.daily} onChange={set("daily")} prefix="$" suffix="USDT" />
          </Field>
          <Field label="Per-call cap" hint="The most any single payment may be.">
            <Num value={d.perCallCap} onChange={set("perCallCap")} prefix="$" step={0.5} />
          </Field>
          <Field label="Over the cap" hint="Refuse outright, or send it to a person.">
            <Toggle value={d.onExceeded} options={["BLOCK", "ESCALATE"] as const} onChange={set("onExceeded")} />
          </Field>
          <Field label="Category allowed" hint="Anything outside this is refused by name.">
            <input
              value={d.category}
              onChange={(e) => set("category")(e.target.value)}
              className="figure w-40 rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--brand)]"
            />
          </Field>
          <Field label="Vendor score floor" hint="Compared against the lower confidence bound, never the raw score.">
            <Num value={d.minScoreLCB} onChange={set("minScoreLCB")} suffix="LCB" />
          </Field>
          <Field label="Below the floor" hint="A new payee with no history lands here.">
            <Toggle value={d.onBelowFloor} options={["ESCALATE", "BLOCK"] as const} onChange={set("onBelowFloor")} />
          </Field>
          <Field label="Duplicate window" hint="Identical task, endpoint and params inside this window is refused.">
            <Num value={d.ttlMin} onChange={set("ttlMin")} suffix="min" />
          </Field>
          <Field label="Rate limit" hint="Calls an hour, however small each one is.">
            <Num value={d.callsPerHour} onChange={set("callsPerHour")} suffix="/hr" />
          </Field>
        </div>

        <button
          type="button"
          onClick={() => setD(START)}
          className="figure mt-4 text-[11.5px] text-[var(--ink-4)] underline-offset-4 hover:text-[var(--brand)] hover:underline"
        >
          reset to the anchored policy
        </button>
      </div>

      {/* What that produces. */}
      <div className="space-y-4">
        <div
          className={cn(
            "card-p p-5 transition-colors",
            anchored ? "card-p--bordered" : "border border-[#f2c0ba] bg-[#fdefed]"
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="field-label">keccak256 of the canonical document</p>
            <span
              className={cn(
                "figure rounded-full px-2.5 py-1 text-[10.5px] font-semibold tracking-wide",
                anchored ? "bg-[var(--brand-wash)] text-[var(--brand)]" : "bg-white text-[#b91c1c]"
              )}
            >
              {anchored ? "ANCHORED ON SEPOLIA" : "NOT ANCHORED"}
            </span>
          </div>

          <button
            type="button"
            onClick={() => copy("hash", hash)}
            className="figure mt-3 flex w-full items-start gap-2 break-all text-left text-[12.5px] leading-relaxed text-[var(--ink)] hover:text-[var(--brand)]"
          >
            {copied === "hash" ? (
              <Check className="mt-0.5 size-3.5 shrink-0 text-[var(--brand)]" />
            ) : (
              <Copy className="mt-0.5 size-3.5 shrink-0 text-[var(--ink-4)]" />
            )}
            {hash}
          </button>

          <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--ink-3)]">
            {anchored ? (
              <>
                This is the document the gateway is enforcing right now, and the registry holds this
                exact hash. Move any value above and it stops being that document.
              </>
            ) : (
              <>
                The registry has never seen this hash. Every spend judged against these rules is
                refused with <span className="figure">PolicyAnchorMismatch</span> until somebody
                re-anchors it — which is a transaction, signed by KeeperHub, that an agent has no key
                to send.
              </>
            )}
          </p>
        </div>

        <div className="card-p card-p--bordered p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="field-label">Canonical JSON · RFC 8785</p>
            <button
              type="button"
              onClick={() => copy("json", JSON.stringify({ version: 1, rules }, null, 2))}
              className="figure flex items-center gap-1.5 text-[11.5px] text-[var(--ink-4)] hover:text-[var(--brand)]"
            >
              {copied === "json" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {copied === "json" ? "copied" : "copy policy.json"}
            </button>
          </div>
          {/*
           * The canonical form, not the pretty one — this is the exact byte
           * string that gets hashed, so showing anything else would be showing
           * a different thing than the number above it.
           */}
          <pre className="figure no-scrollbar mt-3 max-h-[168px] overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-[var(--ink-3)]">
            {canonical}
          </pre>
        </div>

        <div className="card-p card-p--bordered p-5">
          <p className="field-label">Then put it on chain, through KeeperHub</p>
          <button
            type="button"
            onClick={() => copy("cmd", command)}
            className="figure mt-2.5 flex w-full items-center gap-2 rounded-lg bg-[var(--dark)] px-3 py-2.5 text-left text-[12px] text-white/90 hover:text-white"
          >
            {copied === "cmd" ? (
              <Check className="size-3.5 shrink-0 text-[var(--brand)]" />
            ) : (
              <Copy className="size-3.5 shrink-0 text-white/40" />
            )}
            {command}
          </button>
          <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--ink-3)]">
            KeeperHub&rsquo;s Execute API sends the registration, so the registry records{" "}
            <em>its</em> wallet as the policy&rsquo;s owner — not ours, and not the agent&rsquo;s.
            That is what makes the limit binding rather than advisory: there is no key anywhere in
            the agent&rsquo;s process that can widen it.
          </p>
        </div>
      </div>
    </div>
  );
}
