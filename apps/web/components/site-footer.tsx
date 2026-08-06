import { DEPLOYMENT, address } from "@/lib/outcome";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-8 font-mono text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          Every number on this site is read from {DEPLOYMENT.chainName} in your browser. There is no
          backend.
        </p>
        <a
          href={address(DEPLOYMENT.escrow)}
          target="_blank"
          rel="noopener"
          className="transition-colors hover:text-foreground"
        >
          OutcomeEscrow · {DEPLOYMENT.escrow}
        </a>
      </div>
    </footer>
  );
}
