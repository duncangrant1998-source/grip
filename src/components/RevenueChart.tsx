import { money } from "@/lib/format";

export type ChartPoint = { label: string; labour: number; parts: number };

/**
 * Stacked bars, labour under parts. Plain SVG rendered on the server, so it needs no
 * charting library and prints cleanly. The figures are in the table beside it, so the
 * chart is a summary of the shape of the period, not the only place a number lives.
 */
export function RevenueChart({
  points, showLabour = true,
}: { points: ChartPoint[]; showLabour?: boolean }) {
  const W = 720, H = 240, L = 52, R = 8, T = 12, B = 34;
  const innerW = W - L - R, innerH = H - T - B;
  const totals = points.map((p) => (showLabour ? p.labour : 0) + p.parts);
  const rawMax = Math.max(1, ...totals);

  // Round the axis up to a tidy number so the gridlines read as money.
  const mag = 10 ** Math.floor(Math.log10(rawMax));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s * 4 >= rawMax) ?? mag * 10;
  const max = step * 4;

  const y = (v: number) => T + innerH - (v / max) * innerH;
  const slot = innerW / Math.max(1, points.length);
  const barW = Math.min(44, slot * 0.7);
  const every = Math.ceil(points.length / 12); // thin the x labels when there are many bars

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" className="w-full"
        aria-label={`Revenue by period, ${points.length} periods`}>
        {[0, 1, 2, 3, 4].map((i) => {
          const v = step * i;
          return (
            <g key={i}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-slate-200" strokeWidth={1} />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
                {money(v).replace(".00", "")}
              </text>
            </g>
          );
        })}

        {points.map((p, i) => {
          const x = L + slot * i + (slot - barW) / 2;
          const labour = showLabour ? p.labour : 0;
          return (
            <g key={p.label}>
              <title>{`${p.label}: ${money(labour + p.parts)}${showLabour ? ` (labour ${money(p.labour)}, parts ${money(p.parts)})` : ""}`}</title>
              {labour > 0 && (
                <rect x={x} y={y(labour)} width={barW} height={y(0) - y(labour)} className="fill-slate-700" rx={2} />
              )}
              {p.parts > 0 && (
                <rect x={x} y={y(labour + p.parts)} width={barW} height={y(labour) - y(labour + p.parts)} className="fill-shop" rx={2} />
              )}
              {i % every === 0 && (
                <text x={x + barW / 2} y={H - 12} textAnchor="middle" className="fill-slate-500 text-[11px]">{p.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex gap-4 text-xs text-steel">
        {showLabour && <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-slate-700" /> Labour</span>}
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-shop" /> Parts</span>
      </figcaption>
    </figure>
  );
}
