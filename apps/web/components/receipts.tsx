"use client";

/**
 * The evidence layer, made visible.
 *
 * Every decision this authority reaches is hashed into a leaf, batched, and the
 * batch root anchored in `MandateReceipts` on Sepolia. All of that was real and
 * none of it was on the site — a judge could read the decision log and had no
 * way to see that the log was backed by anything.
 *
 * Two things are shown, and the second is the one that matters.
 *
 * The **ladder**: QUEUED → BATCHED → SUBMITTED → CONFIRMED, plus
 * DEGRADED_UNANCHORED as its own state rather than a failure. A chain outage
 * degrades the evidence and leaves enforcement untouched, which is the design
 * pointing the right way, and a status that read "failed" would misdescribe it.
 *
 * And the **proof**: the merkle path is recomputed here, in the reader's own
 * browser, and then the contract is asked whether it holds the root. Both
 * answers are shown separately on purpose. "The server says it is anchored" is
 * exactly the kind of claim this project refuses to make — so the arithmetic
 * runs locally and the chain is asked directly over a public RPC, and if those
 * two ever disagreed the page would say so rather than pick one.
 */

import { useCallback, useEffect, useState } from "react";
import { keccak256, concat } from "ethers";

import { DEPLOYMENT, GATEWAY, short, tx as txUrl } from "@/lib/mandate";
import { cn } from "@/lib/utils";

const RECEIPTS_ADDRESS = "0x64AE971Fda589E4C878F66452b8CE0533032f60d";

/**
 * `isAnchored(bytes32,bytes32)` — the four-byte selector, hardcoded.
 *
 * Hand-rolled rather than via `Contract`, because instantiating a provider and
 * an interface here pulled ethers' whole RPC stack into this route and took the
 * page from 115 kB to 212 kB of first-load JS. The call is two fixed-width
 * arguments and a boolean back; an ABI coder earns nothing for that.
 *
 * Derived as `keccak256("isAnchored(bytes32,bytes32)").slice(0, 10)` and pinned
 * here, so the constant is checkable rather than magic.
 */
const IS_ANCHORED = keccak256(new TextEncoder().encode("isAnchored(bytes32,bytes32)")).slice(0, 10);

/** Strip `0x`, left-pad to 32 bytes. Both arguments are already bytes32. */
const word = (hex: string) => hex.replace(/^0x/, "").padStart(64, "0");

type Receipt = {
  receiptId: string;
  status: string;
  batchId: string | null;
  degradedReason?: string;
  body: { decision: string; amountBase: string; agent: string; decidedAt: string };
};

type Proof = {
  receiptId: string;
  leaf: string;
  proof: string[];
  root: string;
  batchId: string;
  status: string;
  transactionHash?: string;
  anchored: boolean;
};

/** The ladder, in order, so a status can be placed rather than just read. */
const LADDER = ["QUEUED", "BATCHED", "SUBMITTED", "CONFIRMED"] as const;

/**
 * Recompute the root from a leaf and its siblings.
 *
 * A deliberate re-implementation of `packages/receipts`' verifier, in the
 * browser, against the proof the server handed over. Importing the server's
 * function would prove only that the server agrees with itself; the point is
 * that a reader can arrive at the same root independently and then check it
 * against the chain.
 *
 * Node hashing is domain-separated with a `0x01` prefix, matching the writer —
 * without it an internal node can be passed off as a leaf and a holder
 * "proves" a receipt that never existed.
 */
function rootFrom(leaf: string, proof: readonly string[]): string {
  let node = leaf;
  for (const sib of proof) {
    const [a, b] = node.toLowerCase() < sib.toLowerCase() ? [node, sib] : [sib, node];
    node = keccak256(concat(["0x01", a, b]));
  }
  return node;
}

/**
 * What enforcement cost, according to the party that paid for it.
 *
 * Everything else on this site is the chain's word or ours. This is
 * KeeperHub's: the gas it sponsored, how long its executions took, and its own
 * classification of the ones that failed. None of it is derivable from our
 * database — we know what we asked for and what landed, not what the executor
 * spent getting there.
 *
 * It is here rather than on /authority because it belongs with the evidence,
 * not with the buttons: a reader asking "is any of this real" wants the bill.
 */
