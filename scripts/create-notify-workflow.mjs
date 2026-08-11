/**
 * The workflow that tells an operator a spend is waiting on them.
 *
 * `ESCALATED` claims a person decides. Until this existed, no person was told —
 * the escalation service modelled `{channel, senderHandle}` and a channel log,
 * and every entry in it said `http`, because the only way to find out was to
 * have the console open. That is a hole, not a missing feature.
 *
 * The delivery goes through KeeperHub rather than a `fetch` from the gateway,
 * and that is the point rather than a detour. KeeperHub executes it, retries
 * it, and keeps its own record — so "was the operator actually reached" has an
 * answer that does not come from the party who was supposed to reach them. The
 * gateway stores the executionId and anyone can read the result back.
 *
 * The destination is an input, not a credential, so an operator points it at
 * their own endpoint and nothing here holds a Discord token. Swapping this node
 * for `discord/send-message` or `slack/send-message` is a one-line change once
 * an integration exists; the gateway side does not move.
 *
 * The node is the System `HTTP Request` action rather than
 * `webhook/send-webhook`, which answers 402 `upgrade_required` on this plan.
 * Same delivery, same execution record, no paid feature.
 *
 * NOT RUNNABLE ON THE CURRENT PLAN. Both actions that could carry the delivery
 * answer `402 upgrade_required`: `webhook/send-webhook` is `action.webhook` and
 * the System `HTTP Request` is `action.http-request`, both `requiredPlan: pro`.
 * The definition is kept because it is correct and one upgrade from running,
 * and because the gateway side does not move when it does — `notify.ts`
 * delivers directly in the meantime and says so.
 *
 *   node scripts/create-notify-workflow.mjs
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

const NAME = "Mandate — Notify Operator of a Held Spend";
const API = "https://app.keeperhub.com";
const H = { Authorization: `Bearer ${env.KEEPERHUB_API_KEY}`, "content-type": "application/json" };

const rest = async (method, path, body) => {
  const r = await fetch(`${API}${path}`, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 160)}`);
  return parsed;
};

/*
 * CRUD goes over MCP, execution goes over REST.
 *
 * `POST /api/workflows` answers 405 -- creating and editing a workflow is only
 * exposed through the MCP tools, while `POST /api/workflows/{id}/execute` is a
 * plain authenticated REST call. That split is why the gateway can fire a
 * notice with a bearer token and no MCP client: the thing it does at runtime is
 * the one that has a REST route.
 */
let sid = null;
const mcp = async (body) => {
  const headers = { ...H, accept: "application/json, text/event-stream" };
  if (sid) headers["mcp-session-id"] = sid;
  const r = await fetch(`${API}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
  if (r.headers.get("mcp-session-id")) sid = r.headers.get("mcp-session-id");
  const text = await r.text();
  const line = text.split("\n").find((l) => l.startsWith("data: ")) ?? text;
  try {
    return JSON.parse(line.replace(/^data: /, ""));
  } catch {
    return {};
  }
};
const tool = async (name, args) => {
  const r = await mcp({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } });
  const text = r.result?.content?.[0]?.text ?? JSON.stringify(r);
  if (r.result?.isError) throw new Error(`${name}: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "mandate-notify", version: "1" } } });
await mcp({ jsonrpc: "2.0", method: "notifications/initialized" });

/*
 * `{{@trigger-1:Held.field}}`, not `{{field}}` — inputs are addressed through
 * the node that produced them. The bare form does not resolve and the executor
 * aborts rather than posting a payload full of literal braces.
 */
const ref = (f) => `{{@trigger-1:Held.${f}}}`;

const NODES = [
  {
    id: "trigger-1",
    type: "trigger",
    position: { x: 0, y: 0 },
    data: { type: "trigger", label: "Held", status: "idle", config: { triggerType: "Manual" } },
  },
  {
    id: "notify",
    type: "action",
    position: { x: 320, y: 0 },
    data: {
      type: "action",
      label: "Tell the operator",
      status: "idle",
      config: {
        actionType: "HTTP Request",
        endpoint: ref("operatorUrl"),
        httpMethod: "POST",
        httpHeaders: JSON.stringify({ "content-type": "application/json" }),
        timeout: 15,
        /*
         * Hard-fail on a non-2xx. A soft failure would let the execution record
         * read `success` while the operator's endpoint was down — which is
         * precisely the "reported success, delivered nothing" shape this
         * project exists to refuse.
         */
        failOnError: true,
        /*
         * The amount, the payee and why it was held — enough for a person to
         * decide without opening anything. Deliberately NOT the approval code:
         * a webhook body is not a place to put a bearer secret, and the code is
         * shown once to whoever raised the spend.
         */
        httpBody: JSON.stringify({
          escalationId: ref("escalationId"),
          amount: ref("amount"),
          recipient: ref("recipient"),
          reason: ref("reason"),
          expiresAt: ref("expiresAt"),
          console: ref("consoleUrl"),
        }),
      },
    },
  },
];
const EDGES = [{ id: "e1", source: "trigger-1", target: "notify" }];

const existing = (await tool("list_workflows", {})).find?.((w) => w.name === NAME);
const id =
  existing?.id ??
  (
    await tool("create_workflow", {
      name: NAME,
      description:
        "Delivers a held-spend notice to the operator's endpoint. One HTTP POST; touches no chain and holds no key.",
      nodes: NODES,
      edges: EDGES,
      enabled: true,
    })
  ).id;

// Always rewrite the definition, so a re-run repairs rather than assumes.
await tool("update_workflow", { workflowId: id, nodes: NODES, edges: EDGES, enabled: true });
console.log(`workflow ${id} ${existing ? "updated" : "created"}`);

/*
 * Prove it delivers before anything depends on it. The gateway's own hook
 * endpoint records what arrives, so this is a real end-to-end delivery and not
 * a 200 from a service that discarded the body.
 */
const gateway = process.env.GATEWAY_URL ?? "https://gateway-production-944e.up.railway.app";
const probe = await rest("POST", `/api/workflows/${id}/execute`, {
  input: {
    operatorUrl: `${gateway}/hook/operator`,
    escalationId: "esc_selftest",
    amount: "0.00",
    recipient: "0x0000000000000000000000000000000000000000",
    reason: "self-test from create-notify-workflow.mjs",
    expiresAt: "n/a",
    consoleUrl: "https://nickthelegend.github.io/mandate/authority/",
  },
});
console.log(`  test delivery ${probe.executionId} …`);
await new Promise((r) => setTimeout(r, 12000));
const run = await rest("GET", `/api/execute/${probe.executionId}/status`).catch(() => null);
console.log(`  status: ${run?.status ?? "(query the execution directly)"}`);
console.log(`\nMANDATE_NOTIFY_WORKFLOW=${id}`);
