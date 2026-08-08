/**
 * The page header.
 *
 * A navy band naming the surface, with the work below on white. One band, one
 * eyebrow, one title -- the same opening on every route, so nine surfaces read
 * as one product.
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
    <section className="on-navy">
      <div className="shell py-12 sm:py-16">
        <p className="eyebrow"><span className="inline-block size-1.5 rounded-full bg-[var(--lime)]" />{rubric}</p>
        <h1 className="mt-5 max-w-3xl text-[clamp(1.75rem,1.2rem+2vw,2.75rem)] font-bold leading-[1.1] tracking-[-0.03em] text-balance">
          {title}
        </h1>
        {children && (
          <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-[var(--on-navy-2)]">
            {children}
          </p>
        )}
      </div>
    </section>
  );
}
