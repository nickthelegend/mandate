import { DEPLOYMENT, source } from "@/lib/outcome";

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--rule)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-8 font-mono text-xs text-[var(--quiet)] sm:flex-row sm:items-center sm:justify-between">
        <p>
          Every number on this site is read from {DEPLOYMENT.chainName} in your browser. There is no
          backend.
        </p>
        <a
          href={source(DEPLOYMENT.escrow)}
          target="_blank"
          rel="noopener"
          className="transition-colors hover:text-[var(--ink)]"
        >
          OutcomeEscrow · {DEPLOYMENT.escrow} · verified
        </a>
      </div>
    </footer>
  );
}
