import { VerdictMark } from "@/components/verdict";

/**
 * One settlement, summarised the way a statement line is.
 *
 * The two facts that matter sit side by side and never move: what the
 * facilitator claimed, and what the chain actually showed. Putting them in one
 * row is the whole argument -- the reader does not have to hold two numbers in
 * their head across a scroll to notice they disagree.
 */
export function Settlement({
  label,
  claim,
  proven,
  observed,
  reason,
  outcome,
  href,
}: {
  label: string;
  claim: string;
  proven: boolean;
  observed: string;
  reason: string;
  outcome: string;
  href: string;
}) {
  return (
    <div className={`settlement ${proven ? "settlement--proven" : "settlement--refused"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-semibold tracking-[-0.01em]">{label}</span>
        <VerdictMark state={proven ? "proven" : "not_proven"} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-[10px] bg-white/70 px-3 py-2.5">
          <p className="text-[11px] font-medium text-[var(--ink-3)]">Facilitator claimed</p>
          <p className="figure mt-0.5 text-sm font-semibold text-[var(--ink)]">{claim}</p>
        </div>
        <div className="rounded-[10px] bg-white/70 px-3 py-2.5">
          <p className="text-[11px] font-medium text-[var(--ink-3)]">Chain actually moved</p>
          <p
            className={`figure mt-0.5 text-sm font-semibold ${
              proven ? "text-[var(--brand-ink)]" : "text-[#b42318]"
            }`}
          >
            {observed}
          </p>
        </div>
      </div>

      <p className="mt-3.5 text-[13px] leading-relaxed text-[var(--ink-2)]">{reason}</p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.06] pt-3">
        <span className="figure text-xs font-semibold text-[var(--ink)]">{outcome}</span>
        <a
          href={href}
          target="_blank"
          rel="noopener"
          className="figure text-xs text-[var(--ink-3)] underline-offset-4 hover:text-[var(--brand)] hover:underline"
        >
          open on Etherscan →
        </a>
      </div>
    </div>
  );
}
