import Link from "next/link";

import { LiveStats } from "@/components/live-stats";
import { CodeTabs } from "@/components/code-tabs";
import { Hallmark } from "@/components/hallmark";
import { DEPLOYMENT, tx } from "@/lib/outcome";

/*
 * THESIS: A hallmark is a claim countersigned by someone who checked. This page
 * refuses the hero-metric template and the near-black-plus-neon console alike.
 * OWN-WORLD: A touchstone plate carrying two specimen streaks, sterling sheet
 * below it for the register. Marks are cut in, never floated.
 * STORY: The same demand was settled twice. Both facilitators reported success.
 * One moved money and one did not, and you can open either.
 * FIRST VIEWPORT: Full-bleed touchstone. The demand stated once, then two
 * specimens side by side -- struck and refused -- with both transactions
 * addressable beneath them.
 * FORM: The assay in progress, candidate 6 of 7, seed 453f9a2a.
 */

const DEAD = "0x000000000000000000000000000000000000dEaD";

/*
 * One demand, settled twice. Both verified against the chain from this repo
 * before being written down here: same token, same recipient, same amount, and
 * the only difference is whether the money moved.
 */
const DEMAND = {
  amount: "1000000",
  token: "0x0d864A625c280F7f9B9AD024d12F94f5D6DCCF13",
  recipient: DEAD,
};

const SPECIMENS = [
  {
    label: "Settled by a lying facilitator",
    claim: "SUCCESS: TRUE",
    proven: false,
    observed: "0",
    hash: "0x6db7218d717f5be3c3b37f386593bf0bdf3760b0407ac1145c617ac172136603",
    reason:
      "no Transfer of 0x0d864A62… to 0x…dEaD in 1 log(s). It mined, it emitted a log, and it moved nothing.",
    outcome: "HTTP 402 — the article was withheld",
  },
  {
    label: "Settled honestly",
    claim: "SUCCESS: TRUE",
    proven: true,
    observed: "1000000",
    hash: "0x3aac3134ba7c4ce4e12c04e206ad7ce468318607fdb7a8e7ad85e91a70fe72ee",
    reason: "observed 1000000 reaching 0x…dEaD in 2 log(s).",
    outcome: "HTTP 200 — the article was served",
  },
] as const;

const THREE = [
  {
    mark: "no key",
    title: "The agent holds no private key and no ETH",
    body: "It signs nothing. KeeperHub owns the only signer in the loop, and the wallet that funds delivery has 0.0 ETH. An unattended process that must guard a key needs somewhere safe to keep it, and it does not have somewhere safe.",
    proof: "0xef3a8f8806cce8f4cc98a286a37063ca68386862dd70c3953b77bfb92123409a",
  },
  {
    mark: "no gas",
    title: "The merchant accepts x402 without holding ETH",
    body: "Settlement runs through KeeperHub's execute API, so accepting agent payments costs no gas and needs no top-ups. x402's own deployment assumes somebody funds a submitter and keeps funding it.",
    proof: "0x3dba2aa47415056197620e9a40341668d1bf7907b968b66c03dfe9cfff0f3d25",
  },
  {
    mark: "one key",
    title: "Only KeeperHub can move escrowed funds",
    body: "The admin's verifier role was revoked. Calling release as the deployer now reverts NotVerifier. The contract holds the money, KeeperHub is the only key that opens it, and what tells it to open is a receipt read.",
    proof: "0xe5e25335aa323c837fa91807058dbd0c5b66b1eb76673fb33648c3b2c0999ae3",
  },
];

