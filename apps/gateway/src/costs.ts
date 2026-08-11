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
 * able to say by whom, sourced from the party that paid.
 *
 * What it will not say is the cost in ETH, because KeeperHub does not report
 * one — see `gasUnits`. Stating a price would mean inventing a gas price, and
 * a fabricated figure is worse here than an absent one.
 *
 * Two further limits. Only direct executions are counted — the marketplace
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
  /**
   * Total gas **units** consumed across the sample.
   *
   * Units, not wei, and the distinction is not pedantry. KeeperHub returns
   * `gasCostWei` and `gasUsedWei` with byte-identical values — 96519, 73859,
   * 56555 — which are plausible gas amounts for an ERC-20 transfer and absurd
   * as wei (96519 wei is 9.7e-14 ETH). The field is named for a cost and
   * carries a count.
   *
   * So this reports the count. Converting it to ETH would have meant
   * multiplying by a gas price nothing here was given, and the first version of
   * this code did exactly that and rendered "0.000000 ETH" under a sentence
   * claiming gas had been paid — a number that is worse than no number.
   */
  gasUnits: string;
  /** How many runs actually reported a gas figure, so the total is scopeable. */
  gasReportedBy: number;
  /** Median rather than mean: one slow confirmation should not set the figure. */
  medianMs: number | null;
  /** KeeperHub's own classification of what went wrong, not ours. */
  failures: Record<string, number>;
  /** Where these numbers come from, so the claim is checkable. */
  source: string;
};

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
  let reported = 0;
  for (const r of direct) {
    /*
     * `gasUsedWei` deliberately, and only as a count. The sibling `gasCostWei`
     * holds the identical value, so neither is a price — taking either as money
     * would be reading the field name instead of the field.
     */
    if (r.gasUsedWei) {
      gas += BigInt(r.gasUsedWei);
      reported += 1;
    }
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
    gasUnits: gas.toString(),
    gasReportedBy: reported,
    medianMs,
    failures,
    source: `${KH_API}/api/analytics/runs`,
  };
}
