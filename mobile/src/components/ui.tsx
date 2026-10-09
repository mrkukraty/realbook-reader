import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { THEMES, type Theme } from '../settings/themes';
import { useSettings } from '../state/settings-store';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** App chrome palette derived from the reading theme so the whole app feels like one object. */
export function useAppTheme(): Theme & { card: string; border: string } {
  const theme = THEMES[useSettings((s) => s.settings.theme)];
  return {
    ...theme,
    card: theme.dark ? '#2a2724' : '#fffaf0',
    border: theme.dark ? 'rgba(255,255,255,0.12)' : 'rgba(60,40,20,0.15)',
  };
}

export function Btn({ title, onPress, icon, kind = 'primary', disabled, style, accessibilityLabel }: {
  title: string; onPress(): void; icon?: IconName; kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  const t = useAppTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'danger' ? '#a3312a' : kind === 'secondary' ? t.card : 'transparent';
  const fg = kind === 'primary' || kind === 'danger' ? (t.dark && kind === 'primary' ? '#1b1a18' : '#fff') : t.chromeText;
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title} accessibilityState={{ disabled }}
      onPress={onPress} disabled={disabled}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg, borderColor: t.border, opacity: disabled ? 0.45 : pressed ? 0.75 : 1, borderWidth: kind === 'secondary' ? 1 : 0 }, style]}
    >
      {icon ? <Ionicons name={icon} size={18} color={fg} style={{ marginRight: title ? 6 : 0 }} /> : null}
      {title ? <Text style={[styles.btnText, { color: fg }]}>{title}</Text> : null}
    </Pressable>
  );
}

export function IconBtn({ icon, onPress, label, color, size = 22, active, style }: {
  icon: IconName; onPress(): void; label: string; color?: string; size?: number; active?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const t = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} hitSlop={8} onPress={onPress}
      style={({ pressed }) => [{ padding: 8, borderRadius: 20, opacity: pressed ? 0.6 : 1, backgroundColor: active ? t.border : 'transparent' }, style]}
    >
      <Ionicons name={icon} size={size} color={color ?? t.chromeText} />
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, onLongPress, icon }: { label: string; selected?: boolean; onPress(): void; onLongPress?(): void; icon?: IconName }) {
  const t = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} onLongPress={onLongPress}
      style={[styles.chip, { borderColor: selected ? t.accent : t.border, backgroundColor: selected ? t.accent : t.card }]}
    >
      {icon ? <Ionicons name={icon} size={14} color={selected ? (t.dark ? '#1b1a18' : '#fff') : t.chromeText} style={{ marginRight: 4 }} /> : null}
      <Text style={{ color: selected ? (t.dark ? '#1b1a18' : '#fff') : t.chromeText, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange(v: T): void }) {
  const t = useAppTheme();
  return (
    <View style={[styles.seg, { borderColor: t.border, backgroundColor: t.card }]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="radio" accessibilityState={{ selected: sel }} onPress={() => onChange(o.value)}
            style={[styles.segItem, sel && { backgroundColor: t.accent }]}>
            <Text style={{ color: sel ? (t.dark ? '#1b1a18' : '#fff') : t.chromeText, fontSize: 13, textAlign: 'center' }} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number; format?(v: number): string; onChange(v: number): void;
}) {
  const t = useAppTheme();
  const set = (v: number) => onChange(Math.round(Math.min(max, Math.max(min, v)) * 100) / 100);
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: t.chromeText }]}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <IconBtn icon="remove" label={`Decrease ${label}`} onPress={() => set(value - step)} />
        <Text style={{ color: t.chromeText, minWidth: 56, textAlign: 'center', fontVariant: ['tabular-nums'] }} accessibilityLabel={`${label} ${format ? format(value) : value}`}>{format ? format(value) : value}</Text>
        <IconBtn icon="add" label={`Increase ${label}`} onPress={() => set(value + step)} />
      </View>
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const t = useAppTheme();
  return <Text style={{ color: t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 22, marginBottom: 8 }}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useAppTheme();
  return <View style={[{ backgroundColor: t.card, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: t.border, padding: 12 }, style]}>{children}</View>;
}

export function Label({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useAppTheme();
  return <Text style={[{ color: t.chromeText, fontSize: 15 }, style]}>{children}</Text>;
}

/** Cross-platform text prompt (Alert.prompt is iOS-only). */
export function PromptModal({ visible, title, message, initial, placeholder, confirmLabel = 'Save', onCancel, onSubmit, multiline }: {
  visible: boolean; title: string; message?: string; initial?: string; placeholder?: string; confirmLabel?: string;
  onCancel(): void; onSubmit(v: string): void; multiline?: boolean;
}) {
  const t = useAppTheme();
  const [v, setV] = useState(initial ?? '');
  useEffect(() => { if (visible) setV(initial ?? ''); }, [visible, initial]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={[styles.dialog, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={{ color: t.chromeText, fontSize: 17, fontWeight: '600', marginBottom: 6 }}>{title}</Text>
          {message ? <Text style={{ color: t.muted, marginBottom: 10 }}>{message}</Text> : null}
          <TextInput
            value={v} onChangeText={setV} placeholder={placeholder} placeholderTextColor={t.muted} autoFocus multiline={multiline}
            style={[styles.input, { color: t.chromeText, borderColor: t.border, minHeight: multiline ? 90 : undefined, textAlignVertical: multiline ? 'top' : 'center' }]}
            onSubmitEditing={multiline ? undefined : () => onSubmit(v)} accessibilityLabel={title}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14, gap: 8 }}>
            <Btn title="Cancel" kind="ghost" onPress={onCancel} />
            <Btn title={confirmLabel} onPress={() => onSubmit(v)} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, minHeight: 44 },
  btnText: { fontSize: 15, fontWeight: '600' },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, marginRight: 8 },
  seg: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  segItem: { flex: 1, paddingVertical: 9, paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  rowLabel: { fontSize: 15, flexShrink: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  dialog: { borderRadius: 14, padding: 18, borderWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 16 },
});
