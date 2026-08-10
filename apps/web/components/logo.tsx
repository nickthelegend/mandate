/**
 * The Mandate mark.
 *
 * Polaris's own logo grammar is a ring with a break in it and a dot inside, so
 * Mandate stays in that family rather than arriving as a different brand: a
 * ring, drawn in Polaris blue, with a deliberate gap at the top right.
 *
 * What Mandate adds is the check, in the Polaris action colour, and the one
 * detail that carries the product: the check does not sit politely inside the
 * ring, it enters through the gap. The claim is the circle. The proof comes
 * from outside it. That is the entire thesis in a 24px mark.
 *
 * Drawn rather than imported so it inherits colour, scales without a raster,
 * and costs no request.
 */

export function MandateMark({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/*
       * The claim: a ring left open at the top right. The gap is where the
       * unverified assertion is -- the part nobody countersigned.
       */}
      <path
        d="M16 3.2a12.8 12.8 0 1 0 11.35 6.9"
        stroke="var(--brand)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      {/*
       * The proof, entering through the gap. Drawn last so it sits over the
       * ring, and in the action colour because this is the thing that acts.
       */}
      <path
        d="M10.4 16.6l4.3 4.3L28.8 6.9"
        stroke="var(--dark)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mark plus wordmark, set the way Polaris sets its own. */
