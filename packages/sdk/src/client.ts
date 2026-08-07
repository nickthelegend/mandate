/**
 * The client an agent, a backend, or a browser holds.
 *
 * Deliberately isomorphic. Nothing in this file touches `node:fs` or a private
 * key, because the read-and-verify half of this protocol is the half that has
 * to be checkable by whoever is being asked to trust it. A buyer who cannot
 * independently verify the receipt is back to taking someone's word, which is
 * the failure this exists to remove -- so verification runs in the browser, and
 * the console in this repo is built on exactly this class rather than a
 * privileged backend route.
 *
 * Signing and settling live behind explicit arguments (`./node` for the agent
 * runtime, a passed-in Signer for claims), so importing this module never drags
 * in a wallet.
 */

import {
  Contract,
  JsonRpcProvider,
  keccak256,
  toUtf8Bytes,
  type Provider,
  type Signer,
  type ContractTransactionResponse,
} from "ethers";

import { verifyTransfer, type Verdict, type Receipt } from "./verify.ts";
import { diagnose, worthRescuing, type Diagnosis } from "./diagnose.ts";

const ESCROW_ABI = [
  "function intents(bytes32) view returns (address payer,address payee,address beneficiary,uint256 amount,uint64 refundableAt,uint8 state)",
  "function isClaimed(bytes32) view returns (bool)",
  "function escrowed() view returns (uint256)",
  "function claim(bytes32 intentId, address payee, address beneficiary, uint256 amount, uint64 refundWindow)",
  "event Claimed(bytes32 indexed intentId, address indexed payer, address indexed payee, address beneficiary, uint256 amount, uint64 refundableAt)",
  "event Released(bytes32 indexed intentId, address indexed payee, uint256 amount, bytes32 proof)",
  "event Refunded(bytes32 indexed intentId, address indexed payer, uint256 amount, string reason)",
];

const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

/** The four states an intent can be in, in the order it can reach them. */
export const INTENT_STATES = ["none", "open", "released", "refunded"] as const;
export type IntentState = (typeof INTENT_STATES)[number];

export type Intent = {
  intentId: string;
  state: IntentState;
  payer: string;
  payee: string;
  /** Who the work had to reach. Verification is against this, never the payee. */
  beneficiary: string;
  /** Base units, as a string -- JSON-safe, and callers that need maths use BigInt. */
  amount: string;
  refundableAt: number;
};

/** An intent plus how it ended, assembled from events. What a dashboard renders. */
export type IntentRecord = Intent & {
  claimTransactionHash: string;
  blockNumber: number;
  /** Present once settled. The verifier's own words on a refund. */
  outcome?: "released" | "refunded";
  outcomeTransactionHash?: string;
  reason?: string;
};

export type OutcomeConfig = {
  /** A Provider, or an RPC URL to build one from. */
  provider: Provider | string;
  /** OutcomeEscrow address. */
  escrow: string;
  /** The ERC-20 every escrow is denominated in. */
  token: string;
  chainId?: number;
};

/**
 * Derive the id for a piece of work.
 *
 * A pure function of the work itself, and that is the whole point: two agents
 * independently told to do the same job derive the same id and collide on
 * chain, instead of both paying for it. This is the half of an idempotency key
 * that a header cannot provide -- a header can be rotated or forgotten, a
 * mapping cannot. Exported standalone so a caller can derive an id with no
 * network, no client, and no key.
 */
export function intentId(task: string, payee: string): string {
  return keccak256(toUtf8Bytes(`${task}|${payee.toLowerCase()}`));
}

export class OutcomeClient {
  readonly provider: Provider;
  readonly escrow: string;
  readonly token: string;
  readonly chainId?: number;

  constructor(cfg: OutcomeConfig) {
    this.provider =
      typeof cfg.provider === "string" ? new JsonRpcProvider(cfg.provider, cfg.chainId) : cfg.provider;
    this.escrow = cfg.escrow;
    this.token = cfg.token;
    this.chainId = cfg.chainId;
  }

  private contract(runner: Provider | Signer = this.provider): Contract {
    return new Contract(this.escrow, ESCROW_ABI, runner);
  }

  /**
   * Fetch a receipt in the raw JSON-RPC shape the verifier reads.
   *
   * Goes through `getTransactionReceipt` rather than a raw `eth_` send so that
   * any ethers Provider works -- including a browser wallet's, which is what
   * lets a buyer check a payment without running an RPC of their own. The
   * fields are then put back into wire form because `verifyTransfer` is
   * deliberately a pure function over a receipt, with no provider to mock, and
   * it is the piece most worth keeping that way.
   */
  private async receipt(transactionHash: string): Promise<Receipt | null> {
    const r = await this.provider.getTransactionReceipt(transactionHash);
    if (!r) return null;
    return {
      status: r.status === null ? undefined : `0x${r.status.toString(16)}`,
      blockNumber: `0x${r.blockNumber.toString(16)}`,
      transactionHash: r.hash,
      logs: r.logs.map((l) => ({
        address: l.address,
        topics: [...l.topics],
        data: l.data,
      })),
    };
  }

  /** @see {@link intentId} -- on the instance for callers holding only a client. */
  intentId(task: string, payee: string): string {
    return intentId(task, payee);
  }

  async getIntent(id: string): Promise<Intent> {
    const i = await this.contract().intents(id);
    return {
      intentId: id,
      state: INTENT_STATES[Number(i.state)],
      payer: i.payer,
      payee: i.payee,
      beneficiary: i.beneficiary,
      amount: i.amount.toString(),
      refundableAt: Number(i.refundableAt),
    };
  }

  /** True once claimed, at any state. The duplicate-work check. */
  async isClaimed(id: string): Promise<boolean> {
    return this.contract().isClaimed(id);
  }

