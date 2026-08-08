/**
 * The running head of a register page.
 *
 * Every interior route opens with the same band of touchstone: the world's dark
 * material states what the page is, and the work itself happens below on
 * sterling where it is easiest to read. That split is what makes nine different
 * routes read as one product without giving a working surface a dark ground it
 * has no use for.
 */

export function PageHead({
  rubric,
  title,
  children,
}: {
  rubric: string;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="plate border-b border-[var(--touchstone-rule)]">
      <div className="shell py-10 sm:py-14">
        <p className="rubric">{rubric}</p>
        <h1 className="mt-4 max-w-3xl text-[clamp(1.875rem,1.2rem+2.4vw,3.25rem)] font-semibold leading-[1.03] tracking-[-0.03em] text-balance">
          {title}
        </h1>
        {children && (
          <p className="mt-5 max-w-[64ch] text-pretty leading-relaxed text-[var(--quiet-inv)]">
            {children}
          </p>
        )}
      </div>
    </section>
  );
}
