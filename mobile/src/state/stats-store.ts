// Reading stats and the focus timer. Stats persist in the local key-value store; nothing leaves the device.
import { create } from 'zustand';
import { addReading, emptyStats, type DayStats, type ReadingStats } from '../stats/reading-stats';
import { getRepo } from './repo';

export interface FocusSession {
  durationMs: number;
  startedAt: number;
  /** time spent paused so far (excluding a pause in progress) */
  pausedMs: number;
  pausedAt: number | null;
  pages: number;
  /** reading position (0..1) of the book when the session started */
  startFraction: number;
  bookId: string;
}

export function focusElapsed(f: FocusSession, now: number): number {
  return Math.max(0, (f.pausedAt ?? now) - f.startedAt - f.pausedMs);
}

interface StatsState {
  stats: ReadingStats;
  loaded: boolean;
  focus: FocusSession | null;
  load(): Promise<void>;
  add(ms: number, pages: number): void;
  startFocus(minutes: number, bookId: string, fraction: number): void;
  pauseFocus(): void;
  resumeFocus(): void;
  endFocus(): FocusSession | null;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    // never write before the stored history is merged in - it would be overwritten; load() saves once it is
    const { loaded, stats } = useStats.getState();
    if (!loaded) return;
    getRepo().then((r) => r.setKV('readingStats', JSON.stringify(stats))).catch(() => { /* non-fatal */ });
  }, 1000);
}

/** Stored stats, keeping only well-formed days. */
function parseStats(raw: string | null | undefined): ReadingStats {
  const parsed = raw ? (JSON.parse(raw) as Partial<ReadingStats> | null) : null;
  const days: Record<string, DayStats> = {};
  if (parsed && parsed.days && typeof parsed.days === 'object') {
    for (const [k, v] of Object.entries(parsed.days)) {
      if (v && Number.isFinite(v.ms) && Number.isFinite(v.pages)) days[k] = { ms: v.ms, pages: v.pages };
    }
  }
  return { days };
}

// one load for the whole app: a second concurrent one would merge the pre-load stats in twice
let loading: Promise<void> | null = null;

export const useStats = create<StatsState>((set, get) => ({
  stats: emptyStats(),
  loaded: false,
  focus: null,
  load() {
    loading ??= (async () => {
      try {
        let s = parseStats(await (await getRepo()).getKV('readingStats'));
        // merge with anything recorded before loading finished
        const early = Object.entries(get().stats.days);
        for (const [k, v] of early) {
          const cur = s.days[k] ?? { ms: 0, pages: 0 };
          s = { days: { ...s.days, [k]: { ms: cur.ms + v.ms, pages: cur.pages + v.pages } } };
        }
        set({ stats: s, loaded: true });
        if (early.length) persist();
      } catch {
        set({ loaded: true });
      }
    })();
    return loading;
  },
  add(ms, pages) {
    const next = addReading(get().stats, ms, pages, new Date());
    const f = get().focus;
    set({ stats: next, focus: f && pages && !f.pausedAt ? { ...f, pages: f.pages + pages } : f });
    persist();
  },
  startFocus(minutes, bookId, fraction) {
    set({ focus: { durationMs: minutes * 60_000, startedAt: Date.now(), pausedMs: 0, pausedAt: null, pages: 0, startFraction: fraction, bookId } });
  },
  pauseFocus() {
    const f = get().focus;
    if (f && !f.pausedAt) set({ focus: { ...f, pausedAt: Date.now() } });
  },
  resumeFocus() {
    const f = get().focus;
    if (f && f.pausedAt) set({ focus: { ...f, pausedMs: f.pausedMs + (Date.now() - f.pausedAt), pausedAt: null } });
  },
  endFocus() {
    const f = get().focus;
    set({ focus: null });
    return f;
  },
}));
