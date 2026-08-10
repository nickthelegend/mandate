import { Navbar } from "@/components/navbar";

/**
 * An interior page's opening frame.
 *
 * The same clipped, rounded panel the home page uses, carrying the same
 * floating navbar — just short instead of full-viewport. That repetition is
 * what makes nine routes read as one product; the work itself happens below the
 * frame, on the page mat, where it has room.
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
    <section className="frame">
      <Navbar />

      <div className="flex flex-col items-center px-4 pb-12 pt-8 text-center sm:pb-16 sm:pt-12">
        <p className="eyebrow">
          <span className="inline-block size-1.5 rounded-full bg-[var(--brand)]" />
          {rubric}
        </p>

        <h1
          className="mt-5 max-w-3xl"
          style={{
            fontSize: "clamp(28px, 5.5vw, 52px)",
            lineHeight: 1.06,
            fontWeight: 500,
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </h1>

        {children && (
          <p
            className="mt-4 max-w-[60ch] text-neutral-700"
            style={{ fontSize: "clamp(13px, 3.5vw, 16px)" }}
          >
            {children}
          </p>
        )}
      </div>
    </section>
  );
}
