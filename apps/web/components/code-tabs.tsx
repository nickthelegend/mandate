"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const SNIPPETS = {
  sdk: {
    install: "npm i mandate-sdk",
    code: `import { MandateClient } from "mandate-sdk";

const mandate = new MandateClient({
  provider: "https://ethereum-sepolia-rpc.publicnode.com",
  escrow:   "0x0ED9d1235cB9FD080D687FD978a38d972a34dC3B",
  token:    "0x49C86277a91002c4943837bf20F6ED41976Db09F",
});

// Same job, same id -- so a duplicate collides on chain.
const id = mandate.intentId("deliver 1 tUSDC to treasury", agent);
if (await mandate.isClaimed(id)) return; // someone is already on it

// Did that transaction actually move value?
const { proven, reason } = await mandate.verify({
  transactionHash,
  recipient,
  minAmount: 1_000_000n,
});`,
  },
  mcp: {
    install: "npx mandate-mcp",
    code: `// .mcp.json  (or claude_desktop_config.json)
{
  "mcpServers": {
    "mandate": {
      "command": "npx",
      "args": ["-y", "mandate-mcp"]
    }
  }
}

// Six tools, no configuration needed to read or verify:
//   mandate_intent_id    derive the id, check nobody else has it
//   mandate_get_intent   state, amount, beneficiary
//   mandate_verify       did this transaction move value?
//   mandate_settle       release or refund, from a tx hash only
//   mandate_diagnose     why it failed, and whether to retry
//   mandate_audit        the decision record`,
  },
} as const;

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1 font-mono text-xs text-[var(--ink-3)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)]"
      aria-label="Copy to clipboard"
    >
      {done ? <Check className="size-3 text-[var(--ink)]" /> : <Copy className="size-3" />}
      {done ? "copied" : "copy"}
    </button>
  );
}

export function CodeTabs({ className }: { className?: string }) {
  return (
    <Tabs defaultValue="sdk" className={cn("w-full", className)}>
      <TabsList className="font-mono">
        <TabsTrigger value="sdk">mandate-sdk</TabsTrigger>
        <TabsTrigger value="mcp">mandate-mcp</TabsTrigger>
      </TabsList>

      {(["sdk", "mcp"] as const).map((k) => (
        <TabsContent key={k} value={k} className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-[2px] border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5">
            <code className="font-mono text-sm">{SNIPPETS[k].install}</code>
            <CopyButton text={SNIPPETS[k].install} />
          </div>
          <pre className="overflow-x-auto rounded-[2px] border border-[var(--line)] bg-[var(--surface)] p-5 font-mono text-xs leading-relaxed text-[var(--ink)]">
            {SNIPPETS[k].code}
          </pre>
        </TabsContent>
      ))}
    </Tabs>
  );
}
