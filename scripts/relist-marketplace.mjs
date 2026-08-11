/**
 * Replace the marketplace listing with one that describes what this is now.
 *
 * The old listing — "Outcome — Escrow Intent Status" — read `OutcomeEscrow` on
 * Sepolia, a contract that has been deleted. It was public, priced, and
 * callable, which made it an advert for a product that no longer exists.
 *
 * What goes up in its place is the check an outside party actually needs and
 * cannot easily run for themselves: given a policy id, is that agent's spending
 * limit live on chain right now, which ruleset hash is anchored, and at what
 * version. That is the whole claim this project makes, offered as something a
 * counterparty can verify without asking us.
 *
 * Read-only: no wallet, no gas, no key. Run once:
 *
 *   node scripts/relist-marketplace.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const env = Object.fromEntries(
  readFileSync(`${ROOT}.env`, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const REGISTRY = "0x13452fcA19819d37Fa4b01a0e64C8Fce60C5E304";
const STALE_WORKFLOW = "dc8i38p01n63o17c4d1b7";

let sid = null;
async function call(body) {
  const headers = {
    Authorization: `Bearer ${env.KEEPERHUB_API_KEY}`,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sid) headers["mcp-session-id"] = sid;
  const r = await fetch("https://app.keeperhub.com/mcp", { method: "POST", headers, body: JSON.stringify(body) });
  if (r.headers.get("mcp-session-id")) sid = r.headers.get("mcp-session-id");
  const text = await r.text();
  const line = text.split("\n").find((l) => l.startsWith("data: ")) ?? text;
  // A notification has no response body at all; that is not a failure.
  try {
    return JSON.parse(line.replace(/^data: /, ""));
  } catch {
    return {};
  }
}
const tool = async (name, args) => {
  const r = await call({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } });
  const text = r.result?.content?.[0]?.text ?? JSON.stringify(r);
  if (r.result?.isError) throw new Error(`${name}: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

await call({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mandate-relist", version: "1" } },
});
await call({ jsonrpc: "2.0", method: "notifications/initialized" });

/*
 * Two reads against PolicyRegistry rather than one.
 *
 * `getPolicy` returns a stored record whose `status` says ACTIVE even after the
 * policy has expired — expiry is derived, never written. A caller who read only
 * the status would conclude a dead policy was live, which is precisely the
 * mistake this listing exists to prevent. `isUsable` is the derived answer, so
 * both go out and the consumer gets the one that binds.
 */