export default function Home() {
  return (
    <>
      {/* The bench. Both specimens sit on the same stone, under the same demand. */}
      <section className="plate">
        <div className="shell pt-14 pb-16 sm:pt-20 sm:pb-20">
          <p className="rubric">{DEPLOYMENT.chainName} · settled through KeeperHub</p>

          <h1 className="mt-7 max-w-4xl text-[clamp(2.5rem,1.4rem+4.2vw,5rem)] font-semibold leading-[0.98] tracking-[-0.035em] text-balance">
            The facilitator said it paid.
            <br />
            Nobody countersigned.
          </h1>

          <p className="mt-7 max-w-2xl text-pretty text-lg leading-relaxed text-[var(--quiet-inv)]">
            A silversmith strikes <span className="text-[var(--sheet-inv)]">sterling</span> on a
            piece — a claim, made by the party who benefits from it. An assay office tests the metal
            and strikes its own mark beside it. x402 has the first punch and not the second.
          </p>

          {/* The demand, stated once, so the divergence below has one cause. */}
          <div className="mt-14 border-t border-[var(--touchstone-rule)] pt-5">
            <p className="rubric">One demand, settled twice</p>
            <p className="figure mt-2 text-sm break-all text-[var(--sheet-inv)]">
              {DEMAND.amount} of {DEMAND.token} to {DEMAND.recipient}
            </p>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {SPECIMENS.map((s) => (
              <div
                key={s.hash}
                className={s.proven ? "specimen" : "specimen specimen--refused"}
              >
                <p className="rubric">{s.label}</p>
                <div className={s.proven ? "streak mt-4" : "streak streak--refused mt-4"} />

                <Hallmark
                  className="mt-6"
                  claim={s.claim}
                  proven={s.proven}
                  observed={s.observed}
                  reason={s.reason}
                />

                <p
                  className={`figure mt-5 text-sm ${
                    s.proven ? "text-[var(--sheet-inv)]" : "text-[var(--assay-lit)]"
                  }`}
                >
                  {s.outcome}
                </p>
                <a
                  href={tx(s.hash)}
                  target="_blank"
                  rel="noopener"
                  className="figure mt-2 inline-block text-xs text-[var(--quiet-inv)] underline-offset-4 hover:text-[var(--sheet-inv)] hover:underline"
                >
                  {s.hash.slice(0, 26)}… open it on Etherscan →
                </a>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/demo" className="plate-btn plate-btn--lit">
              Strike one yourself
            </Link>
            <Link href="/docs" className="plate-btn plate-btn--ghost">
              Read the quickstart
            </Link>
          </div>
        </div>
      </section>

      {/* Off the stone and onto the sheet: the standing record. */}
      <section className="shell py-14">
        <LiveStats />
      </section>

      {/* Three claims, each with the transaction that settles it. */}
      <section className="border-t border-[var(--rule)] bg-[var(--bench)]">
        <div className="shell py-20">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl">
            Three things a neighbouring project cannot truthfully copy.
          </h2>

          <div className="register mt-10">
            {THREE.map((c) => (
              <div
                key={c.mark}
                className="register__row sm:grid-cols-[128px_1fr_auto] sm:items-baseline"
              >
                <span className="rubric">{c.mark}</span>
                <div>
                  <h3 className="text-base font-semibold tracking-[-0.01em]">{c.title}</h3>
                  <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-[var(--quiet)]">
                    {c.body}
                  </p>
                </div>
                <a
                  href={tx(c.proof)}
                  target="_blank"
                  rel="noopener"
                  className="figure text-xs text-[var(--quiet)] underline-offset-4 hover:text-[var(--ink)] hover:underline"
                >
                  {c.proof.slice(0, 12)}…
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What you install. */}
      <section className="shell py-20">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <div>
            <h2 className="text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl">
              An assay office you can install.
            </h2>
            <p className="mt-5 text-pretty leading-relaxed text-[var(--quiet)]">
              The SDK runs anywhere — browser, edge, or an agent runtime. The MCP server runs with no
              configuration at all: the defaults point at the live deployment, and every read-only
              tool works without a credential. Only settlement moves money, and only settlement needs
              a key.
            </p>
            <p className="mt-4 text-pretty leading-relaxed text-[var(--quiet)]">
              The party being asked to trust a payment is the one who most needs to check it, so
              checking must not require a server or a key. This site is built on the published
              package, not a private copy of the logic.
            </p>
          </div>
          <CodeTabs />
        </div>
      </section>

      {/* The close, back on the stone. */}
      <section className="plate">
        <div className="shell py-20">
          <h2 className="max-w-3xl text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl">
            No model in the money path.
          </h2>
          <p className="mt-5 max-w-[68ch] text-pretty leading-relaxed text-[var(--quiet-inv)]">
            Every comparable project resolves payment disputes with an LLM judge. When the chain
            already knows whether value moved, adjudication is a lookup, not an opinion. An assay
            office does not deliberate either — it weighs the metal.
          </p>
          <p className="figure mt-10 text-xs text-[var(--quiet-inv)]">
            {DEPLOYMENT.chainName} · escrow {DEPLOYMENT.escrow} · verified
          </p>
        </div>
      </section>
    </>
  );
}
