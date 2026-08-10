"use client";

/**
 * Post a job with your own wallet.
 *
 * Everywhere else on this site the server plays the payer. Here you are the
 * payer: you sign the approval and the claim, your tokens go into escrow, and
 * the intent shows up in the explorer under your address.
 *
 * Deliberately built on `window.ethereum` and the SDK's own `claim`, with no
 * wallet library. A payments SDK that only works behind somebody's connect-kit
 * has not shown that its API is usable -- and the whole argument here is that
 * checking and claiming should not require anyone's infrastructure.
 *
 * Note what you cannot do from this page: settle. Releasing funds needs a
 * KeeperHub credential, and the escrow will only accept a verdict from
 * KeeperHub's address. A browser that could release would be a browser holding
 * the key to everyone's escrow.
 */

import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract, type Eip1193Provider } from "ethers";
import { intentId as deriveIntentId } from "outcome-sdk";
import { ArrowRight, Loader2, Wallet2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEPLOYMENT, tx, short } from "@/lib/outcome";
import { PageHead } from "@/components/page-head";

const ESCROW_ABI = [
  "function claim(bytes32,address,address,uint256,uint64)",
  "function isClaimed(bytes32) view returns (bool)",
];
const ERC20 = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

const AMOUNT = 1_000_000n; // 1.00 tUSDC
const REFUND_WINDOW = 3600;
const BENEFICIARY = "0x000000000000000000000000000000000000dEaD";

type Stage = "idle" | "approving" | "claiming" | "done";

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { on?: (e: string, cb: (...a: unknown[]) => void) => void };
  }
}

export default function ClaimPage() {
  const [account, setAccount] = useState<string | null>(null);
  const [task, setTask] = useState("deliver 1.00 tUSDC to treasury");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const [hasWallet, setHasWallet] = useState(true);

  useEffect(() => {
    setHasWallet(typeof window !== "undefined" && Boolean(window.ethereum));
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    try {
      if (!window.ethereum) throw new Error("no browser wallet found");
      const provider = new BrowserProvider(window.ethereum);
      const [addr] = await provider.send("eth_requestAccounts", []);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== DEPLOYMENT.chainId) {
        // Ask rather than assume: switching a user's network without saying so
        // is rude, and the request is refusable.
        await provider.send("wallet_switchEthereumChain", [
          { chainId: `0x${DEPLOYMENT.chainId.toString(16)}` },
        ]);
      }
      setAccount(addr);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  async function postJob() {
    setError(null);
    setClaimTx(null);
    try {
      if (!window.ethereum) throw new Error("no browser wallet found");
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const me = await signer.getAddress();

      const id = deriveIntentId(task, me);

      const escrow = new Contract(DEPLOYMENT.escrow, ESCROW_ABI, signer);
      if (await escrow.isClaimed(id)) {
        throw new Error(
          "that exact task is already claimed by this address - the intent id is derived from the work, so change the task to post a new one"
        );
      }

      const token = new Contract(DEPLOYMENT.token, ERC20, signer);
      if ((await token.balanceOf(me)) < AMOUNT) {
        throw new Error(`you need at least 1.00 ${DEPLOYMENT.tokenSymbol} on ${DEPLOYMENT.chainName}`);
      }

      if ((await token.allowance(me, DEPLOYMENT.escrow)) < AMOUNT) {
        setStage("approving");
        const approve = await token.approve(DEPLOYMENT.escrow, AMOUNT * 10n);
        await approve.wait();
      }

      setStage("claiming");
      const claim = await escrow.claim(id, me, BENEFICIARY, AMOUNT, REFUND_WINDOW);
      await claim.wait();
      setClaimTx(claim.hash);
      setStage("done");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setError(err.shortMessage ?? err.message ?? String(e));
      setStage("idle");
    }
  }

  const busy = stage === "approving" || stage === "claiming";

  return (
    <>
      <PageHead rubric="Your wallet" title="Post a job with your own wallet.">
        Your tokens, your signature, your intent. It goes into the same escrow everything else on
        this site uses, and shows up in the explorer under your address. You can reclaim it after an
        hour if nobody does the work.
      </PageHead>

      <div className="shell py-10 sm:py-14">
      <div className="max-w-3xl">

      {!hasWallet && (
        <p className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-4 text-sm text-[var(--ink-3)]">
          No browser wallet detected. This page needs one — everything else here works without.
        </p>
      )}

      {!account ? (
        <Button size="lg" className="mt-8 gap-2" disabled={!hasWallet} onClick={() => void connect()}>
          <Wallet2 className="size-4" /> Connect a wallet
        </Button>
      ) : (
        <div className="mt-8 space-y-5">
          <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-4 font-mono text-xs">
            <span className="text-[var(--ink-3)]">connected </span>
            {account}
          </div>

          <div className="space-y-2">
            <Label htmlFor="task" className="field-label">
              The work being paid for
            </Label>
            <Input
              id="task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="font-mono text-xs text-[var(--ink-3)]">
              intent id {short(deriveIntentId(task, account), 10, 8)} — derived from the task and
              your address, so the same job posted twice collides on chain instead of paying twice.
            </p>
          </div>

          <Button size="lg" className="gap-2" disabled={busy} onClick={() => void postJob()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {stage === "approving"
              ? "Approving the escrow…"
              : stage === "claiming"
                ? "Escrowing 1.00 tUSDC…"
                : "Escrow 1.00 tUSDC"}
          </Button>
        </div>
      )}

      {error && (
        <p className="mt-6 rounded-[10px] border border-[var(--refused)] bg-transparent p-4 font-mono text-sm text-[var(--refused)]">
          {error}
        </p>
      )}

      {claimTx && (
        <div className="mt-6 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-5">
          <p className="font-mono text-sm font-medium text-[var(--ink)]">
            Escrowed. The payee has not been paid.
          </p>
          <p className="mt-2 text-pretty text-sm leading-relaxed text-[var(--ink-3)]">
            That is the point of the contract: the money is held, not sent. It moves only when
            KeeperHub is handed a receipt proving the work landed — or back to you after the refund
            window if nobody does it.
          </p>
          <div className="mt-4 flex flex-wrap gap-4 font-mono text-xs">
            <a href={tx(claimTx)} target="_blank" rel="noopener" className="underline underline-offset-4 hover:text-[var(--ink)]">
              {short(claimTx, 10, 8)} on Etherscan →
            </a>
            <a href="/outcome/explorer/" className="underline underline-offset-4 hover:text-[var(--ink)]">
              see it in the explorer →
            </a>
          </div>
        </div>
      )}

      <div className="mt-14 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] p-5">
        <h2 className="font-mono text-sm font-medium">What you cannot do here</h2>
        <p className="mt-2 text-pretty text-sm leading-relaxed text-[var(--ink-3)]">
          Release the funds. Settlement needs a KeeperHub credential, and the escrow only accepts a
          verdict from KeeperHub&rsquo;s address — the deployer&rsquo;s own verifier role was
          revoked. A page that could release would be a page holding the key to everyone&rsquo;s
          escrow.
        </p>
      </div>
    </div>
      </div>
    </>
  );
}
