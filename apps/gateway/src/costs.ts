/**
 * What enforcement costs, according to the executor.
 *
 * Every number elsewhere in this project is either the chain's or our own. This
 * one is KeeperHub's: gas it sponsored, how long its executions took, and its
 * own taxonomy for the ones that failed. None of it is derivable from our
 * database — we know what we asked for and what landed, not what the executor
 * spent getting there or how it classified a failure.
 *
 * That is the reason to read it rather than compute something similar. A
 * project that claims "the agent holds no ETH and gas is sponsored" should be
 * able to say by whom and how much, sourced from the party that paid.
 *
 * Two deliberate limits. Only direct executions are counted — the marketplace
 * workflow runs through the same account and its runs are somebody else's
 * story. And a failure is reported under KeeperHub's own `errorCategory`
 * rather than a label of ours, because the whole point is that this is their
 * account of their work.
 */

const KH_API = process.env.KEEPERHUB_BASE_URL ?? "https://app.keeperhub.com";

export type Run = {
  id: string;
  source: string;
  status: string;
  durationMs: number | null;
  directType: string | null;
  gasCostWei: string | null;
  gasUsedWei: string | null;
  transactionHashes: string[];
  errorCategory: string | null;
  startedAt: string;
};

export type Costs = {
  /** How many executions this is drawn from. */
  sampled: number;
  /** Only the ones this authority caused: transfers and contract calls. */
  direct: number;
  succeeded: number;
  failed: number;
  /** Total gas KeeperHub paid, in wei, across the sample. */
  gasWei: string;
  /** The same, as ETH, so it is readable without counting zeroes. */
  gasEth: string;
  /** Median rather than mean: one slow confirmation should not set the figure. */
  medianMs: number | null;
  /** KeeperHub's own classification of what went wrong, not ours. */
  failures: Record<string, number>;
  /** Where these numbers come from, so the claim is checkable. */
  source: string;
};

/** Wei to ETH with six decimals, without pulling in a formatting library. */
function toEth(wei: bigint): string {
  const unit = 10n ** 18n;
  const whole = wei / unit;
  const frac = (wei % unit).toString().padStart(18, "0").slice(0, 6);
  return `${whole}.${frac}`;
}

export async function readCosts(apiKey: string, limit = 100): Promise<Costs> {
  const res = await fetch(`${KH_API}/api/analytics/runs?limit=${limit}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`KeeperHub analytics answered ${res.status}`);
  const body = (await res.json()) as { runs?: Run[] };
  const runs = body.runs ?? [];

  /*
   * `source === "direct"` is what this authority produced. Workflow runs on the
   * same account belong to the marketplace listing, and folding them in would
   * attribute somebody else's gas to enforcement.
   */
  const direct = runs.filter((r) => r.source === "direct");

  let gas = 0n;
  for (const r of direct) {
    // gasCostWei is what was actually paid; gasUsedWei is units, not cost. Only
    // the first is money, and it is null on runs that never reached the chain.
    if (r.gasCostWei) gas += BigInt(r.gasCostWei);
  }

  const durations = direct
    .map((r) => r.durationMs)
    .filter((d): d is number => typeof d === "number")
    .sort((a, b) => a - b);
  const medianMs = durations.length
    ? durations.length % 2
      ? durations[(durations.length - 1) / 2]
      : Math.round((durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2)
    : null;

  const failures: Record<string, number> = {};
  for (const r of direct) {
    if (r.status === "success") continue;
    const k = r.errorCategory ?? r.status ?? "unclassified";
    failures[k] = (failures[k] ?? 0) + 1;
  }

  return {
    sampled: runs.length,
    direct: direct.length,
    succeeded: direct.filter((r) => r.status === "success").length,
    failed: direct.filter((r) => r.status !== "success").length,
    gasWei: gas.toString(),
    gasEth: toEth(gas),
    medianMs,
    failures,
    source: `${KH_API}/api/analytics/runs`,
  };
}
