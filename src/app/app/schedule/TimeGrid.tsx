import Link from "next/link";
import { formatMinutes } from "@/lib/dates";

export type GridColumn = { key: string; label: string; sub?: string; highlight?: boolean };

export type GridItem = {
  id: string;
  col: string;
  startMin: number;
  endMin: number;
  title: string;
  subtitle?: string;
  detail?: string;
  status: string;
  href: string;
};

const HOUR_PX = 64;
const SLOT_MIN = 30;

const STATUS_STYLE: Record<string, string> = {
  scheduled: "border-slate-300 bg-slate-100 text-slate-800",
  confirmed: "border-blue-300 bg-blue-50 text-blue-900",
  arrived: "border-amber-300 bg-amber-50 text-amber-900",
  in_progress: "border-violet-300 bg-violet-50 text-violet-900",
  completed: "border-emerald-300 bg-emerald-50 text-emerald-900 opacity-70",
};

/**
 * Packs overlapping appointments side by side. Items that overlap in time share
 * a cluster and split its width into lanes; items that do not overlap keep the
 * full column.
 */
function layoutLanes(items: GridItem[]) {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out = new Map<string, { lane: number; lanes: number }>();

  let cluster: { id: string; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    for (const c of cluster) out.set(c.id, { lane: c.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };

  for (const it of sorted) {
    if (cluster.length && it.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= it.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.endMin);
    } else {
      laneEnds[lane] = it.endMin;
    }
    cluster.push({ id: it.id, lane });
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
  return out;
}

export function TimeGrid({
  columns,
  items,
  openHour,
  closeHour,
  slotHref,
  nowMin,
  nowCols,
}: {
  columns: GridColumn[];
  items: GridItem[];
  openHour: number;
  closeHour: number;
  slotHref?: (colKey: string, minute: number) => string;
  /** Minutes since midnight, to draw a "now" line in the columns listed in nowCols. */
  nowMin?: number;
  nowCols?: string[];
}) {
  const startMin = openHour * 60;
  const endMin = closeHour * 60;
  const totalPx = ((endMin - startMin) / 60) * HOUR_PX;
  const hours = Array.from({ length: closeHour - openHour }, (_, i) => openHour + i);
  const slots = Array.from({ length: (endMin - startMin) / SLOT_MIN }, (_, i) => startMin + i * SLOT_MIN);
  const px = (min: number) => ((min - startMin) / 60) * HOUR_PX;

  const byCol = new Map<string, GridItem[]>();
  for (const it of items) {
    if (!byCol.has(it.col)) byCol.set(it.col, []);
    byCol.get(it.col)!.push(it);
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex" style={{ minWidth: 56 + columns.length * 150 }}>
        {/* Hour labels */}
        <div className="w-14 shrink-0 border-r border-slate-100">
          <div className="h-12 border-b border-slate-200" />
          <div className="relative" style={{ height: totalPx }}>
            {hours.map((h) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-steel"
                style={{ top: (h - openHour) * HOUR_PX }}>
                {h > openHour && formatMinutes(h * 60)}
              </div>
            ))}
          </div>
        </div>

        {columns.map((col) => {
          const colItems = byCol.get(col.key) ?? [];
          const lanes = layoutLanes(colItems);
          const showNow = nowMin != null && nowCols?.includes(col.key) && nowMin >= startMin && nowMin <= endMin;

          return (
            <div key={col.key} className="min-w-0 flex-1 border-r border-slate-100 last:border-r-0" style={{ minWidth: 150 }}>
              <div className={`flex h-12 flex-col items-center justify-center border-b border-slate-200 px-2 text-center ${
                col.highlight ? "bg-orange-50" : ""
              }`}>
                <div className="truncate text-sm font-semibold">{col.label}</div>
                {col.sub && <div className="truncate text-[11px] text-steel">{col.sub}</div>}
              </div>

              <div className="relative" style={{ height: totalPx }}>
                {/* Slots: clickable to start a booking at that time */}
                {slots.map((m) => {
                  const whole = m % 60 === 0;
                  const cls = `block ${whole ? "border-t border-slate-200" : "border-t border-dashed border-slate-100"}`;
                  const style = { height: (SLOT_MIN / 60) * HOUR_PX };
                  return slotHref ? (
                    <Link key={m} href={slotHref(col.key, m)} className={`${cls} hover:bg-orange-50/60`} style={style}
                      aria-label={`Book ${col.label} at ${formatMinutes(m)}`} />
                  ) : (
                    <div key={m} className={cls} style={style} />
                  );
                })}

                {colItems.map((it) => {
                  const from = Math.max(it.startMin, startMin);
                  const to = Math.min(it.endMin, endMin);
                  if (to <= from) return null;
                  const { lane, lanes: n } = lanes.get(it.id) ?? { lane: 0, lanes: 1 };
                  const height = Math.max(px(to) - px(from), 20);
                  return (
                    <Link
                      key={it.id}
                      href={it.href}
                      className={`absolute overflow-hidden rounded-md border px-1.5 py-1 text-xs leading-tight shadow-sm transition hover:z-10 hover:shadow-md ${
                        STATUS_STYLE[it.status] ?? STATUS_STYLE.scheduled
                      }`}
                      style={{
                        top: px(from) + 1,
                        height: height - 2,
                        left: `calc(${(lane / n) * 100}% + 2px)`,
                        width: `calc(${100 / n}% - 4px)`,
                      }}
                      title={[it.title, it.subtitle, it.detail].filter(Boolean).join(" · ")}
                    >
                      <div className="truncate font-semibold">{it.title}</div>
                      {height > 34 && <div className="truncate opacity-80">{it.subtitle}</div>}
                      {height > 52 && (
                        <div className="truncate opacity-70">
                          {formatMinutes(it.startMin)}–{formatMinutes(it.endMin)}
                        </div>
                      )}
                      {height > 70 && it.detail && <div className="truncate opacity-70">{it.detail}</div>}
                    </Link>
                  );
                })}

                {showNow && (
                  <div className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-red-500"
                    style={{ top: px(nowMin!) }}>
                    <span className="absolute -left-0.5 -top-1.5 h-2.5 w-2.5 rounded-full bg-red-500" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