  /** Total currently held across all open intents. */
  async escrowed(): Promise<bigint> {
    return this.contract().escrowed();
  }

  /**
   * Read a transaction and decide whether it moved value.
   *
   * The core call. Takes a hash and returns a verdict; it never takes a verdict.
   * Unreadable evidence resolves to *not proven*, never *proven* -- a false
   * negative costs a retry, a false positive pays for nothing.
   */
  async verify(args: {
    transactionHash: string;
    recipient: string;
    /** Base units. Under-delivery fails. */
    minAmount: bigint | string;
    /** Defaults to the client's token. */
    token?: string;
  }): Promise<Verdict & { logCount: number }> {
    const receipt = await this.receipt(args.transactionHash);

    const v = verifyTransfer(receipt, {
      token: args.token ?? this.token,
      recipient: args.recipient,
      minAmount: BigInt(args.minAmount),
    });
    return { ...v, logCount: receipt?.logs?.length ?? 0 };
  }

  /**
   * Verify a transaction against what an intent actually asked for.
   *
   * Against the beneficiary and the escrowed amount, both read from chain, so
   * the caller cannot move the goalposts by passing a friendlier recipient.
   */
  async verifyIntent(id: string, workTransactionHash: string): Promise<Verdict & { logCount: number }> {
    const intent = await this.getIntent(id);
    return this.verify({
      transactionHash: workTransactionHash,
      recipient: intent.beneficiary,
      minAmount: intent.amount,
    });
  }

  /** Why a failure happened, and whether resending can fix it. Pure, no network. */
  diagnose(input: { reason?: string; status?: string }): Diagnosis & { worthRescuing: boolean } {
    const d = diagnose(input);
    return { ...d, worthRescuing: worthRescuing(d) };
  }

  /** Current allowance from `owner` to the escrow, in base units. */
  async allowance(owner: string): Promise<bigint> {
    return new Contract(this.token, ERC20_ABI, this.provider).allowance(owner, this.escrow);
  }

  /**
   * Approve the escrow to pull `amount`.
   *
   * Separate from `claim` rather than folded into it, because a claim that
   * silently sends two transactions is a claim whose gas cost lies. Callers hit
   * the missing-allowance revert once and then know.
   */
  async approve(signer: Signer, amount: bigint | string): Promise<ContractTransactionResponse> {
    return new Contract(this.token, ERC20_ABI, signer).approve(this.escrow, BigInt(amount));
  }

  /**
   * Claim an intent and fund it.
   *
   * `beneficiary` defaults to the payee for the simple case where the payee is
   * also the recipient. Pass it explicitly when the payee is a courier earning
   * a fee -- otherwise verification can only ever prove the payee paid itself.
   */
  async claim(
    signer: Signer,
    args: {
      intentId: string;
      payee: string;
      beneficiary?: string;
      amount: bigint | string;
      /** Seconds until the payer may self-refund an unruled intent. */
      refundWindow: number;
    }
  ): Promise<ContractTransactionResponse> {
    return this.contract(signer).claim(
      args.intentId,
      args.payee,
      args.beneficiary ?? args.payee,
      BigInt(args.amount),
      args.refundWindow
    );
  }

  /**
   * Every intent this escrow has seen, newest first, with how it ended.
   *
   * Assembled from events rather than a database on purpose: a dashboard for a
   * project about verification should be checkable against the chain by anyone
   * reading it, not trusted because a server said so.
   *
   * One `eth_getLogs` with the three topics OR'd together, rather than three
   * calls in parallel. That is not a micro-optimisation. Three simultaneous
   * log queries is a burst, public RPCs throttle bursts, and a throttled
   * request does not fail -- it hangs, with no timeout, forever. The deployed
   * dashboard sat on "reading the chain…" permanently because the third query
   * never came back while the first two returned fine.
   */
  async listIntents(opts: { fromBlock?: number; toBlock?: number } = {}): Promise<IntentRecord[]> {
    const iface = this.contract().interface;
    const head = opts.toBlock ?? (await this.provider.getBlockNumber());
    const from = opts.fromBlock ?? Math.max(0, head - 45_000);

    const logs = await this.provider.getLogs({
      address: this.escrow,
      topics: [["Claimed", "Released", "Refunded"].map((n) => iface.getEvent(n)!.topicHash)],
      fromBlock: from,
      toBlock: head,
    });

    type Ending = { outcome: "released" | "refunded"; hash: string; reason?: string };
    const endings = new Map<string, Ending>();
    const claims: IntentRecord[] = [];

    for (const log of logs) {
      const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
      // A log this ABI cannot read is not ours to interpret.
      if (!parsed) continue;
      const a = parsed.args;

      if (parsed.name === "Claimed") {
        claims.push({
          intentId: a.intentId as string,
          state: "open",
          payer: a.payer as string,
          payee: a.payee as string,
          beneficiary: a.beneficiary as string,
          amount: (a.amount as bigint).toString(),
          refundableAt: Number(a.refundableAt),
          claimTransactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
        });
      } else if (parsed.name === "Released") {
        endings.set(a.intentId as string, {
          outcome: "released",
          hash: log.transactionHash,
          reason: "transfer verified on chain",
        });
      } else {
        endings.set(a.intentId as string, {
          outcome: "refunded",
          hash: log.transactionHash,
          reason: a.reason as string,
        });
      }
    }

    return claims
      .map((row) => {
        const end = endings.get(row.intentId);
        if (!end) return row;
        return {
          ...row,
          state: end.outcome as IntentState,
          outcome: end.outcome,
          outcomeTransactionHash: end.hash,
          reason: end.reason,
        };
      })
      .sort((x, y) => y.blockNumber - x.blockNumber);
  }
}