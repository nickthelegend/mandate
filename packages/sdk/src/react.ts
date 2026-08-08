/**
 * outcome-sdk/react -- hooks over the read-and-verify entry.
 *
 * React is an optional peer, and this is a separate entry so that a headless
 * agent importing `outcome-sdk` never resolves it. Deliberately no data-fetching
 * dependency: a payments SDK that forces react-query on a host app is a
 * liability, and the whole surface here is three requests.
 *
 * Every hook is read-only. Nothing in this file can move money -- claiming
 * needs a Signer the caller passes explicitly, and settling is server-side.
 * A UI that could settle from the browser would need a KeeperHub key in the
 * bundle, which is not a trade worth making for a nicer demo.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { OutcomeClient, type Intent, type IntentRecord } from "./client.ts";
import type { Verdict } from "./verify.ts";

const Ctx = createContext<OutcomeClient | null>(null);

export function OutcomeProvider(props: { client: OutcomeClient; children: ReactNode }) {
  return createElement(Ctx.Provider, { value: props.client }, props.children);
}

export function useOutcome(): OutcomeClient {
  const c = useContext(Ctx);
  if (!c) throw new Error("useOutcome must be used inside <OutcomeProvider>");
  return c;
}

/** What every hook here returns. `error` is a message, because that is what a UI renders. */
export type Async<T> = {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  refresh: () => void;
};

/**
 * How long a read may hang before it is reported as a failure.
 *
 * A throttled public RPC does not reject -- it stops answering. Without a
 * deadline the promise never settles, `loading` never clears, and the page sits
 * on a spinner forever with nothing in the console. That is strictly worse than
 * an error, because an error can be retried and a spinner cannot be diagnosed.
 */
const READ_TIMEOUT_MS = 20_000;

/**
 * Run an async read, cancelling stale results and refusing to hang.
 *
 * The staleness guard matters: without it a slow first request can land after a
 * fast second one and overwrite it, so a dashboard shows data for an escrow the
 * user already navigated away from.
 */
function useAsync<T>(run: () => Promise<T>, deps: unknown[]): Async<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    setLoading(true);

    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("the RPC did not answer in time — it may be rate limiting this page")),
        READ_TIMEOUT_MS
      );
    });

    Promise.race([run(), deadline]).then(
      (v) => {
        clearTimeout(timer);
        if (ticket !== latest.current) return;
        setData(v as T);
        setError(undefined);
        setLoading(false);
      },
      (e: unknown) => {
        clearTimeout(timer);
        if (ticket !== latest.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    );

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, refresh: useCallback(() => setNonce((n) => n + 1), []) };
}

/**
 * Every intent this escrow has seen, newest first.
 *
 * @param pollMs Re-read on an interval. Off by default -- a page that silently
 *   polls a public RPC forever is rude to the endpoint and to the tab.
 */
export function useIntents(opts: { fromBlock?: number; pollMs?: number } = {}): Async<IntentRecord[]> {
  const client = useOutcome();
  const state = useAsync(() => client.listIntents({ fromBlock: opts.fromBlock }), [
    client.escrow,
    opts.fromBlock,
  ]);

  useEffect(() => {
    if (!opts.pollMs) return;
    const t = setInterval(state.refresh, opts.pollMs);
    return () => clearInterval(t);
  }, [opts.pollMs, state.refresh]);

  return state;
}

export function useIntent(intentId: string | undefined): Async<Intent> {
  const client = useOutcome();
  return useAsync(
    () => (intentId ? client.getIntent(intentId) : Promise.resolve(undefined as never)),
    [client.escrow, intentId]
  );
}

export function useEscrowed(): Async<bigint> {
  const client = useOutcome();
  return useAsync(() => client.escrowed(), [client.escrow]);
}

/**
 * Verify a transaction on demand.
 *
 * Imperative rather than declarative because verification is an action a person
 * takes -- pasting a hash and asking "did this actually pay anyone?" -- not
 * state that a component subscribes to.
 */
export function useVerify(): {
  verify: (args: {
    transactionHash: string;
    recipient: string;
    minAmount: bigint | string;
    /** Defaults to the client's token. */
    token?: string;
  }) => Promise<void>;
  result: (Verdict & { logCount: number }) | undefined;
  loading: boolean;
  error: string | undefined;
  reset: () => void;
} {
  const client = useOutcome();
  const [result, setResult] = useState<(Verdict & { logCount: number }) | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const verify = useCallback(
    async (args: {
      transactionHash: string;
      recipient: string;
      minAmount: bigint | string;
      token?: string;
    }) => {
      setLoading(true);
      setError(undefined);
      setResult(undefined);
      try {
        setResult(await client.verify(args));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [client]
  );

  const reset = useCallback(() => {
    setResult(undefined);
    setError(undefined);
  }, []);

  return { verify, result, loading, error, reset };
}
