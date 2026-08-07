import { CodeTabs } from "@/components/code-tabs";
import { DEPLOYMENT, address } from "@/lib/outcome";

const TOOLS = [
  ["outcome_intent_id", "Derive the id for a piece of work. Two agents given the same task and payee get the same id, so a duplicate claim is refused on chain rather than paid for twice."],
  ["outcome_get_intent", "State, amount, and beneficiary — the address the work actually has to reach."],
  ["outcome_verify", "Did this transaction move value? Reads the receipt for a real ERC-20 Transfer. Read-only; never moves money."],
  ["outcome_settle", "Release or refund, decided from a transaction hash. Accepts no verdict, no done flag, no description of the work."],
  ["outcome_diagnose", "Why an execution failed, and whether resending can fix it. In-flight is never worth resending."],
  ["outcome_audit", "The decision record: what was verified, what was settled, and why."],
];

const ENV = [
  ["OUTCOME_RPC_URL", "RPC endpoint", "public Sepolia"],
  ["OUTCOME_ESCROW", "OutcomeEscrow address", "the live deployment"],
  ["OUTCOME_TOKEN", "ERC-20 address", "tUSDC on Sepolia"],
  ["OUTCOME_CHAIN_ID", "chain id", "11155111"],
  ["KEEPERHUB_API_KEY", "enables outcome_settle", "unset — read-only"],
  ["OUTCOME_AUDIT_LOG", "decision trail path, or - to disable", ".outcome/audit.jsonl"],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border/60 pt-10">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4 leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10 px-5 py-14">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Quickstart</h1>
        <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
          Two packages. The SDK is what you call; the MCP server is the same loop exposed as tools an
          agent can pick up on its own.
        </p>
      </div>

      <CodeTabs />

      <Section title="Reading works without a key">
        <p>
          Every read-only tool — including verifying any transaction — runs with no credential. That
          is the point: the party being asked to trust a payment is the one who most needs to check
          it, and a verification tool that first demands an API key has already lost the argument.
        </p>
        <p>
          Only <code className="font-mono text-foreground/80">outcome_settle</code> moves money, and
          only it needs <code className="font-mono text-foreground/80">KEEPERHUB_API_KEY</code>.
          Without one it returns a clear refusal rather than failing at startup.
        </p>
      </Section>

      <Section title="Guarding an x402 endpoint">
        <p>
          x402 ends at <em>&ldquo;the facilitator reported success&rdquo;</em>. One call closes it —
          read the transaction the facilitator named and confirm the money reached{" "}
          <code className="font-mono text-foreground/80">payTo</code> before you serve anything.
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border/60 bg-secondary/20 p-4 font-mono text-xs leading-relaxed text-foreground/85">
{`import { verifySettlement } from "outcome-sdk/x402";

const verdict = await verifySettlement(outcome, {
  requirements,   // the PaymentRequirements you quoted
  settlement,     // the SettlementResponse it handed back
});

if (!verdict.proven) return respond402(verdict.reason);
return serve(resource);`}
        </pre>
        <p>
          The same entry exports the wire format with the specification&rsquo;s exact field names:{" "}
          <code className="font-mono text-foreground/80">paymentRequired</code>,{" "}
          <code className="font-mono text-foreground/80">encodePaymentHeader</code>,{" "}
          <code className="font-mono text-foreground/80">decodePaymentHeader</code>, and the{" "}
          <code className="font-mono text-foreground/80">PaymentRequirements</code> /{" "}
          <code className="font-mono text-foreground/80">SettlementResponse</code> types.
        </p>
      </Section>

      <Section title="The six tools">
        <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
          {TOOLS.map(([name, desc]) => (
            <div key={name} className="p-4">
              <code className="font-mono text-sm text-foreground">{name}</code>
              <p className="mt-1.5 text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Configuration">
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-secondary/30 text-left font-mono text-xs uppercase tracking-wide">
                <th className="px-4 py-2.5 font-medium">Variable</th>
                <th className="px-4 py-2.5 font-medium">Meaning</th>
                <th className="px-4 py-2.5 font-medium">Default</th>
              </tr>
            </thead>
            <tbody>
              {ENV.map(([k, meaning, def]) => (
                <tr key={k} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-2.5 font-mono text-xs text-foreground">{k}</td>
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
          <strong className="text-foreground">Settlement takes a hash, never a verdict.</strong> An
          agent that could assert &ldquo;the work is done&rdquo; and have money move on its word is
          exactly what this replaces. A test asserts the tool&rsquo;s schema still accepts nothing but
          an intent id and a transaction hash, because that boundary is the product and a refactor
          could quietly erode it.
        </p>
        <p>
          <strong className="text-foreground">Verification is against the beneficiary.</strong> The
          payee is who gets paid; the beneficiary is who the work had to reach. Checking the payee
          would only ever prove an agent paid itself — which is what the first live agent run
          actually did, before the contract recorded the distinction.
        </p>
      </Section>

      <Section title="The deployment">
        <div className="overflow-hidden rounded-xl border border-border/60 font-mono text-xs">
          {[
            ["chain", `${DEPLOYMENT.chainName} (${DEPLOYMENT.chainId})`, null],
            ["escrow", DEPLOYMENT.escrow, address(DEPLOYMENT.escrow)],
            ["token", `${DEPLOYMENT.token} (${DEPLOYMENT.tokenSymbol})`, address(DEPLOYMENT.token)],
          ].map(([label, value, href]) => (
            <div key={label as string} className="flex gap-4 border-b border-border/40 p-3 last:border-0">
              <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
              {href ? (
                <a href={href as string} target="_blank" rel="noopener" className="break-all hover:text-foreground">
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
  );
}
