"use client";

/**
 * How an agent gets these limits.
 *
 * Two paths, and they are genuinely different audiences. An agent that already
 * speaks MCP — Claude Code, Cursor, anything else — needs a config file and no
 * code at all. An agent someone is writing needs the SDK, where the same
 * authority is two function calls. Showing them side by side is the honest
 * answer to "how do I use this", because which one is right depends entirely on
 * whether you are holding a client or writing one.
 *
 * The live check is here rather than in prose because "the server is up" is a
 * claim, and a claim on a page about not trusting claims should be one the
 * reader watches resolve.
 */

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { GATEWAY } from "@/lib/mandate";
import { unreachable } from "@/lib/unreachable";
import { cn } from "@/lib/utils";
import { CodeEditor, type Step } from "@/components/code-editor";

/** The seven tools the published server exposes, in the order an agent meets them. */
const TOOLS = [
  ["mandate_policy", "What governs me — the rules, the anchored hash, and whether the registry still says ACTIVE."],
  ["mandate_budget", "What is left today, this hour, and per call."],
  ["mandate_can_spend", "Judge a spend without making it. Returns the verdict and, on a refusal, the rule that refused."],
  ["mandate_spend", "Judge it, and only if approved, have KeeperHub sign and broadcast the payment."],
  ["mandate_score", "What a payee has scored, as a lower confidence bound rather than a raw average."],
  ["mandate_decisions", "The decision log — every verdict this authority has reached."],
  ["mandate_escalations", "Spends waiting on a person, and what they are waiting for."],
] as const;

const CONFIG = `{
  "mcpServers": {
    "mandate": {
      "command": "npx",
      "args": ["-y", "mandate-mcp"],
      "env": {
        "MANDATE_GATEWAY_URL": "${GATEWAY}"
      }
    }
  }
}`;

const CLAUDE_CMD = `claude --mcp-config mandate.mcp.json --strict-mcp-config --allowedTools mcp__mandate`;

const SDK_CODE = `import { proposeDecision, ledgerPartitionKey } from "mandate-policy";
import { hashCanonicalJson } from "mandate-policy/canon";
import {
  assertAnchored, statusFromAnchor, mongoLedger,
  executeIfAuthorised, KeeperHubClient,
} from "mandate-sdk/node";

const doc = JSON.parse(readFileSync("./policy.json", "utf8"));

// 1. The document on disk must still hash to what the chain holds.
//    Throws rather than returning a flag — a caller who can forget
//    to check a boolean will.
const anchored = await assertAnchored(
  provider, POLICY_REGISTRY, POLICY_ID, hashCanonicalJson(doc.rules),
);

// 2. The spend window comes from a durable ledger, not from memory.
const ledger = await mongoLedger({ uri: MONGODB_URI, db: "mandate" });
const partition = \`\${ledgerPartitionKey(POLICY_ID)}:agent:\${AGENT}\`;
const state = await ledger.read(partition);

// 3. The rules decide. They return PROPOSED effects — nothing has
//    changed yet, which is why this is both preflight and decision.
const { decision, effects } = proposeDecision(intent, {
  ...doc, id: POLICY_ID, status: statusFromAnchor(anchored).status,
}, state);

if (decision.decision !== "APPROVED") {
  const failed = decision.rules.find((r) => r.result === "FAIL");
  throw new Error(\`refused at \${failed.rule}\`);
}

// 4. Charge the budget, then execute — in that order.
await ledger.apply({ ...effects, partitionKey: partition });

// 5. KeeperHub signs and broadcasts. This process holds no key.
const run = await executeIfAuthorised(
  new KeeperHubClient({ apiKey: KEEPERHUB_API_KEY }), decision,
  { chainId: 11155111, to: PAYEE, amount: "0.40", tokenAddress: TOKEN },
);
console.log(run.transactionHash);`;

/*
 * Line ranges, checked against the code above rather than guessed. They are
 * what makes the file explainable: each step can be pointed at, and the gutter
 * shows where one ends and the next begins.
 */
const SDK_STEPS: Step[] = [
  { from: 8, to: 15, label: "1 · POLICY FROM CHAIN" },
  { from: 17, to: 20, label: "2 · DURABLE LEDGER" },
  { from: 22, to: 26, label: "3 · RULES PROPOSE" },
  { from: 28, to: 31, label: "4 · A REFUSAL NAMES ITS RULE" },
  { from: 33, to: 41, label: "5 · KEEPERHUB SIGNS" },
];

function Block({
  label,
  code,
  language,
}: {
  label: string;
  code: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card-p card-p--bordered overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2.5">
        <p className="field-label">{label}</p>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className="figure flex items-center gap-1.5 text-[11.5px] text-[var(--ink-4)] transition-colors hover:text-[var(--brand)]"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="figure no-scrollbar overflow-x-auto px-4 py-3.5 text-[11.5px] leading-relaxed text-[var(--ink-2)]">
        <code data-language={language}>{code}</code>
      </pre>
    </div>
  );
}

