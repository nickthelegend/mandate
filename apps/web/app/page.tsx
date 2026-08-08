import Link from "next/link";

import { LiveStats } from "@/components/live-stats";
import { CodeTabs } from "@/components/code-tabs";
import { Hallmark } from "@/components/hallmark";
import { DEPLOYMENT, tx } from "@/lib/outcome";

/*
 * THESIS: A hallmark is a claim countersigned by someone who checked. The first
 * viewport is a hallmark with its assay mark missing -- not a headline about
 * verification.
 * OWN-WORLD: Sterling sheet, iron-gall ink, one assay red, marks struck as
 * insets. Archivo punches, Geist Mono registers.
 * STORY: The facilitator said sterling. Nobody countersigned. The article was
 * withheld -- and here is the transaction.
 * FIRST VIEWPORT: A display-scale hallmark strip, its assay shield an empty
 * dashed outline in assay red, with the Etherscan link directly beneath.
 * FORM: Assay office, candidate 7 of 7, seed 93a2da7d.
 */

/** The refused settlement. A real transaction; the numbers are its own. */
const REFUSED = {
  hash: "0x6db7218d717f5be3c3b37f386593bf0bdf3760b0407ac1145c617ac172136603",
  claim: "SUCCESS: TRUE",
  observed: "0",
  reason:
    "no Transfer of 0x0d864A62… to 0x…dEaD in 1 log(s). The transaction mined, emitted a log, and moved nothing.",
};

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
      {/* The thesis, struck. Not a hero: the artifact leads. */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-20 sm:pt-24">
        <p className="rubric">Sepolia · settled through KeeperHub</p>

        <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-balance sm:text-6xl">
          The facilitator said it paid. Nobody countersigned.
        </h1>

        <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-[var(--quiet)]">
          A silversmith strikes <span className="text-[var(--ink)]">sterling</span> on a piece — a
          claim, made by the party who benefits from it. An assay office tests the metal and strikes
          its own mark beside it. x402 has the first punch and not the second.
        </p>

        <div className="mt-12 border-t-2 border-[var(--ink)] pt-8">
          <Hallmark
            size="display"
            claim={REFUSED.claim}
            proven={false}
            observed={REFUSED.observed}
            at="09:22:16"
            reason={REFUSED.reason}
          />
          <a
            href={tx(REFUSED.hash)}
            target="_blank"
            rel="noopener"
            className="mt-8 inline-block font-mono text-xs text-[var(--quiet)] underline-offset-4 hover:text-[var(--ink)] hover:underline"
          >
            {REFUSED.hash.slice(0, 30)}… open it on Etherscan and check
          </a>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/demo" className="plate-btn">
            Strike one yourself
          </Link>
          <Link href="/docs" className="plate-btn plate-btn--quiet">
            Read the quickstart
          </Link>
        </div>

        <div className="mt-16">
          <LiveStats />
        </div>
      </section>

      {/* Three claims, each with the transaction that settles it. */}
      <section className="border-t border-[var(--rule)] bg-[var(--bench)]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-[-0.015em] text-balance sm:text-3xl">
            Three things a neighbouring project cannot truthfully copy.
          </h2>

          <div className="register mt-10">
            {THREE.map((c) => (
              <div key={c.mark} className="register__row sm:grid-cols-[120px_1fr_auto] sm:items-baseline">
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
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-start">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.015em] text-balance sm:text-3xl">
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

      <section className="border-t border-[var(--rule)]">
        <div className="mx-auto max-w-2xl px-6 py-20">
          <h2 className="text-xl font-semibold tracking-[-0.015em] text-balance">
            No model in the money path.
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-[var(--quiet)]">
            Every comparable project resolves payment disputes with an LLM judge. When the chain
            already knows whether value moved, adjudication is a lookup, not an opinion. An assay
            office does not deliberate either — it weighs the metal.
          </p>
          <p className="mt-8 font-mono text-xs text-[var(--quiet)]">
            {DEPLOYMENT.chainName} · escrow {DEPLOYMENT.escrow.slice(0, 10)}… · verified
          </p>
        </div>
      </section>
    </>
  );
}