const REGISTRY_ABI = JSON.stringify([
  {
    type: "function",
    name: "getPolicy",
    stateMutability: "view",
    inputs: [{ name: "policyId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "expiry", type: "uint64" },
          { name: "version", type: "uint32" },
          { name: "agent", type: "address" },
          { name: "status", type: "uint8" },
          { name: "policyHash", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "isUsable",
    stateMutability: "view",
    inputs: [{ name: "policyId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
]);

/*
 * `{{@trigger-1:Called.policyId}}`, not `{{policyId}}`.
 *
 * The bare form is what the old escrow listing carried and it does not resolve
 * — the executor aborts with "Display reference did not resolve" rather than
 * quietly substituting an empty string, which is the right call and the reason
 * this was caught before anyone paid for it. Input fields are addressed through
 * the node that produced them, trigger included.
 */
const POLICY_ID_REF = "{{@trigger-1:Called.policyId}}";

const readNode = (id, label, fn, x) => ({
  id,
  type: "action",
  position: { x, y: 0 },
  data: {
    type: "action",
    label,
    status: "idle",
    config: {
      actionType: "web3/read-contract",
      network: "11155111",
      contractAddress: REGISTRY,
      abi: REGISTRY_ABI,
      abiFunction: fn,
      functionArgs: JSON.stringify([POLICY_ID_REF]),
    },
  },
});

const NODES = [
  {
    id: "trigger-1",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: { type: "trigger", label: "Called", status: "idle", config: { triggerType: "Manual" } },
  },
  readNode("read-policy", "Read Policy", "getPolicy", 320),
  readNode("read-usable", "Is Usable", "isUsable", 640),
];
const EDGES = [
  { id: "e1", source: "trigger-1", target: "read-policy" },
  { id: "e2", source: "read-policy", target: "read-usable" },
];

const NAME = "Mandate — Is This Spending Policy Live";

/* Idempotent: a re-run after a half-finished attempt must not leave duplicates. */
const existing = (await tool("list_workflows", {})).find?.((w) => w.name === NAME);
if (existing) console.log(`reusing workflow ${existing.id}`);

console.log(existing ? "updating the workflow…" : "creating the workflow…");
const created = existing ?? (await tool("create_workflow", {
  name: NAME,
  description:
    "Given a Mandate policy id, reads PolicyRegistry on Sepolia and reports whether that agent's " +
    "spending limit is enforceable right now: the anchored ruleset hash, the version, the owner, " +
    "the expiry, and the derived usability answer. Status alone is not enough — a policy reads " +
    "ACTIVE after it has expired, because expiry is derived rather than stored, so both the " +
    "stored record and isUsable() are returned. Read-only: no wallet, no gas.",
  enabled: true,
  nodes: NODES,
  edges: EDGES,
}));
const workflowId = created.id ?? created.workflowId ?? created.workflow?.id;
// Always write the definition, so a re-run repairs an existing workflow rather
// than leaving whatever it happened to be carrying.
await tool("update_workflow", { workflowId, nodes: NODES, edges: EDGES });
console.log(`  ${workflowId}`);

console.log("running it once before anyone pays for it…");
const probe = await tool("execute_workflow", { workflowId, input: { policyId: env.POLICY_ID } });
await new Promise((r) => setTimeout(r, 12000));
const run = await tool("get_execution", { executionId: probe.executionId });
const runErr = run.progress?.errorContext?.error ?? run.logs?.execution?.error ?? null;
if (runErr) throw new Error(`the workflow does not work; refusing to list it: ${runErr}`);
console.log(`  ${run.logs?.execution?.status ?? run.status}`);

/*
 * Price before publishing. The catalogue refuses a price change while a
 * workflow is listed — unlist, set it, then list — so on a re-run this has to
 * take the workflow down first rather than assume it is already off.
 */
console.log("pricing it…");
await tool("unlist_workflow", { workflowId }).catch(() => {});
await tool("update_workflow_listing", { workflowId, priceUsdcPerCall: "0.02" });

console.log("listing it…");
/*
 * "ethereum", not the numeric chain id. The catalogue validates the chain field
 * against payment/data networks it knows, and 11155111 is not one of them — the
 * old listing predates that check. Sepolia is named in the description instead,
 * which is where a buyer reads it anyway.
 */
const listed = await tool("list_workflow", {
  workflowId,
  slug: "mandate-policy-status",
  category: "defi",
  chain: "ethereum",
  workflowType: "read",
  inputSchema: {
    type: "object",
    required: ["policyId"],
    properties: {
      policyId: {
        type: "string",
        description: "The uint256 Mandate policy id, as a decimal string.",
      },
    },
  },
  outputMapping: {
    usable: "{{@read-usable:Is Usable.result}}",
    policyHash: "{{@read-policy:Read Policy.result.policyHash}}",
    status: "{{@read-policy:Read Policy.result.status}}",
    version: "{{@read-policy:Read Policy.result.version}}",
    agent: "{{@read-policy:Read Policy.result.agent}}",
    expiry: "{{@read-policy:Read Policy.result.expiry}}",
  },
});
console.log(`  listed as ${listed.listedSlug ?? "mandate-policy-status"}`);

console.log("unlisting the stale escrow listing…");
await tool("unlist_workflow", { workflowId: STALE_WORKFLOW });
console.log("  outcome-escrow-intent-status is no longer public");

const check = await tool("get_workflow_listing", { slug: "mandate-policy-status" });
console.log(`\nlive: ${check.listedSlug} — ${check.name} @ $${check.priceUsdcPerCall ?? "0"}/call`);
