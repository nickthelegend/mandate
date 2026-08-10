import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Navbar } from "@/components/navbar";
import { DashboardPreview } from "@/components/dashboard-preview";
import { Settlement } from "@/components/settlement";
import { CodeTabs } from "@/components/code-tabs";
import { DEPLOYMENT, tx } from "@/lib/outcome";

/*
 * Built for a judge with ninety seconds.
 *
 * One sentence, one action, and the evidence immediately under it. The hero is
 * a single clipped frame -- video, navbar, headline and dashboard are cut off
 * together by the same rounded corners, so the tray bleeding past the bottom
 * edge reads as deliberate rather than as a layout that ran out of room.
 */

const DEAD = "0x000000000000000000000000000000000000dEaD";

const DEMAND = {
  amount: "1000000",
  token: "0x0d864A625c280F7f9B9AD024d12F94f5D6DCCF13",
  recipient: DEAD,
};

/*
 * One demand, settled twice. Both verified against Sepolia from this repo
 * before being written down: same token, same recipient, same amount, and the
 * only difference is whether the money actually moved.
 */
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
      <section className="frame h-[calc(100vh-24px)] w-full sm:h-[calc(100vh-32px)]">
        {/*
          * Ambient only: muted, looping, and not interactive, with a poster so
          * the frame is never a grey rectangle while the file loads.
          */}
        <video
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          disableRemotePlayback
          poster="https://images.unsplash.com/photo-1557683316-973673baf926?w=1600&q=60"
        >
          <source
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260424_064411_9e9d7f84-9277-41f4-ab10-59172d89e6be.mp4"
            type="video/mp4"
          />
        </video>
        <div className="absolute inset-0 bg-white/10" />

        <div className="relative z-10 flex h-full flex-col">
          <Navbar />

          <div className="flex flex-col items-center px-4 pb-8 pt-10 text-center sm:pb-12 sm:pt-16">
            <p className="eyebrow">
              <span className="inline-block size-1.5 rounded-full bg-[var(--brand)]" />
              {DEPLOYMENT.chainName} · settled through KeeperHub
            </p>

            <h1
              className="mt-5 max-w-4xl sm:mt-6"
              style={{
                fontSize: "clamp(36px, 8vw, 72px)",
                lineHeight: 1.05,
                fontWeight: 500,
                letterSpacing: "-0.02em",
              }}
            >
              Pay agents for <span className="serif">proven</span>
              <br />
              work, not promises
            </h1>

            <p
              className="mt-4 px-2 text-neutral-700 sm:mt-6"
              style={{ fontSize: "clamp(13px, 3.5vw, 16px)" }}
            >
              x402 pays on a facilitator&rsquo;s word. Outcome reads the receipt.
            </p>

            <Link href="/demo" className="btn btn--dark mt-6 sm:mt-8">
              Run the live demo
              <span className="btn__dot">
                <ChevronRight className="size-4" />
              </span>
            </Link>
          </div>

          <div className="px-3 sm:px-4">
            <DashboardPreview />
          </div>
        </div>
      </section>

      {/* The proof, immediately. Same demand, opposite outcomes. */}
      <section className="shell py-16 sm:py-20">
        <h2
          className="max-w-2xl"
          style={{ fontSize: "clamp(26px, 4vw, 40px)", lineHeight: 1.1, fontWeight: 500, letterSpacing: "-0.02em" }}
        >
          The same payment, settled <span className="serif">twice</span>.
        </h2>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-neutral-700">
          Both facilitators reported success. One moved the money and one did not. Both transactions
          are live and open to inspection.
        </p>

        <div className="card-p card-p--bordered mt-8 p-5">
          <p className="text-[12px] font-medium text-neutral-500">What was demanded, both times</p>
          <p className="figure mt-1.5 break-all text-[13px]">
            {DEMAND.amount} of {DEMAND.token} to {DEMAND.recipient}
          </p>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {SETTLEMENTS.map((s) => (
            <Settlement key={s.hash} {...s} href={tx(s.hash)} />
          ))}
        </div>
      </section>

      {/* Three claims a neighbouring project cannot copy. */}
      <section className="frame bg-[var(--tray)] px-4 py-16 sm:px-8 sm:py-20">
        <div className="shell">
          <h2
            className="max-w-2xl"
            style={{ fontSize: "clamp(26px, 4vw, 40px)", lineHeight: 1.1, fontWeight: 500, letterSpacing: "-0.02em" }}
          >
            Three things you can check on chain right now.
          </h2>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {PROOF.map((c) => (
              <div key={c.hash} className="card-p flex flex-col p-5">
                <h3 className="text-[15px] font-semibold leading-snug tracking-[-0.01em]">
                  {c.title}
                </h3>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-neutral-600">{c.body}</p>
                <a
                  href={tx(c.hash)}
                  target="_blank"
                  rel="noopener"
                  className="figure mt-4 text-[11px] text-[var(--brand)] underline-offset-4 hover:underline"
                >
                  {c.hash.slice(0, 16)}… on Etherscan →
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What you install. */}
      <section className="shell py-16 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start">
          <div>
            <h2
              style={{ fontSize: "clamp(26px, 4vw, 40px)", lineHeight: 1.1, fontWeight: 500, letterSpacing: "-0.02em" }}
            >
              One call closes the gap.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-neutral-700">
              The SDK runs anywhere — browser, edge, or an agent runtime. The MCP server needs no
              configuration: the defaults point at the live deployment, and every read-only tool
              works without a credential.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-neutral-700">
              The party being asked to trust a payment is the one who most needs to check it, so
              checking must not require a server or a key. This site is built on the published
              package, not a private copy of the logic.
            </p>
            <Link href="/docs" className="btn btn--dark mt-7">
              Read the quickstart
              <span className="btn__dot">
                <ChevronRight className="size-4" />
              </span>
            </Link>
          </div>
          <CodeTabs />
        </div>
      </section>

      {/* The close. */}
      <section className="frame bg-[var(--dark)] px-4 py-16 text-white sm:px-8 sm:py-20">
        <div className="shell">
          <h2
            className="max-w-2xl"
            style={{ fontSize: "clamp(26px, 4vw, 40px)", lineHeight: 1.1, fontWeight: 500, letterSpacing: "-0.02em" }}
          >
            No model in the <span className="serif">money path</span>.
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/70">
            Every comparable project resolves payment disputes with an LLM judge. When the chain
            already knows whether value moved, adjudication is a lookup, not an opinion.
          </p>
          <Link href="/demo" className="btn btn--brand mt-8">
            See it refuse a payment
            <span className="btn__dot">
              <ChevronRight className="size-4" />
            </span>
          </Link>
        </div>
      </section>
    </>
  );
}
