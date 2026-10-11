import React from 'react';
import { Platform, Pressable, Switch, Text, View } from 'react-native';
import { useSettings } from '../state/settings-store';
import { Segmented, Stepper, useAppTheme, styles } from './ui';
import { FONT_GROUPS, FONT_STACKS, THEMES, THEME_ORDER } from '../settings/themes';
import { LIMITS, type FontFamilyId, type Settings } from '../settings/types';

export function ThemePicker({ value, onChange }: { value: Settings['theme']; onChange(v: Settings['theme']): void }) {
  const t = useAppTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {THEME_ORDER.map((id) => {
        const th = THEMES[id];
        const sel = id === value;
        return (
          <Pressable key={id} onPress={() => onChange(id)} accessibilityRole="radio" accessibilityState={{ selected: sel }} accessibilityLabel={th.label}
            style={{ width: 100, borderRadius: 10, borderWidth: sel ? 2 : 1, borderColor: sel ? t.accent : t.border, overflow: 'hidden' }}>
            <View style={{ backgroundColor: th.page, padding: 10, height: 56, justifyContent: 'center' }}>
              <Text style={{ color: th.text, fontFamily: 'serif', fontSize: 16 }}>Aa</Text>
            </View>
            <Text style={{ color: t.chromeText, fontSize: 11, padding: 6, backgroundColor: t.card }} numberOfLines={1}>{th.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Screen comfort: dimmer, warm light, keep awake. */
export function ComfortControls() {
  const t = useAppTheme();
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  return (
    <>
      <Stepper label="Dim page" value={s.dim} min={LIMITS.dim[0]} max={LIMITS.dim[1]} step={0.1} format={(v) => (v < 0.05 ? 'Off' : `${Math.round(v * 100)}%`)} onChange={(v) => update({ dim: Math.round(v * 10) / 10 })} />
      <Stepper label="Warm light" value={s.warmth} min={LIMITS.warmth[0]} max={LIMITS.warmth[1]} step={0.1} format={(v) => (v < 0.05 ? 'Off' : `${Math.round(v * 100)}%`)} onChange={(v) => update({ warmth: Math.round(v * 10) / 10 })} />
      <View style={styles.row}>
        <Text style={{ color: t.chromeText }}>Keep screen awake while reading</Text>
        <Switch value={s.keepAwake} onValueChange={(v) => update({ keepAwake: v })} accessibilityLabel="Keep screen awake while reading" />
      </View>
    </>
  );
}

export function TypographyControls() {
  const t = useAppTheme();
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  return (
    <>
      {FONT_GROUPS.map((g) => (
        <View key={g} style={{ marginBottom: 8 }}>
          <Text style={{ color: t.muted, marginBottom: 6 }}>{g === 'Classic' ? 'Font · Classic' : g}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(Object.keys(FONT_STACKS) as FontFamilyId[]).filter((f) => FONT_STACKS[f].group === g).map((f) => {
              const sel = s.fontFamily === f;
              return (
                <Pressable key={f} onPress={() => update({ fontFamily: f })} accessibilityRole="radio" accessibilityState={{ selected: sel }} accessibilityLabel={FONT_STACKS[f].label}
                  style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: sel ? t.accent : t.border, backgroundColor: sel ? t.border : 'transparent' }}>
                  <Text style={{ color: t.chromeText, fontSize: 16, fontFamily: Platform.select(FONT_STACKS[f].preview) }}>{FONT_STACKS[f].label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      <Stepper label="Font size" value={s.fontSize} min={LIMITS.fontSize[0]} max={LIMITS.fontSize[1]} step={1} format={(v) => `${v}px`} onChange={(v) => update({ fontSize: v })} />
      <Stepper label="Line height" value={s.lineHeight} min={LIMITS.lineHeight[0]} max={LIMITS.lineHeight[1]} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => update({ lineHeight: v })} />
      <Stepper label="Paragraph spacing" value={s.paraSpacing} min={LIMITS.paraSpacing[0]} max={LIMITS.paraSpacing[1]} step={0.1} format={(v) => (v < 0.05 ? 'None' : `${v.toFixed(1)} em`)} onChange={(v) => update({ paraSpacing: Math.round(v * 10) / 10 })} />
      <Stepper label="Margins" value={s.margin} min={LIMITS.margin[0]} max={LIMITS.margin[1]} step={1} format={(v) => `${v}%`} onChange={(v) => update({ margin: v })} />
      <View style={[styles.row, { marginTop: 4 }]}>
        <Text style={{ color: t.chromeText }}>Alignment</Text>
        <View style={{ width: 180 }}>
          <Segmented options={[{ value: 'left', label: 'Left' }, { value: 'justify', label: 'Justified' }]} value={s.align} onChange={(v) => update({ align: v })} />
        </View>
      </View>
    </>
  );
}

