import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Navbar } from "@/components/navbar";
import { DashboardPreview } from "@/components/dashboard-preview";
import { DecisionDemo } from "@/components/decision-demo";
import { CodeTabs } from "@/components/code-tabs";
import { DEPLOYMENT, tx, address } from "@/lib/outcome";

/*
 * Built for a judge with ninety seconds.
 *
 * One sentence, one action, and the evidence immediately under it. The claim is
 * that an agent cannot exceed its budget, so the page has to let them try:
 * the decision engine runs client-side below the fold, and every on-chain step
 * of the same story links a transaction KeeperHub's relayer sent.
 */

const REGISTRY = "0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304";
const RELAYER = "0xA17cb6adb58277E5b4A44B8c1ECB449BB6614E87";

/*
 * The authority, proven end to end on Sepolia. Every hash here was checked
 * against the chain before it was written down, and every one was sent by
 * KeeperHub's relayer rather than a local key -- which is the whole claim.
 */
const CHAIN_OF_CUSTODY = [
  {
    step: "Anchor the policy",
    detail: "Written through KeeperHub, so the registry records its wallet as owner.",
    result: "owner = KeeperHub",
    hash: "0x6f023b48e20fb70939a18f8051f800474eae0e0c0f5a89db15dec3ad93a5aad0",
    kind: "ok" as const,
  },
  {
    step: "Agent spends inside policy",
    detail: "Fifteen rules pass, and only then does KeeperHub move the money.",
    result: "APPROVED",
    hash: "0xe9f84233c0e06f5eee5f2c709413c86de4b0e733d75b6bf65b99f60a3d3d801d",
    kind: "ok" as const,
  },
  {
    step: "Someone edits the policy file",
    detail: "The document no longer hashes to what the registry stores.",
    result: "PolicyAnchorMismatch",
    hash: null,
    kind: "bad" as const,
  },
  {
    step: "Kill switch pulled",
    detail: "A pause KeeperHub signs. Every agent reading the registry stops.",
    result: "PAUSED",
    hash: "0x76478512c7a87cd2e5df233e280b897bd6b8eb9990b7cc9f9955fbf9611f70ab",
    kind: "bad" as const,
  },
  {
    step: "The same spend, again",
    detail: "Refused before a single rule is consulted.",
    result: "PolicyNotUsable",
    hash: null,
    kind: "bad" as const,
  },
];

const SURFACES = [
  { name: "Execute API", note: "every anchor, every authorised transfer" },
  { name: "MCP server", note: "KeeperHub's to publish a workflow; six tools of our own" },
  { name: "CLI", note: "kh execute contract-call anchored a policy" },
  { name: "x402", note: "spec-exact adapter and an autonomous payer" },
  { name: "Workflow builder", note: "a listing live at $0.02 a call" },
  { name: "Audit trail", note: "KeeperHub's record, plus our own decision ledger" },
];

