import Link from "next/link";

import { LiveStats } from "@/components/live-stats";
import { CodeTabs } from "@/components/code-tabs";
import { Settlement } from "@/components/settlement";
import { DEPLOYMENT, tx } from "@/lib/outcome";

/*
 * Built for a judge with ninety seconds.
 *
 * One claim, one proof, one action. The page states the gap in a sentence,
 * shows the same payment settled twice with opposite results, and sends them to
 * the live demo. Everything else the project built is below the fold or in the
 * footer, because a first viewport that offers ten destinations offers none.
 */

const DEAD = "0x000000000000000000000000000000000000dEaD";

/*
 * One demand, settled twice. Both verified against Sepolia from this repo
 * before being written down: same token, same recipient, same amount, and the
 * only difference is whether the money actually moved.
 */
const DEMAND = {
  amount: "1000000",
  token: "0x0d864A625c280F7f9B9AD024d12F94f5D6DCCF13",
  recipient: DEAD,
};

const SETTLEMENTS = [
  {
    label: "A lying facilitator",
    claim: "success: true",
    proven: false,
    observed: "0",
    hash: "0x6db7218d717f5be3c3b37f386593bf0bdf3760b0407ac1145c617ac172136603",
    reason: "No Transfer to 0x…dEaD in this receipt. It mined, emitted a log, and moved nothing.",
    outcome: "HTTP 402 — article withheld",
  },
  {
    label: "An honest facilitator",
    claim: "success: true",
    proven: true,
    observed: "1000000",
    hash: "0x3aac3134ba7c4ce4e12c04e206ad7ce468318607fdb7a8e7ad85e91a70fe72ee",
    reason: "Observed 1000000 reaching 0x…dEaD across 2 logs.",
    outcome: "HTTP 200 — article served",
  },
] as const;

const PROOF = [
  {
    title: "The agent holds no private key and no ETH",
    body: "It signs nothing. KeeperHub owns the only signer in the loop, and the wallet that funds delivery has 0.0 ETH.",
    hash: "0xef3a8f8806cce8f4cc98a286a37063ca68386862dd70c3953b77bfb92123409a",
  },
  {
    title: "The merchant accepts x402 without holding ETH",
    body: "Settlement runs through KeeperHub's execute API, so accepting agent payments costs no gas and needs no top-ups.",
    hash: "0x3dba2aa47415056197620e9a40341668d1bf7907b968b66c03dfe9cfff0f3d25",
  },
  {
    title: "Only KeeperHub can move escrowed funds",
    body: "The admin's verifier role was revoked. Calling release as the deployer now reverts NotVerifier.",
    hash: "0xe5e25335aa323c837fa91807058dbd0c5b66b1eb76673fb33648c3b2c0999ae3",
  },
];

export default function Home() {
  return (
    <>
      {/* One sentence, one proof, one action. */}
      <section className="on-navy">
        <div className="shell py-16 sm:py-24">
          <p className="eyebrow">
            <span className="inline-block size-1.5 rounded-full bg-[var(--lime)]" />
            {DEPLOYMENT.chainName} · settled through KeeperHub
          </p>

          <h1 className="mt-6 max-w-3xl text-[clamp(2.25rem,1.5rem+2.6vw,3.75rem)] font-bold leading-[1.08] tracking-[-0.035em] text-balance">
            x402 pays on a promise. Outcome pays on a receipt.
          </h1>

          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-[var(--on-navy-2)]">
            A facilitator reports <code className="text-white">success: true</code> and every x402
            server hands over the goods. Nobody reads the transaction. Outcome does — and refuses to
            release the money when the chain disagrees.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/demo" className="btn btn--lime">
              Run the live demo
            </Link>
            <Link href="/verify" className="btn btn--ghost-navy">
              Verify any payment
            </Link>
          </div>

          <p className="figure mt-10 text-xs text-[var(--on-navy-3)]">
            npm i outcome-sdk · npx outcome-mcp · 88 tests · two verified contracts
          </p>
        </div>
      </section>

      {/* The proof, immediately. Same demand, opposite outcomes. */}
      <section className="dotfield border-b border-[var(--line)]">
        <div className="shell py-16">
          <h2 className="max-w-2xl text-2xl font-bold tracking-[-0.025em] text-balance sm:text-3xl">
            The same payment, settled twice.
          </h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--ink-3)]">
            Both facilitators reported success. One moved the money and one did not. Both
            transactions are live and open to inspection.
          </p>

          <div className="card-p mt-8 p-5">
            <p className="text-xs font-semibold text-[var(--ink-3)]">What was demanded, both times</p>
            <p className="figure mt-1.5 text-[13px] break-all text-[var(--ink)]">
              {DEMAND.amount} of {DEMAND.token} to {DEMAND.recipient}
            </p>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {SETTLEMENTS.map((s) => (
              <Settlement key={s.hash} {...s} href={tx(s.hash)} />
            ))}
          </div>
        </div>
      </section>

      <section className="shell py-14">
        <LiveStats />
      </section>

      {/* Three claims a neighbouring project cannot copy. */}
      <section className="border-y border-[var(--line)] bg-[var(--surface)]">
        <div className="shell py-16">
          <h2 className="max-w-2xl text-2xl font-bold tracking-[-0.025em] text-balance sm:text-3xl">
            Three things you can check on chain right now.
          </h2>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {PROOF.map((c) => (
              <div key={c.hash} className="card-p flex flex-col p-5">
                <h3 className="text-[15px] font-semibold leading-snug tracking-[-0.01em]">
                  {c.title}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--ink-3)]">{c.body}</p>
                <a
                  href={tx(c.hash)}
                  target="_blank"
                  rel="noopener"
                  className="figure mt-4 text-xs text-[var(--brand)] underline-offset-4 hover:underline"
                >
                  {c.hash.slice(0, 16)}… on Etherscan →
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What you install. */}
      <section className="shell py-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start">
          <div>
            <h2 className="text-2xl font-bold tracking-[-0.025em] text-balance sm:text-3xl">
              One call closes the gap.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[var(--ink-3)]">
              The SDK runs anywhere — browser, edge, or an agent runtime. The MCP server needs no
              configuration: the defaults point at the live deployment, and every read-only tool
              works without a credential.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-[var(--ink-3)]">
              The party being asked to trust a payment is the one who most needs to check it, so
              checking must not require a server or a key. This site is built on the published
              package, not a private copy of the logic.
            </p>
            <Link href="/docs" className="btn btn--brand mt-7">
              Read the quickstart
            </Link>
          </div>
          <CodeTabs />
        </div>
      </section>

      <section className="on-navy">
        <div className="shell py-16">
          <h2 className="max-w-2xl text-2xl font-bold tracking-[-0.025em] text-balance sm:text-3xl">
            No model in the money path.
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[var(--on-navy-2)]">
            Every comparable project resolves payment disputes with an LLM judge. When the chain
            already knows whether value moved, adjudication is a lookup, not an opinion.
          </p>
          <Link href="/demo" className="btn btn--lime mt-8">
            See it refuse a payment
          </Link>
        </div>
      </section>
    </>
  );
}
