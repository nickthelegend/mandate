import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { PageHead } from "@/components/page-head";
import { McpConnect } from "@/components/mcp-connect";

/*
 * The page a developer lands on after being convinced.
 *
 * Everything else here argues that the limit is real. This one answers the next
 * question — how do I put my own agent behind it — and it has to answer for two
 * different people: someone holding an MCP client who should not have to write
 * any code, and someone writing an agent who needs the five steps. Splitting it
 * into two tabs rather than two pages keeps the answer in one place, because
 * which path is right is not obvious until you see both.
 */

export const metadata = {
  title: "Connect an agent · Mandate",
  description:
    "Point any MCP client at the published mandate-mcp server, or wire the SDK into an agent you are writing. Both end at the same authority.",
};

const WHY = [
  {
    title: "The agent never holds a key",
    body: "Nothing in the agent's process can sign a transfer. It asks the authority, and KeeperHub — a different party, with its own wallet — is what actually moves money. A compromised agent has nothing to steal.",
  },
  {
    title: "A refusal names its rule",
    body: "Fifteen rules run in a fixed order and the first to fail decides, so the answer is never just \"denied\". It is duplicate.taskHash_endpoint_paramsHash, or vendor.lcbFloor at rule 8 of 15 — something an operator can act on.",
  },
  {
    title: "The limit outranks the conversation",
    body: "Prompt injection works on the agent, not on the authority. Convincing a model that a spend was pre-approved changes nothing, because the tool that spends money is the same tool that enforces the cap.",
  },
];

export default function ConnectPage() {
  return (
    <>
      <PageHead
        rubric="mandate-mcp · mandate-sdk · published on npm"
        title={
          <>
            Give <span className="serif">your</span> agent this budget
          </>
        }
      >
        One config file for anything that speaks MCP, or five steps if you are writing the agent
        yourself. Both end at the same authority, and neither ever holds a signing key.
      </PageHead>

      <section className="shell py-10 sm:py-14">
        <McpConnect />
      </section>

      <section className="frame bg-[var(--tray)] px-4 py-14 sm:px-8 sm:py-16">
        <div className="shell">
          <h2
            className="max-w-2xl"
            style={{ fontSize: "clamp(24px, 3.4vw, 34px)", lineHeight: 1.1, fontWeight: 500, letterSpacing: "-0.02em" }}
          >
            What connecting actually buys you.
          </h2>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {WHY.map((w) => (
              <div key={w.title} className="card-p card-p--bordered p-5">
                <p className="text-[14px] font-semibold tracking-[-0.01em]">{w.title}</p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--ink-3)]">{w.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/policy" className="btn btn--dark">
              Write the policy first
              <span className="btn__dot">
                <ChevronRight className="size-4" />
              </span>
            </Link>
            <Link href="/docs" className="btn btn--outline">
              Full quickstart
              <span className="btn__dot">
                <ChevronRight className="size-4" />
              </span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
