/**
 * The loop, as tools an agent can call.
 *
 * These are the handlers, kept separate from the MCP transport so they can be
 * tested directly rather than over stdio. server.ts is a thin wrapper.
 *
 * Two decisions worth stating.
 *
 * First, `outcome_settle` does not take a verdict from the caller. An agent that
 * could assert "the work is done" and have money move on its word would be the
 * thing this project exists to replace. The tool takes a transaction hash, reads
 * the receipt itself, and decides. The agent supplies evidence, not conclusions.
 *
 * Second, there is an audit tool at all. KeeperHub records agent actions to an
 * append-only trail and exposes no way for an agent to read it -- both routes
 * are session-cookie only and no MCP tool touches it, so an agent cannot audit
 * itself. Since this service is the thing deciding whether agents get paid, it
 * owes them a readable record of why.
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { JsonRpcProvider, Contract, keccak256, toUtf8Bytes } from "ethers";
import { KeeperHubClient } from "../vendor-kh/client.ts";
import { verifyTransfer } from "./verify.ts";
import { diagnose, worthRescuing } from "./diagnose.ts";
import { settle } from "./settle.ts";

const ESCROW_READ_ABI = [
  "function intents(bytes32) view returns (address payer,address payee,address beneficiary,uint256 amount,uint64 refundableAt,uint8 state)",
  "function isClaimed(bytes32) view returns (bool)",
  "function escrowed() view returns (uint256)",
];
const STATE = ["none", "open", "released", "refunded"] as const;

export type Env = {
  provider: JsonRpcProvider;
  kh: KeeperHubClient;
  escrow: string;
  token: string;
  chainId: number;
};

/**
 * Where the decision record lives.
 *
 * On disk, not in memory. An audit log that empties when the process restarts
 * is not an audit log -- it is a debug buffer, and the first thing anyone asks
 * it is what happened before the crash. Append-only JSON lines: one write per
 * decision, no rewrite path, so a corrupted tail costs one entry rather than
 * the file.
 */
const AUDIT_PATH = process.env.OUTCOME_AUDIT_LOG ?? ".outcome/audit.jsonl";

function readAudit(path: string): AuditEntry[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as AuditEntry];
      } catch {
        // A half-written final line survives a crash mid-append. Skipping it
        // loses one decision; throwing would lose every earlier one.
        return [];
      }
    });
}

/** Append-only record of every decision, newest last. */
export type AuditEntry = {
  at: string;
  tool: string;
  intentId?: string;
  outcome: string;
  detail: string;
};

export function createTools(env: Env, opts: { auditPath?: string | null } = {}) {
  // `null` opts out of persistence, which only the tests do.
  const path = opts.auditPath === undefined ? AUDIT_PATH : opts.auditPath;
  const audit: AuditEntry[] = path ? readAudit(path) : [];

  const log = (e: Omit<AuditEntry, "at">) => {
    const entry: AuditEntry = { at: new Date().toISOString(), ...e };
    audit.push(entry);
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + "\n");
  };

  return {
    audit,

    /**
     * Derive the id for a piece of work. Deliberately a pure function of the
     * work itself: two agents given the same job must produce the same id, or
     * the on-chain duplicate guard has nothing to catch.
     */
    outcome_intent_id(args: { task: string; payee: string }): { intentId: string } {
      return {
        intentId: keccak256(toUtf8Bytes(`${args.task}|${args.payee.toLowerCase()}`)),
      };
    },

    /** Read the current state of an intent. */
    async outcome_get_intent(args: { intentId: string }) {
      const c = new Contract(env.escrow, ESCROW_READ_ABI, env.provider);
      const i = await c.intents(args.intentId);
      return {
        intentId: args.intentId,
        state: STATE[Number(i.state)],
        payer: i.payer,
        payee: i.payee,
        beneficiary: i.beneficiary,
        amount: i.amount.toString(),
        refundableAt: Number(i.refundableAt),
      };
    },

    /**
     * Ask whether a transaction proves the work, without settling anything.
     * Read-only, so an agent can check before committing to a claim.
     */
    async outcome_verify(args: {
      transactionHash: string;
      recipient: string;
      minAmount: string;
    }) {
      const receipt = await env.provider.send("eth_getTransactionReceipt", [
        args.transactionHash,
      ]);
      const v = verifyTransfer(receipt, {
        token: env.token,
        recipient: args.recipient,
        minAmount: BigInt(args.minAmount),
      });
      log({
        tool: "outcome_verify",
        outcome: v.proven ? "proven" : "not_proven",
        detail: v.reason,
      });
      return {
        proven: v.proven,
        reason: v.reason,
        observed: v.observed.toString(),
        proof: v.proof,
        logCount: receipt?.logs?.length ?? 0,
      };
    },

    /**
     * Settle an intent from evidence.
     *
     * The caller passes a transaction hash, never a verdict. This tool reads the
     * receipt and decides; an agent cannot assert its way to a payout.
     */
    async outcome_settle(args: { intentId: string; workTransactionHash: string }) {
      const state = await this.outcome_get_intent({ intentId: args.intentId });
      if (state.state !== "open") {
        log({
          tool: "outcome_settle",
          intentId: args.intentId,
          outcome: "refused",
          detail: `intent is ${state.state}, not open`,
        });
        return { settled: false, reason: `intent is ${state.state}, not open` };
      }

      /*
       * Verified against the beneficiary, not the payee. The payee is who gets
       * paid; the beneficiary is who the work had to reach. Checking the payee
       * would only ever prove an agent paid itself, which is not a job anyone
       * posts -- and it is what the first live agent run actually did before
       * the contract recorded the distinction.
       */
      const v = await this.outcome_verify({
        transactionHash: args.workTransactionHash,
        recipient: state.beneficiary,
        minAmount: state.amount,
      });

      const res = await settle(env.kh, {
        escrow: env.escrow,
        chainId: env.chainId,
        intentId: args.intentId,
        verdict: {
          proven: v.proven,
          reason: v.reason,
          observed: BigInt(v.observed),
          proof: v.proof,
        },
      });

      log({
        tool: "outcome_settle",
        intentId: args.intentId,
        outcome: `${res.action}:${res.outcome}`,
        detail: res.error ? `${res.error.kind}: ${res.error.message}` : v.reason,
      });

      return {
        settled: res.outcome === "succeeded",
        action: res.action,
        proven: v.proven,
        reason: v.reason,
        transactionHash: res.transactionHash,
        error: res.error,
      };
    },

    /**
     * Explain a failure and say whether resending can fix it.
     *
     * Separate from settle on purpose: an agent should be able to ask "is this
     * worth another attempt?" without that question moving money.
     */
    outcome_diagnose(args: { reason?: string; status?: string }) {
      const d = diagnose({ reason: args.reason, status: args.status });
      log({
        tool: "outcome_diagnose",
        outcome: d.cause,
        detail: d.correction,
      });
      return { ...d, worthRescuing: worthRescuing(d) };
    },

    /**
     * Read the decision record.
     *
     * KeeperHub writes agent actions to an append-only trail and gives agents no
     * way to read it -- both read routes are session-only and no MCP tool
     * exposes it. A service that decides whether an agent gets paid owes it an
     * account of why.
     */
    outcome_audit(args: { limit?: number } = {}) {
      const limit = Math.min(args.limit ?? 20, 200);
      return { entries: audit.slice(-limit), total: audit.length };
    },
  };
}

export type Tools = ReturnType<typeof createTools>;