export default function Home() {
  return (
    <>
      <section className="frame h-[calc(100vh-24px)] w-full sm:h-[calc(100vh-32px)]">
        {/* Ambient only: muted, looping, not interactive, with a poster so the
            frame is never a grey rectangle while the file loads. */}
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
              {DEPLOYMENT.chainName} · every write through KeeperHub
            </p>

            <h1
              className="mt-5 max-w-4xl sm:mt-6"
              style={{
                fontSize: "clamp(34px, 7.4vw, 68px)",
                lineHeight: 1.05,
                fontWeight: 500,
                letterSpacing: "-0.02em",
              }}
            >
              Give an agent a budget
              <br />
              it <span className="serif">cannot</span> exceed
            </h1>

            <p
              className="mt-4 max-w-xl px-2 text-neutral-700 sm:mt-6"
              style={{ fontSize: "clamp(13px, 3.5vw, 16px)" }}
            >
              Not a limit it agrees to respect — one it has no key to break. KeeperHub holds the
              signer; the policy is the only way through.
            </p>

            <Link href="/demo" className="btn btn--dark mt-6 sm:mt-8">
              Watch it refuse a payment
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

      {/* The mechanism, running in the visitor's own browser. */}
      <section className="shell py-16 sm:py-20">
        <h2
          className="max-w-2xl"
          style={{ fontSize: "clamp(26px, 4vw, 40px)", lineHeight: 1.1, fontWeight: 500, letterSpacing: "-0.02em" }}
        >
          Try to overspend. <span className="serif">Watch it stop.</span>
        </h2>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-neutral-700">
          Fifteen rules run in order and the first to fail decides — so a refusal names the rule
          that refused it. This is the real engine, judging in your browser with no server in the
          path.
        </p>

        <div className="mt-8">
          <DecisionDemo />
        </div>
      </section>

      {/* The same story, on chain. */}
      <section className="frame bg-[var(--tray)] px-4 py-16 sm:px-8 sm:py-20">
        <div className="shell">
          <h2
            className="max-w-2xl"
            style={{ fontSize: "clamp(26px, 4vw, 40px)", lineHeight: 1.1, fontWeight: 500, letterSpacing: "-0.02em" }}
          >
            Every step of that, on Sepolia.
          </h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-neutral-700">
            Sent by KeeperHub&rsquo;s relayer{" "}
            <a
              href={address(RELAYER)}
              target="_blank"
              rel="noopener"
              className="figure text-[13px] text-[var(--brand)] underline-offset-4 hover:underline"
            >
              {RELAYER.slice(0, 10)}…
            </a>
            , not by a key in anyone&rsquo;s <code className="figure text-[13px]">.env</code>.
          </p>

          <ol className="mt-8 space-y-2">
            {CHAIN_OF_CUSTODY.map((s, i) => (
              <li key={s.step} className="card-p flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <span className="figure w-5 shrink-0 text-[12px] text-[var(--ink-4)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-[200px] flex-1">
                  <p className="text-[14px] font-semibold tracking-[-0.01em]">{s.step}</p>
                  <p className="text-[12.5px] leading-relaxed text-[var(--ink-3)]">{s.detail}</p>
                </div>
                <span
                  className={`verdict ${s.kind === "ok" ? "verdict--proven" : "verdict--not_proven"}`}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <circle cx="10" cy="10" r="8" />
                    {s.kind === "bad" && (
                      <path d="M3 17 L17 3" stroke="currentColor" strokeWidth="2.5" />
                    )}
                  </svg>
                  {s.result}
                </span>
                {s.hash ? (
                  <a
                    href={tx(s.hash)}
                    target="_blank"
                    rel="noopener"
                    className="figure text-[11px] text-[var(--brand)] underline-offset-4 hover:underline"
                  >
                    {s.hash.slice(0, 12)}… →
                  </a>
                ) : (
                  <span className="figure text-[11px] text-[var(--ink-4)]">off-chain check</span>
                )}
              </li>
            ))}
          </ol>

          <a
            href={address(REGISTRY)}
            target="_blank"
            rel="noopener"
            className="figure mt-5 inline-block text-[12px] text-[var(--ink-3)] underline-offset-4 hover:text-[var(--brand)] hover:underline"
          >
            PolicyRegistry · {REGISTRY} →
          </a>
        </div>
      </section>

      {/* What you install. */}
      <section className="shell py-16 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:items-start">
          <div>
            <h2
              style={{ fontSize: "clamp(26px, 4vw, 40px)", lineHeight: 1.1, fontWeight: 500, letterSpacing: "-0.02em" }}
            >
              Two calls to wire it in.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-neutral-700">
              Judge the intent, then execute only if it was approved. A refusal returns before any
              network call exists, so a blocked spend leaves no execution behind. An approval
              carries its own intent hash as the idempotency key, so a retry after a timeout cannot
              become a second payment.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-neutral-700">
              Every read-only MCP tool works without a credential, because the party being asked to
              trust a payment is the one who most needs to check it.
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

      {/* Surfaces, stated plainly. */}
      <section className="border-y border-[var(--line)] bg-[var(--surface)]">
        <div className="shell py-16">
          <h2
            className="max-w-2xl"
            style={{ fontSize: "clamp(24px, 3.4vw, 34px)", lineHeight: 1.1, fontWeight: 500, letterSpacing: "-0.02em" }}
          >
            Built on six KeeperHub surfaces.
          </h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SURFACES.map((s) => (
              <div key={s.name} className="card-p card-p--bordered p-4">
                <p className="text-[14px] font-semibold tracking-[-0.01em]">{s.name}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--ink-3)]">{s.note}</p>
              </div>
            ))}
          </div>
          <p className="mt-5 text-[12.5px] text-[var(--ink-4)]">
            MPP is the one we did not use — Tempo is reachable, but the wallet holds no balance
            there, so a payment cannot settle. Said here rather than hidden.
          </p>
        </div>
      </section>

      <section className="frame bg-[var(--dark)] px-4 py-16 text-white sm:px-8 sm:py-20">
        <div className="shell">
          <h2
            className="max-w-2xl"
            style={{ fontSize: "clamp(26px, 4vw, 40px)", lineHeight: 1.1, fontWeight: 500, letterSpacing: "-0.02em" }}
          >
            No model in the <span className="serif">money path</span>.
          </h2>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/70">
            The rules are deterministic and the chain is the arbiter. Nothing here asks a language
            model whether a payment should happen.
          </p>
          <Link href="/verify" className="btn btn--brand mt-8">
            Check a payment yourself
            <span className="btn__dot">
              <ChevronRight className="size-4" />
            </span>
          </Link>
        </div>
      </section>
    </>
  );
}
