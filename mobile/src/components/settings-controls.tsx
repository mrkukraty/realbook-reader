import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSettings } from '../state/settings-store';
import { Segmented, Stepper, useAppTheme, styles } from './ui';
import { FONT_STACKS, THEMES, THEME_ORDER } from '../settings/themes';
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

export function TypographyControls() {
  const t = useAppTheme();
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  return (
    <>
      <Text style={{ color: t.muted, marginBottom: 6 }}>Font</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
        {(Object.keys(FONT_STACKS) as FontFamilyId[]).map((f) => (
          <Pressable key={f} onPress={() => update({ fontFamily: f })} accessibilityRole="radio" accessibilityState={{ selected: s.fontFamily === f }}
            style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: s.fontFamily === f ? t.accent : t.border, backgroundColor: s.fontFamily === f ? t.border : 'transparent' }}>
            <Text style={{ color: t.chromeText, fontFamily: f === 'mono' ? 'monospace' : f === 'sans' || f === 'dyslexic' ? undefined : 'serif' }}>{FONT_STACKS[f].label}</Text>
          </Pressable>
        ))}
      </View>
      <Stepper label="Font size" value={s.fontSize} min={LIMITS.fontSize[0]} max={LIMITS.fontSize[1]} step={1} format={(v) => `${v}px`} onChange={(v) => update({ fontSize: v })} />
      <Stepper label="Line height" value={s.lineHeight} min={LIMITS.lineHeight[0]} max={LIMITS.lineHeight[1]} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => update({ lineHeight: v })} />
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