/** Is the authority these tools talk to actually answering right now? */
function LiveCheck() {
  const [state, setState] = useState<
    { kind: "waiting" } | { kind: "up"; policyId: string; anchor: string } | { kind: "down"; why: string }
  >({ kind: "waiting" });

  useEffect(() => {
    let alive = true;
    fetch(`${GATEWAY}/health`)
      .then((r) => r.json())
      .then((b) => {
        if (!alive) return;
        /*
         * The anchor check, not the top-level `ok`. A gateway that is running
         * but whose policy has been paused on chain is up and refusing
         * everything, and reporting that as a plain green tick would be the
         * exact sort of summary this project exists to distrust.
         */
        const anchor = (b.checks ?? []).find((c: { name: string }) => c.name === "policy-anchor");
        setState({
          kind: "up",
          policyId: String(b.policyId ?? "—"),
          anchor: anchor?.up ? String(anchor.detail ?? "anchored") : "anchor not confirmed",
        });
      })
      .catch((e) => alive && setState({ kind: "down", why: unreachable(e) }));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="card-p card-p--bordered flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
      <span
        className={cn(
          "figure flex items-center gap-2 rounded-full px-2.5 py-1 text-[10.5px] font-semibold tracking-wide",
          state.kind === "up" && "bg-[var(--brand-wash)] text-[var(--brand)]",
          state.kind === "down" && "bg-[#fdefed] text-[#b91c1c]",
          state.kind === "waiting" && "bg-[var(--surface)] text-[var(--ink-4)]"
        )}
      >
        <span
          className={cn(
            "inline-block size-1.5 rounded-full",
            state.kind === "up" && "bg-[var(--brand)]",
            state.kind === "down" && "bg-[#b91c1c]",
            state.kind === "waiting" && "bg-[var(--ink-4)]"
          )}
        />
        {state.kind === "up" ? "AUTHORITY UP" : state.kind === "down" ? "UNREACHABLE" : "CHECKING…"}
      </span>
      <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-[var(--ink-3)]">
        {state.kind === "up" ? (
          <>
            Answering from{" "}
            <span className="figure break-all">{GATEWAY.replace(/^https:\/\//, "")}</span> · policy{" "}
            <span className="figure">{state.policyId.slice(0, 10)}…{state.policyId.slice(-6)}</span> ·{" "}
            <span className="figure">{state.anchor}</span> in the registry on Sepolia
          </>
        ) : state.kind === "down" ? (
          state.why
        ) : (
          <>Asking the authority whether it is answering.</>
        )}
      </p>
    </div>
  );
}

export function McpConnect() {
  const [tab, setTab] = useState<"mcp" | "sdk">("mcp");

  return (
    <div className="space-y-5">
      <LiveCheck />

      <div className="flex gap-1 rounded-full border border-[var(--line)] bg-white p-1 sm:w-fit">
        {(
          [
            ["mcp", "Connect a client"],
            ["sdk", "Write an agent"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "flex-1 rounded-full px-4 py-1.5 text-[13px] transition-colors sm:flex-none",
              tab === k ? "bg-[var(--ink)] text-white" : "text-[var(--ink-3)] hover:text-[var(--ink)]"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "mcp" ? (
        <div className="space-y-4">
          <p className="max-w-[68ch] text-[14px] leading-relaxed text-neutral-700">
            No code. Save this as <span className="figure text-[13px]">mandate.mcp.json</span> and the
            agent has a budget it cannot exceed. The server is published on npm as{" "}
            <span className="figure text-[13px]">mandate-mcp</span>, so{" "}
            <span className="figure text-[13px]">npx</span> fetches it — there is nothing to build.
          </p>
          <Block label="mandate.mcp.json" code={CONFIG} language="json" />
          <Block label="Claude Code" code={CLAUDE_CMD} language="bash" />
          <p className="max-w-[68ch] text-[13px] leading-relaxed text-[var(--ink-3)]">
            <span className="figure text-[12px]">--strict-mcp-config</span> keeps every other server
            on the machine out of the session, and{" "}
            <span className="figure text-[12px]">mcp__mandate</span> allows this one&rsquo;s tools
            without naming all seven. Cursor and any other MCP client take the same file.
          </p>

          <div className="card-p card-p--bordered p-5">
            <p className="field-label">What the agent gets</p>
            <dl className="mt-3 space-y-2.5">
              {TOOLS.map(([name, note]) => (
                <div key={name} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
                  <dt className="figure shrink-0 text-[12px] text-[var(--brand)] sm:w-[168px]">{name}</dt>
                  <dd className="text-[12.5px] leading-relaxed text-[var(--ink-3)]">{note}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-[12.5px] leading-relaxed text-[var(--ink-4)]">
              Every read-only tool works without a credential, because the party being asked to trust
              a payment is the one who most needs to check it.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="max-w-[68ch] text-[14px] leading-relaxed text-neutral-700">
            Five steps, and the order is the design: the policy comes from the chain, the spend
            window comes from a durable ledger, the rules propose without applying, and only an
            approval reaches KeeperHub. A refusal returns before any execution exists, so a blocked
            spend leaves nothing behind.
          </p>
          <CodeEditor filename="capped-agent.mjs" code={SDK_CODE} steps={SDK_STEPS} />
          <p className="max-w-[68ch] text-[13px] leading-relaxed text-[var(--ink-3)]">
            An approval carries its own intent hash as the idempotency key, so a retry after a
            timeout cannot become a second payment. The process running this code holds no signing
            key at any point — KeeperHub does.
          </p>
        </div>
      )}
    </div>
  );
}
