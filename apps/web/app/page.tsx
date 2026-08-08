import Link from "next/link";

import { LiveStats } from "@/components/live-stats";
import { CodeTabs } from "@/components/code-tabs";
import { Hallmark } from "@/components/hallmark";
import { DEPLOYMENT, tx } from "@/lib/outcome";

/*
 * THESIS: The tape is the record; the summary of the tape is not. This page
 * refuses the hero-metric template, the neon console, and the paper-and-serif
 * broadsheet alike.
 * OWN-WORLD: Cold newsprint printed in aniline violet, red for the second
 * ribbon, japanned iron as the machine's own band. Sprocket margins and
 * perforations divide; nothing is boxed.
 * STORY: One demand went over the wire twice. Both facilitators reported
 * success. Only one tape carries a TRANSFER line, and you can open both.
 * FIRST VIEWPORT: The machine band, the demand stated once, then two torn
 * tapes side by side -- one printed, one with the line struck through where it
 * should have been.
 * FORM: The telegraph tape, candidate 6 of 7, seed 5f5aa919.
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
      {/* The machine. One demand went over the wire twice; both tapes are here. */}
      <section className="iron">
        <div className="shell pt-14 pb-16 sm:pt-20 sm:pb-20">
          <p className="plate-label">{DEPLOYMENT.chainName} · settled through KeeperHub</p>

          <h1 className="mt-7 max-w-4xl text-[clamp(2rem,1.1rem+3.4vw,4rem)] font-bold leading-[1.04] tracking-[-0.05em] text-balance">
            It said the money moved.
            <br />
            Read the tape.
          </h1>

          <p className="mt-7 max-w-xl text-pretty leading-relaxed text-[var(--ribbon-inv)]">
            A ticker never summarised the wire — it printed it, and the tape was what you settled
            arguments with. x402 hands you the summary and throws the tape away.
          </p>

          {/* Stated once, so the divergence below has exactly one cause. */}
          <div className="mt-14">
            <p className="plate-label">One demand, sent twice</p>
            <p className="impression mt-2 break-all text-[var(--stock-inv)]">
              {DEMAND.amount} of {DEMAND.token} to {DEMAND.recipient}
            </p>
          </div>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {SPECIMENS.map((s) => (
              <div key={s.hash}>
                <p className="plate-label">{s.label}</p>

                <Hallmark
                  className="mt-3"
                  claim={s.claim}
                  proven={s.proven}
                  observed={s.observed}
                  reason={s.reason}
                />

                <p
                  className={`impression mt-4 ${
                    s.proven ? "text-[var(--stock-inv)]" : "impression--red"
                  }`}
                >
                  {s.outcome}
                </p>
                <a
                  href={tx(s.hash)}
                  target="_blank"
                  rel="noopener"
                  className="impression mt-1 inline-block text-[var(--ribbon-inv)] underline-offset-4 hover:text-[var(--stock-inv)] hover:underline"
                >
                  {s.hash.slice(0, 22)}… open it on Etherscan →
                </a>
              </div>
            ))}
          </div>

          <div className="mt-12 flex flex-wrap gap-3">
            <Link href="/demo" className="key key--lit">
              Run the wire yourself
            </Link>
            <Link href="/docs" className="key key--ghost">
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
      <section className="border-t border-[var(--perf)] bg-[var(--stock-edge)]">
        <div className="shell py-20">
          <h2 className="max-w-2xl text-3xl font-semibold tracking-[-0.025em] text-balance sm:text-4xl">
            Three things a neighbouring project cannot truthfully copy.
          </h2>

          <div className="run mt-10">
            {THREE.map((c) => (
              <div
                key={c.mark}
                className="run__row sm:grid-cols-[128px_1fr_auto] sm:items-baseline"
              >
                <span className="plate-label">{c.mark}</span>
                <div>
                  <h3 className="text-base font-semibold tracking-[-0.01em]">{c.title}</h3>
                  <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-[var(--ribbon-soft)]">
                    {c.body}
                  </p>
                </div>
                <a
                  href={tx(c.proof)}
                  target="_blank"
                  rel="noopener"
                  className="figure text-xs text-[var(--ribbon-soft)] underline-offset-4 hover:text-[var(--ribbon)] hover:underline"
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
              A tape reader you can install.
            </h2>
            <p className="mt-5 text-pretty leading-relaxed text-[var(--ribbon-soft)]">
              The SDK runs anywhere — browser, edge, or an agent runtime. The MCP server runs with no
              configuration at all: the defaults point at the live deployment, and every read-only
              tool works without a credential. Only settlement moves money, and only settlement needs
              a key.
            </p>
            <p className="mt-4 text-pretty leading-relaxed text-[var(--ribbon-soft)]">
              The party being asked to trust a payment is the one who most needs to check it, so
              checking must not require a server or a key. This site is built on the published
              package, not a private copy of the logic.
            </p>
          </div>
          <CodeTabs />
        </div>
      </section>

      {/* The close, back on the stone. */}
      <section className="iron">
        <div className="shell py-20">
          <h2 className="max-w-3xl text-2xl font-semibold tracking-[-0.02em] text-balance sm:text-3xl">
            No model in the money path.
          </h2>
          <p className="mt-5 max-w-[68ch] text-pretty leading-relaxed text-[var(--ribbon-inv)]">
            Every comparable project resolves payment disputes with an LLM judge. When the chain
            already knows whether value moved, adjudication is a lookup, not an opinion. A tape reader
            does not deliberate either — it reads what printed.
          </p>
          <p className="figure mt-10 text-xs text-[var(--ribbon-inv)]">
            {DEPLOYMENT.chainName} · escrow {DEPLOYMENT.escrow} · verified
          </p>
        </div>
      </section>
    </>
  );
}
