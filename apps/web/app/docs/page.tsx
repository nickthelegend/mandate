import { CodeTabs } from "@/components/code-tabs";
import { DEPLOYMENT, address } from "@/lib/mandate";
import { PageHead } from "@/components/page-head";

const TOOLS = [
  ["mandate_can_spend", "Would this spend be allowed? The same fifteen rules against the same anchored policy and the same persisted ledger — and it writes nothing. Ask before you act; a refusal you can read is one you can adjust to."],
  ["mandate_spend", "Ask to spend. Binding: a refusal has nothing to route around it, because the agent holds no key. On approval the money moves and you get the transaction hash."],
  ["mandate_budget", "What this agent has spent today and what is left, read from the ledger rather than from anything the agent tracks itself."],
  ["mandate_policy", "The rules being enforced and their status in the on-chain registry. An agent can read its own limits; it cannot change them."],
  ["mandate_score", "What the bureau makes of a payee — the score, the uncertainty, and the lower bound enforcement actually compares against the floor."],
  ["mandate_decisions", "The decision record. Refusals kept as well as approvals, because a record of only the approvals cannot answer what an audit asks."],
  ["mandate_escalations", "Spends the policy would neither approve nor refuse, waiting on a person. Nothing is charged while one is open."],
];

const ENV = [
  ["MANDATE_AUTHORITY_URL", "where the authority is", "the live deployment"],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--line)] pt-10">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4 leading-relaxed text-[var(--ink-3)]">{children}</div>
    </section>
  );
}

export default function DocsPage() {
  return (
    <>
      <PageHead rubric="Two packages" title="Quickstart">
        The SDK is what you call; the MCP server is the same loop exposed as tools an agent can pick
        up on its own.
      </PageHead>

      <div className="shell py-10 sm:py-14">
      <div className="max-w-3xl space-y-10">
      <CodeTabs />

      <Section title="Reading works without a key">
        <p>
          Every read-only tool — including verifying any transaction — runs with no credential. That
          is the point: the party being asked to trust a payment is the one who most needs to check
          it, and a verification tool that first demands an API key has already lost the argument.
        </p>
        <p>
          Only <code className="font-mono text-[var(--ink)]">mandate_spend</code> moves money, and
          the credential for it lives on the authority rather than in this package — which never
          holds a key at all. That is the same property that makes a refusal binding.
        </p>
      </Section>

      <Section title="Buying from the marketplace, autonomously">
        <p>
          KeeperHub lists workflows other agents publish, priced per call, and its own tool says
          plainly: <em>&ldquo;this tool DOES NOT auto-pay.&rdquo;</em> A paid listing answers 402
          with an x402 challenge and something human has to settle it.
        </p>
        <pre className="overflow-x-auto rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-4 font-mono text-xs leading-relaxed text-[var(--ink)]">
{`import { payAndCall } from "mandate-sdk";

const result = await payAndCall({
  apiKey, slug, signer,
  maxSpend: 50_000n,        // base units; an unattended payer without a cap
  expectedTerms: listing,   // is a wallet with a public endpoint
});`}
        </pre>
        <p>
          <code className="font-mono text-[var(--ink)]">expectedTerms</code> is the Challenge
          Binding Check: every field of the 402 compared against what the listing advertised,
          before a signature exists. A signed EIP-3009 authorisation is bearer-spendable the moment
          it leaves the process, so a challenge that quietly changed the payee has to be caught
          before signing, not after.
        </p>
      </Section>

      <Section title="The six tools">
        <div className="divide-y divide-border/50 overflow-hidden rounded-[10px] border border-[var(--line)]">
          {TOOLS.map(([name, desc]) => (
            <div key={name} className="p-4">
              <code className="font-mono text-sm text-[var(--ink)]">{name}</code>
              <p className="mt-1.5 text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Configuration">
        <div className="overflow-x-auto rounded-[10px] border border-[var(--line)]">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--surface)] text-left text-[12px] font-medium text-[var(--ink-3)]">
                <th className="px-4 py-2.5 font-medium">Variable</th>
                <th className="px-4 py-2.5 font-medium">Meaning</th>
                <th className="px-4 py-2.5 font-medium">Default</th>
              </tr>
            </thead>
            <tbody>
              {ENV.map(([k, meaning, def]) => (
                <tr key={k} className="border-b border-[var(--line)] last:border-0">
                  <td className="px-4 py-2.5 font-mono text-xs text-[var(--ink)]">{k}</td>
                  <td className="px-4 py-2.5 text-sm">{meaning}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{def}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Two boundaries worth reviewing">
        <p>
          <strong className="text-[var(--ink)]">Settlement takes a hash, never a verdict.</strong> An
          agent that could assert &ldquo;the work is done&rdquo; and have money move on its word is
          exactly what this replaces. A test asserts the tool&rsquo;s schema still accepts nothing but
          an intent id and a transaction hash, because that boundary is the product and a refactor
          could quietly erode it.
        </p>
        <p>
          <strong className="text-[var(--ink)]">Verification is against the beneficiary.</strong> The
          payee is who gets paid; the beneficiary is who the work had to reach. Checking the payee
          would only ever prove an agent paid itself — which is what the first live agent run
          actually did, before the contract recorded the distinction.
        </p>
      </Section>

      <Section title="The deployment">
        <div className="overflow-hidden rounded-[10px] border border-[var(--line)] font-mono text-xs">
          {[
            ["chain", `${DEPLOYMENT.chainName} (${DEPLOYMENT.chainId})`, null],
            ["registry", DEPLOYMENT.registry, address(DEPLOYMENT.registry)],
            ["token", `${DEPLOYMENT.token} (${DEPLOYMENT.tokenSymbol})`, address(DEPLOYMENT.token)],
          ].map(([label, value, href]) => (
            <div key={label as string} className="flex gap-4 border-b border-[var(--line)] p-3 last:border-0">
              <span className="w-16 shrink-0 text-[var(--ink-3)]">{label}</span>
              {href ? (
                <a href={href as string} target="_blank" rel="noopener" className="break-all hover:text-[var(--ink)]">
                  {value}
                </a>
              ) : (
                <span className="break-all">{value}</span>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
      </div>
    </>
  );
}