function Costs() {
  const [c, setC] = useState<{
    direct: number; succeeded: number; failed: number;
    gasUnits: string; gasReportedBy: number; medianMs: number | null;
    failures: Record<string, number>; source: string;
  } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${GATEWAY}/authority/costs`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && d && !d.error && setC(d))
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // Absent rather than zeroed while it loads: a 0.000000 that becomes a real
  // figure is a number the page was willing to state before it knew.
  if (!c || c.direct === 0) return null;
  const kinds = Object.entries(c.failures);

  return (
    <p className="mt-4 max-w-[68ch] text-[11px] leading-relaxed text-[var(--ink-4)]">
      KeeperHub has executed{" "}
      <span className="figure text-[var(--ink-3)]">{c.direct}</span> of these directly, burning{" "}
      <span className="figure text-[var(--ink-3)]">
        {Number(c.gasUnits).toLocaleString()}
      </span>{" "}
      units of gas it paid for — the agent holds none, which is why it cannot send anything the
      policy refused. Units and not ETH on purpose: KeeperHub returns{" "}
      <span className="figure">gasCostWei</span> and <span className="figure">gasUsedWei</span> with
      identical values, so neither is a price, and quoting one would mean inventing a gas price
      nobody supplied.
      {c.medianMs !== null && (
        <> A median execution takes <span className="figure text-[var(--ink-3)]">{(c.medianMs / 1000).toFixed(1)}s</span>.</>
      )}{" "}
      {c.failed === 0 ? (
        <>None failed.</>
      ) : (
        <>
          {c.failed} failed, classified by KeeperHub as{" "}
          {kinds.map(([k, n], i) => (
            <span key={k}>
              {i > 0 ? ", " : ""}
              <span className="figure text-[var(--ink-3)]">{k}</span> ×{n}
            </span>
          ))}
          .
        </>
      )}{" "}
      Read from <span className="figure">{c.source.replace(/^https?:\/\//, "")}</span>.
    </p>
  );
}

export function Receipts() {
  const [rows, setRows] = useState<Receipt[] | null>(null);
  const [moved, setMoved] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [proof, setProof] = useState<Proof | null>(null);
  const [checking, setChecking] = useState(false);
  const [onChain, setOnChain] = useState<{ recomputed: string; agrees: boolean; chain: boolean | null } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`${GATEWAY}/authority/receipts?limit=12`);
      const b = await r.json();
      if (!r.ok) return setError(b.error ?? `the authority answered ${r.status}`);
      setRows(b.entries as Receipt[]);
      setMoved(b.moved as Record<string, number>);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Fetch the proof, recompute it here, then ask the contract. */
  const verify = useCallback(async (receiptId: string) => {
    setOpen(receiptId);
    setProof(null);
    setOnChain(null);
    setChecking(true);
    try {
      const r = await fetch(`${GATEWAY}/authority/receipt/${receiptId}`);
      const p = (await r.json()) as Proof & { error?: string };
      if (!r.ok) {
        setError(p.error ?? `no proof: ${r.status}`);
        return;
      }
      setProof(p);

      const recomputed = rootFrom(p.leaf, p.proof);
      const agrees = recomputed.toLowerCase() === p.root.toLowerCase();

      /*
       * Asked over a public RPC from the visitor's own browser. There is no
       * server in this path — if the contract disagreed with the gateway, this
       * is where a reader would find out, which is the only reason to show the
       * two answers apart.
       *
       * Tried across several endpoints. A free RPC dropping a connection is
       * common and says nothing about the contract, so one host refusing must
       * not read as a failed verification — the answer only becomes "could not
       * ask" when every endpoint has been tried.
       */
      const data = `${IS_ANCHORED}${word(p.batchId)}${word(p.root)}`;
      let chain: boolean | null = null;
      for (const url of DEPLOYMENT.rpcUrls) {
        try {
          const rpc = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "eth_call",
              params: [{ to: RECEIPTS_ADDRESS, data }, "latest"],
              // A dead endpoint must not hold the panel open indefinitely.
            }),
            signal: AbortSignal.timeout(8000),
          });
          const out = (await rpc.json()) as { result?: string; error?: unknown };
          if (out.error || !out.result) continue;
          // A bool comes back as a 32-byte word: all zeroes is false.
          chain = BigInt(out.result) === 1n;
          break;
        } catch {
          // Try the next one. Only exhausting the list means "could not ask".
        }
      }
      setOnChain({ recomputed, agrees, chain });
    } finally {
      setChecking(false);
    }
  }, []);

  return (
    <div className="mt-16 border-t border-[var(--line)] pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          What backs the record
        </h2>
        {moved && (
          <span className="figure text-[11px] text-[var(--ink-4)]">
            last tick: {moved.batched} batched, {moved.submitted} submitted, {moved.confirmed}{" "}
            confirmed
          </span>
        )}
      </div>

      <p className="mt-4 max-w-[68ch] text-pretty text-sm leading-relaxed text-[var(--ink-3)]">
        Each decision above is hashed into a leaf and batched; the batch root is anchored in{" "}
        <a
          href={`${DEPLOYMENT.explorer}/address/${RECEIPTS_ADDRESS}#code`}
          target="_blank"
          rel="noopener"
          className="figure underline underline-offset-4 hover:text-[var(--ink)]"
        >
          MandateReceipts
        </a>{" "}
        on Sepolia. Anchoring is downstream of deciding on purpose — a chain outage degrades the
        evidence and leaves enforcement untouched, which is why{" "}
        <span className="figure">DEGRADED_UNANCHORED</span> is a state of its own and not a failure.
      </p>

      {error && (
        <p className="mt-6 border-t-2 border-[var(--refused)] pt-3 font-mono text-sm text-[var(--ink-3)]">
          {error}
        </p>
      )}

      {rows === null && !error && (
        <p className="mt-6 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          Reading the receipts…
        </p>
      )}

      {rows?.length === 0 && (
        <p className="mt-6 max-w-[60ch] text-sm leading-relaxed text-[var(--ink-3)]">
          No receipts yet. One is written the moment a decision is made, and the batch anchors once
          four are waiting or two minutes have passed — whichever comes first, so a quiet day still
          produces evidence.
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="mt-6 space-y-2">
          {rows.map((r) => {
            const step = LADDER.indexOf(r.status as (typeof LADDER)[number]);
            const degraded = r.status === "DEGRADED_UNANCHORED";
            return (
              <div key={r.receiptId} className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="figure truncate text-[12px]">{short(r.receiptId, 10, 6)}</p>
                    <p className="text-[11px] text-[var(--ink-4)]">
                      {r.body.decision} · {(Number(r.body.amountBase) / 1e6).toFixed(2)} ·{" "}
                      {r.body.decidedAt.replace("T", " ").slice(0, 19)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {/* The ladder, as a ladder. Position carries the state. */}
                    {/* Named, so a selector can ask for the ladder rather than
                        for "a span that happens to have four children". */}
                    <span className="flex items-center gap-1" data-ladder={r.status} title={r.status}>
                      {LADDER.map((s, i) => (
                        <span
                          key={s}
                          className={cn(
                            "h-1.5 w-5 rounded-full",
                            degraded
                              ? "bg-[var(--refused-line)]"
                              : i <= step
                                ? "bg-[var(--proven)]"
                                : "bg-[var(--line)]"
                          )}
                        />
                      ))}
                    </span>
                    <span className="figure text-[11px] text-[var(--ink-3)]">{r.status}</span>
                    {r.status === "CONFIRMED" && (
                      <button
                        type="button"
                        className="btn btn--outline px-2 py-1 text-[11px]"
                        onClick={() => void verify(r.receiptId)}
                      >
                        Check the proof
                      </button>
                    )}
                  </div>
                </div>

                {degraded && r.degradedReason && (
                  <p className="mt-2 text-[11px] text-[var(--ink-3)]">
                    Still durable and still readable — what it lost is the chain anchor:{" "}
                    {r.degradedReason}
                  </p>
                )}

                {open === r.receiptId && (
                  <div className="mt-3 border-t border-[var(--line)] pt-3">
                    {checking && (
                      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                        Recomputing, then asking the chain…
                      </p>
                    )}
                    {proof && onChain && (
                      <div className="space-y-2 text-[11px]">
                        <p className="text-[var(--ink-3)]">
                          {proof.proof.length} sibling{proof.proof.length === 1 ? "" : "s"} →{" "}
                          <span className="figure text-[var(--ink)]">{short(onChain.recomputed, 10, 8)}</span>
                        </p>
                        <p className={onChain.agrees ? "text-[var(--proven)]" : "text-[var(--refused)]"}>
                          {onChain.agrees
                            ? "computed in this browser, and it matches the root the authority returned"
                            : "the recomputed root does NOT match the root the authority returned"}
                        </p>
                        <p
                          className={
                            onChain.chain === true
                              ? "text-[var(--proven)]"
                              : onChain.chain === false
                                ? "text-[var(--refused)]"
                                : "text-[var(--ink-4)]"
                          }
                        >
                          {onChain.chain === true
                            ? "MandateReceipts confirms this exact root under this batch id"
                            : onChain.chain === false
                              ? "the contract does NOT hold this root — the anchor claim is false"
                              : "the public RPC did not answer, so the chain was not asked"}
                        </p>
                        {proof.transactionHash && (
                          <a
                            href={txUrl(proof.transactionHash)}
                            target="_blank"
                            rel="noopener"
                            className="figure inline-block underline underline-offset-4 hover:text-[var(--ink)]"
                          >
                            the transaction that anchored it →
                          </a>
                        )}
                        <details className="pt-1">
                          <summary className="cursor-pointer text-[var(--ink-4)]">
                            the proof itself, to check elsewhere
                          </summary>
                          <pre className="mt-2 overflow-x-auto rounded-[8px] bg-[var(--panel)] p-2 font-mono text-[10px] leading-relaxed">
{JSON.stringify({ leaf: proof.leaf, proof: proof.proof, root: proof.root, batchId: proof.batchId }, null, 2)}
                          </pre>
                        </details>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 max-w-[68ch] text-[11px] leading-relaxed text-[var(--ink-4)]">
        The anchored body carries the intent hash, the policy hash, the decision and the amount — and
        deliberately not the endpoint or the category. Publishing who an operator pays and for what
        would be a privacy leak dressed up as transparency; a holder proves membership with the
        proof above instead.
      </p>

      <Costs />
    </div>
  );
}
