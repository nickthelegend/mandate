/**
 * A tick-arc gauge.
 *
 * Forty marks across a 180° sweep, of which the first `value`% are lit. Reading
 * a proportion off counted ticks is more honest than a filled bar: you can see
 * the resolution the number is actually being reported at.
 */

export function Gauge({
  value,
  color = "#ef4d23",
  showLabels = false,
  min,
  max,
}: {
  value: number;
  color?: string;
  showLabels?: boolean;
  min?: string;
  max?: string;
}) {
  const TICKS = 40;
  const CX = 100;
  const CY = 100;
  const R = 80;

  const active = Math.round((Math.min(100, Math.max(0, value)) / 100) * TICKS);

  /*
   * Rounded, and not for tidiness: an unrounded cos/sin lands on values like
   * 20.000000000000004, which React can serialise differently on the server
   * than in the browser and which then fails hydration on every tick.
   */
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const ticks = Array.from({ length: TICKS }, (_, i) => {
    // Sweep from π to 2π: the left of the arc round to the right.
    const angle = Math.PI + (i / (TICKS - 1)) * Math.PI;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x1: r2(CX + (R - 10) * cos),
      y1: r2(CY + (R - 10) * sin),
      x2: r2(CX + R * cos),
      y2: r2(CY + R * sin),
      lit: i < active,
    };
  });

  return (
    <div className="w-full">
      <svg viewBox="0 0 200 120" className="mx-auto block w-full max-w-[260px]">
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={t.lit ? color : "#d4d4d8"}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        ))}
        <text
          x={CX}
          y={105}
          textAnchor="middle"
          fontSize={22}
          fontWeight={600}
          fill="currentColor"
        >
          {value}%
        </text>
      </svg>

      {showLabels && (
        <div className="flex justify-between px-2 text-[11px] text-neutral-500">
          <span>{min}</span>
          <span>{max}</span>
        </div>
      )}
    </div>
  );
}
