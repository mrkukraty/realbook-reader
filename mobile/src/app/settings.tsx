import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { useSettings } from '@/state/settings-store';
import { Btn, Card, SectionTitle, Segmented, Stepper, useAppTheme, styles } from '@/components/ui';
import { PERF_PROFILES } from '@/settings/themes';
import { ComfortControls, ThemePicker, TypographyControls } from '@/components/settings-controls';
import { ReadingStatusCard } from '@/reader/FocusTimer';
import { useStats } from '@/state/stats-store';
import { LIMITS, type PerfMode } from '@/settings/types';
import { clearPageCache, storageUsage } from '@/platform/files';
import { formatBytes } from '@/storage/library-logic';
import { useLibrary } from '@/state/library-store';
import { supportedFormats, unsupportedFormats } from '@/formats/registry';

export default function SettingsScreen() {
  const t = useAppTheme();
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  const reset = useSettings((x) => x.reset);
  const reduceMotion = useReducedMotion();
  const books = useLibrary((x) => x.books);
  const stats = useStats((x) => x.stats);
  useFocusEffect(useCallback(() => { void useStats.getState().load(); }, []));
  const [usage, setUsage] = useState(() => ({ books: 0, cache: 0, free: null as number | null, total: null as number | null }));

  useFocusEffect(useCallback(() => { try { setUsage(storageUsage()); } catch { /* ignore */ } }, []));

  return (
    <ScrollView style={{ backgroundColor: t.chrome }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
      <Stack.Screen options={{ title: 'Settings' }} />
      <SectionTitle>Theme</SectionTitle>
      <ThemePicker value={s.theme} onChange={(v) => update({ theme: v })} />

      <SectionTitle>Reading status</SectionTitle>
      <Card><ReadingStatusCard stats={stats} /></Card>

      <SectionTitle>Comfort</SectionTitle>
      <Card><ComfortControls /></Card>

      <SectionTitle>Typography</SectionTitle>
      <Card><TypographyControls /></Card>

      <SectionTitle>Layout</SectionTitle>
      <Card>
        <Text style={{ color: t.muted, marginBottom: 8 }}>Pages per screen (Auto = one page on phones in portrait, two-page spread on tablets and in landscape)</Text>
        <Segmented options={[{ value: 'auto', label: 'Auto' }, { value: 'single', label: 'One page' }, { value: 'double', label: 'Two pages' }]} value={s.layout} onChange={(v) => update({ layout: v })} />
      </Card>

      <SectionTitle>Page turning</SectionTitle>
      <Card>
        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: t.chromeText }]}>Page-turn animation</Text>
          <Switch value={s.animations} onValueChange={(v) => update({ animations: v })} accessibilityLabel="Page-turn animation" />
        </View>
        {reduceMotion ? <Text style={{ color: t.muted, fontSize: 12 }}>Reduce Motion is on in system settings, so pages change without animation.</Text> : null}
        <Stepper label="Animation speed" value={s.animationSpeed} min={LIMITS.animationSpeed[0]} max={LIMITS.animationSpeed[1]} step={0.25} format={(v) => `${v.toFixed(2)}Ã—`} onChange={(v) => update({ animationSpeed: v })} />
        <Stepper label="Shadow strength" value={s.shadowStrength} min={0} max={1} step={0.1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ shadowStrength: v })} />
      </Card>

      <SectionTitle>Performance</SectionTitle>
      <Card>
        <Segmented<PerfMode>
          options={(['lightweight', 'balanced', 'high'] as PerfMode[]).map((m) => ({ value: m, label: PERF_PROFILES[m].label }))}
          value={s.perfMode} onChange={(v) => update({ perfMode: v })}
        />
        <Text style={{ color: t.muted, marginTop: 8 }}>{PERF_PROFILES[s.perfMode].description}</Text>
      </Card>

      <SectionTitle>Storage</SectionTitle>
      <Card>
        <Text style={{ color: t.chromeText }}>{`${books.length} book${books.length === 1 ? '' : 's'} Â· ${formatBytes(usage.books)} stored in the app`}</Text>
        <Text style={{ color: t.chromeText, marginTop: 4 }}>{`Rendered page cache: ${formatBytes(usage.cache)}`}</Text>
        {usage.free !== null ? <Text style={{ color: t.muted, marginTop: 4 }}>{`Free on device: ${formatBytes(usage.free)}${usage.total ? ` of ${formatBytes(usage.total)}` : ''}`}</Text> : null}
        <Text style={{ color: t.muted, marginTop: 6, fontSize: 12 }}>Books, progress, bookmarks and notes are stored on this device. Nothing is uploaded unless you sign in to an account, which copies your books and reading positions to your private space.</Text>
        <Btn title="Clear page cache" kind="secondary" icon="trash-bin-outline" style={{ marginTop: 10 }} onPress={() => {
          Alert.alert('Clear page cache?', 'Deletes rendered PDF pages and extracted comic images. They are re-created when you read. Your books are not affected.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Clear', style: 'destructive', onPress: () => { try { clearPageCache(); setUsage(storageUsage()); } catch (e) { Alert.alert('Could not clear cache', String(e)); } } },
          ]);
        }} />
      </Card>

      <SectionTitle>Formats</SectionTitle>
      <Card>
        {supportedFormats.map((f) => <Text key={f.id} style={{ color: t.chromeText, marginBottom: 4 }}>{`âœ“ ${f.label} (.${f.extensions.join(', .')}) â€” ${f.notes}`}</Text>)}
        {unsupportedFormats.map((f) => <Text key={f.format} style={{ color: t.muted, marginBottom: 4 }}>{`âœ— ${f.label} â€” not supported; convert with Calibre / 7-Zip / DjVuLibre.`}</Text>)}
      </Card>

      <Btn title="Reset all settings" kind="ghost" style={{ marginTop: 20 }} onPress={() => Alert.alert('Reset settings?', 'Theme, typography and animation settings go back to defaults. Books are not affected.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Reset', style: 'destructive', onPress: reset },
      ])} />
    </ScrollView>
  );
}
