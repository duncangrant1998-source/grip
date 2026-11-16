/**
 * Calendar-date arithmetic on plain "YYYY-MM-DD" strings.
 *
 * Deliberately timezone-free. The shop's timezone is applied in SQL; in the app
 * a date is just a label, so adding a day to "2026-11-09" can never be wrong
 * because of daylight saving or the viewer's own timezone.
 */

const pad = (n: number) => String(n).padStart(2, "0");

export function isDateString(s: string | undefined | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toUtc(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(s: string, n: number): string {
  const d = toUtc(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** The first day of the month containing `s`. */
export function startOfMonth(s: string): string {
  return `${s.slice(0, 7)}-01`;
}

/** The first day of the month `n` months from the one containing `s`. */
export function addMonths(s: string, n: number): string {
  const d = toUtc(startOfMonth(s));
  d.setUTCMonth(d.getUTCMonth() + n);
  return fromUtc(d);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(s: string): number {
  return (toUtc(s).getUTCDay() + 6) % 7;
}

export function startOfWeek(s: string): string {
  return addDays(s, -weekdayIndex(s));
}

export function weekDays(s: string): string[] {
  const start = startOfWeek(s);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

const fmt = (opts: Intl.DateTimeFormatOptions) => (s: string) =>
  new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: "UTC" }).format(toUtc(s));

export const formatLong = fmt({ weekday: "long", month: "long", day: "numeric", year: "numeric" });
export const formatShort = fmt({ weekday: "short", month: "short", day: "numeric" });
export const formatDayName = fmt({ weekday: "short" });
export const formatMonthDay = fmt({ month: "short", day: "numeric" });

/** 540 -> "9:00 AM" */
export function formatMinutes(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${pad(m)} ${suffix}`;
}

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** 540 -> "09:00" for <input type="time">. */
export function toTimeInput(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

export const formatMonthYear = fmt({ month: "long", year: "numeric" });
