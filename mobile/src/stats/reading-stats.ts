// Reading statistics (pure, unit-tested). Kept per local calendar day; stored only on the device.

export interface DayStats { ms: number; pages: number }
export interface ReadingStats { days: Record<string, DayStats> }

export const emptyStats = (): ReadingStats => ({ days: {} });

/** A day counts towards the streak once you read this long. */
export const STREAK_MIN_MS = 60_000;

export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function addReading(s: ReadingStats, ms: number, pages: number, now: Date): ReadingStats {
  const k = dayKey(now);
  const cur = s.days[k] ?? { ms: 0, pages: 0 };
  return { days: { ...s.days, [k]: { ms: cur.ms + Math.max(0, ms), pages: cur.pages + Math.max(0, pages) } } };
}

export function today(s: ReadingStats, now: Date): DayStats {
  return s.days[dayKey(now)] ?? { ms: 0, pages: 0 };
}

/** Consecutive days with reading, ending today (or yesterday, if you have not read yet today). */
export function streak(s: ReadingStats, now: Date): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const read = (x: Date) => (s.days[dayKey(x)]?.ms ?? 0) >= STREAK_MIN_MS;
  if (!read(d)) d.setDate(d.getDate() - 1);
  let n = 0;
  while (read(d)) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/** The last n days, oldest first, for a small bar chart. */
export function lastDays(s: ReadingStats, n: number, now: Date): { key: string; label: string; ms: number; pages: number }[] {
  const out: { key: string; label: string; ms: number; pages: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const k = dayKey(d);
    out.push({ key: k, label: 'SMTWTFS'[d.getDay()], ms: s.days[k]?.ms ?? 0, pages: s.days[k]?.pages ?? 0 });
  }
  return out;
}

/** Your reading pace over the last two weeks (pages per minute), or null until there is enough data. */
export function pagesPerMinute(s: ReadingStats, now: Date): number | null {
  let ms = 0, pages = 0;
  for (const d of lastDays(s, 14, now)) { ms += d.ms; pages += d.pages; }
  if (ms < 5 * 60_000 || pages < 5) return null;
  return pages / (ms / 60_000);
}

export function formatMinutes(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
