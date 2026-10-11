// Mini focus timer + reading status. A small chip shows the countdown while reading; the panel starts,
// pauses and ends sessions and shows today's reading, the streak and the last 7 days.
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Btn, useAppTheme } from '../components/ui';
import { focusElapsed, useStats, type FocusSession } from '../state/stats-store';
import { formatMinutes, lastDays, streak, today, type ReadingStats } from '../stats/reading-stats';
import { Sheet } from './panels';

const PRESETS = [10, 15, 25, 45];

export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Re-render every second while a session runs. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now()); // the value from the last time it ran is stale
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** Countdown pill shown over the page while a focus session runs. */
export function FocusChip({ color, background, onPress }: { color: string; background: string; onPress(): void }) {
  const focus = useStats((s) => s.focus);
  const now = useNow(!!focus && !focus.pausedAt);
  if (!focus) return null;
  const left = focus.durationMs - focusElapsed(focus, now);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Focus timer, ${clock(left)} left${focus.pausedAt ? ', paused' : ''}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: background, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, opacity: 0.94 }}>
      <Ionicons name={focus.pausedAt ? 'pause' : 'timer-outline'} size={14} color={color} />
      <Text style={{ color, fontSize: 13, fontVariant: ['tabular-nums'], fontWeight: '600' }}>{clock(left)}</Text>
    </Pressable>
  );
}

export function ReadingStatusCard({ stats }: { stats: ReadingStats }) {
  const t = useAppTheme();
  const now = new Date();
  const td = today(stats, now);
  const st = streak(stats, now);
  const week = lastDays(stats, 7, now);
  const max = Math.max(15 * 60_000, ...week.map((d) => d.ms));
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
        <Stat label="Today" value={formatMinutes(td.ms)} />
        <Stat label="Pages today" value={String(td.pages)} />
        <Stat label="Streak" value={`${st} day${st === 1 ? '' : 's'}`} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 64, gap: 6 }} accessibilityLabel={`Last 7 days: ${week.map((d) => formatMinutes(d.ms)).join(', ')}`}>
        {week.map((d, i) => (
          <View key={d.key} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ width: '70%', height: Math.max(3, (d.ms / max) * 48), borderRadius: 3, backgroundColor: i === week.length - 1 ? t.accent : t.muted, opacity: d.ms ? 1 : 0.3 }} />
            <Text style={{ color: t.muted, fontSize: 10, marginTop: 3 }}>{d.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const t = useAppTheme();
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={{ color: t.chromeText, fontSize: 18, fontWeight: '700' }}>{value}</Text>
      <Text style={{ color: t.muted, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

export function FocusPanel({ visible, onClose, bookId, fraction, timeLeftLabel }: {
  visible: boolean; onClose(): void; bookId: string; fraction: number; timeLeftLabel?: string;
}) {
  const t = useAppTheme();
  const stats = useStats((s) => s.stats);
  const focus = useStats((s) => s.focus);
  const { startFocus, pauseFocus, resumeFocus, endFocus } = useStats.getState();
  const now = useNow(visible && !!focus && !focus.pausedAt);
  return (
    <Sheet visible={visible} title="Focus & reading status" onClose={onClose}>
      <View style={{ padding: 16 }}>
        {focus ? (
          <Running focus={focus} now={now} fraction={focus.bookId === bookId ? fraction : focus.startFraction} onPause={pauseFocus} onResume={resumeFocus} onEnd={() => { endFocus(); }} />
        ) : (
          <>
            <Text style={{ color: t.muted, marginBottom: 8 }}>Start a focus session - the timer stays on the page while you read.</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
              {PRESETS.map((m) => (
                <Pressable key={m} onPress={() => { startFocus(m, bookId, fraction); onClose(); }} accessibilityRole="button" accessibilityLabel={`Start ${m} minute focus session`}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: t.border, backgroundColor: t.card }}>
                  <Text style={{ color: t.chromeText, fontSize: 18, fontWeight: '700' }}>{m}</Text>
                  <Text style={{ color: t.muted, fontSize: 11 }}>min</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
        {timeLeftLabel ? <Text style={{ color: t.muted, marginTop: 10 }}>{timeLeftLabel}</Text> : null}
        <View style={{ height: 1, backgroundColor: t.border, marginVertical: 14 }} />
        <ReadingStatusCard stats={stats} />
      </View>
    </Sheet>
  );
}

function Running({ focus, now, fraction, onPause, onResume, onEnd }: { focus: FocusSession; now: number; fraction: number; onPause(): void; onResume(): void; onEnd(): void }) {
  const t = useAppTheme();
  const el = focusElapsed(focus, now);
  const left = focus.durationMs - el;
  const pct = Math.min(1, el / focus.durationMs);
  const gained = Math.max(0, fraction - focus.startFraction) * 100;
  return (
    <View>
      <Text style={{ color: t.chromeText, fontSize: 44, fontWeight: '300', textAlign: 'center', fontVariant: ['tabular-nums'] }}>{clock(left)}</Text>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: t.border, marginVertical: 10 }}>
        <View style={{ width: `${pct * 100}%`, height: 6, borderRadius: 3, backgroundColor: t.accent }} />
      </View>
      <Text style={{ color: t.muted, textAlign: 'center', marginBottom: 12 }}>
        {`${focus.pages} page${focus.pages === 1 ? '' : 's'} read · +${gained.toFixed(gained < 10 ? 1 : 0)}% of the book${focus.pausedAt ? ' · paused' : ''}`}
      </Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Btn title={focus.pausedAt ? 'Resume' : 'Pause'} icon={focus.pausedAt ? 'play' : 'pause'} kind="secondary" style={{ flex: 1 }} onPress={focus.pausedAt ? onResume : onPause} />
        <Btn title="End" icon="stop" kind="ghost" style={{ flex: 1 }} onPress={onEnd} />
      </View>
    </View>
  );
}
