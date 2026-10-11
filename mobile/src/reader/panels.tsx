// Reader side panels: contents, bookmarks, highlights & notes, search, typography/theme.
import React from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconBtn, Segmented, styles, useAppTheme } from '../components/ui';
import type { TocItem } from '../formats/types';
import type { Bookmark, Highlight } from '../storage/types';
import { ComfortControls, ThemePicker, TypographyControls } from '../components/settings-controls';
import { useSettings } from '../state/settings-store';

export function Sheet({ visible, title, onClose, children, right }: { visible: boolean; title: string; onClose(): void; children: React.ReactNode; right?: React.ReactNode }) {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} accessibilityLabel="Close panel" />
      <View style={{ maxHeight: '82%', backgroundColor: t.chrome, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: insets.bottom + 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 }}>
          <Text style={{ flex: 1, color: t.chromeText, fontSize: 17, fontWeight: '700' }} accessibilityRole="header">{title}</Text>
          {right}
          <IconBtn icon="close" label="Close" onPress={onClose} />
        </View>
        {children}
      </View>
    </Modal>
  );
}

export function TocPanel({ visible, toc, onClose, onSelect, currentSection }: { visible: boolean; toc: TocItem[]; onClose(): void; onSelect(item: TocItem): void; currentSection?: number }) {
  const t = useAppTheme();
  const flat: { item: TocItem; depth: number }[] = [];
  const walk = (items: TocItem[], depth: number) => items.forEach((i) => { flat.push({ item: i, depth }); if (i.children) walk(i.children, depth + 1); });
  walk(toc, 0);
  return (
    <Sheet visible={visible} title="Contents" onClose={onClose}>
      {flat.length === 0 ? <Text style={{ color: t.muted, padding: 16 }}>This book has no table of contents.</Text> : (
        <FlatList
          data={flat}
          keyExtractor={(_x, i) => String(i)}
          renderItem={({ item: { item, depth } }) => {
            const sec = 'section' in item.target ? item.target.section : undefined;
            const cur = sec !== undefined && sec === currentSection;
            return (
              <Pressable onPress={() => onSelect(item)} accessibilityRole="button" style={{ paddingVertical: 11, paddingLeft: 16 + depth * 16, paddingRight: 16, backgroundColor: cur ? t.border : 'transparent' }}>
                <Text style={{ color: t.chromeText, fontWeight: depth === 0 ? '600' : '400' }}>{item.title}</Text>
                {'page' in item.target ? <Text style={{ color: t.muted, fontSize: 12 }}>{`Page ${item.target.page + 1}`}</Text> : null}
              </Pressable>
            );
          }}
        />
      )}
    </Sheet>
  );
}

export function BookmarksPanel({ visible, bookmarks, onClose, onSelect, onDelete }: { visible: boolean; bookmarks: Bookmark[]; onClose(): void; onSelect(b: Bookmark): void; onDelete(b: Bookmark): void }) {
  const t = useAppTheme();
  return (
    <Sheet visible={visible} title="Bookmarks" onClose={onClose}>
      {bookmarks.length === 0 ? <Text style={{ color: t.muted, padding: 16 }}>No bookmarks yet. Tap the bookmark icon in the top bar to mark the current page.</Text> : (
        <FlatList data={bookmarks} keyExtractor={(b) => b.id} renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 16 }}>
            <Pressable style={{ flex: 1, paddingVertical: 11 }} onPress={() => onSelect(item)} accessibilityRole="button">
              <Text style={{ color: t.chromeText }}>{item.label}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{new Date(item.createdAt).toLocaleString()}</Text>
            </Pressable>
            <IconBtn icon="trash-outline" label={`Delete bookmark ${item.label}`} onPress={() => onDelete(item)} />
          </View>
        )} />
      )}
    </Sheet>
  );
}

const HL_COLORS: Record<Highlight['color'], string> = { yellow: '#f5d33c', green: '#6ec86e', blue: '#5aa0f0', pink: '#f078aa' };
export { HL_COLORS };

export function HighlightsPanel({ visible, highlights, sectionTitle, onClose, onSelect, onEdit, onDelete }: {
  visible: boolean; highlights: Highlight[]; sectionTitle(n: number): string; onClose(): void;
  onSelect(h: Highlight): void; onEdit(h: Highlight): void; onDelete(h: Highlight): void;
}) {
  const t = useAppTheme();
  return (
    <Sheet visible={visible} title="Highlights & notes" onClose={onClose}>
      {highlights.length === 0 ? <Text style={{ color: t.muted, padding: 16 }}>Select text on a page (long-press), then choose a colour to highlight it or add a note.</Text> : (
        <FlatList data={highlights} keyExtractor={(h) => h.id} renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', paddingLeft: 12, alignItems: 'center' }}>
            <View style={{ width: 4, alignSelf: 'stretch', backgroundColor: HL_COLORS[item.color], borderRadius: 2, marginVertical: 8 }} />
            <Pressable style={{ flex: 1, paddingVertical: 10, paddingHorizontal: 10 }} onPress={() => onSelect(item)} accessibilityRole="button">
              <Text style={{ color: t.muted, fontSize: 11 }}>{sectionTitle(item.section)}</Text>
              <Text style={{ color: t.chromeText }} numberOfLines={3}>{item.text}</Text>
              {item.note ? <Text style={{ color: t.accent, marginTop: 3 }} numberOfLines={3}>{`Note: ${item.note}`}</Text> : null}
            </Pressable>
            <IconBtn icon="create-outline" label="Edit note" onPress={() => onEdit(item)} />
            <IconBtn icon="trash-outline" label="Delete highlight" onPress={() => onDelete(item)} />
          </View>
        )} />
      )}
    </Sheet>
  );
}

export interface SearchResultItem { key: string; label: string; snippet: string }

export function SearchPanel({ visible, query, setQuery, onSubmit, results, busy, progressLabel, onClose, onSelect, disabledReason }: {
  visible: boolean; query: string; setQuery(q: string): void; onSubmit(): void; results: SearchResultItem[]; busy: boolean; progressLabel?: string;
  onClose(): void; onSelect(index: number): void; disabledReason?: string;
}) {
  const t = useAppTheme();
  return (
    <Sheet visible={visible} title="Search in book" onClose={onClose}>
      {disabledReason ? <Text style={{ color: t.muted, padding: 16 }}>{disabledReason}</Text> : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 14, borderWidth: 1, borderColor: t.border, borderRadius: 10, paddingHorizontal: 8 }}>
            <TextInput value={query} onChangeText={setQuery} onSubmitEditing={onSubmit} placeholder="Find words (at least 2 letters)" placeholderTextColor={t.muted}
              returnKeyType="search" autoFocus style={{ flex: 1, color: t.chromeText, paddingVertical: 9, fontSize: 16 }} accessibilityLabel="Search text" />
            <IconBtn icon="search" label="Search" onPress={onSubmit} />
          </View>
          {busy ? <View style={{ flexDirection: 'row', padding: 12, alignItems: 'center' }}><ActivityIndicator color={t.accent} /><Text style={{ color: t.muted, marginLeft: 8 }}>{progressLabel ?? 'Searching…'}</Text></View> : null}
          {!busy && results.length === 0 && query.trim().length >= 2 ? <Text style={{ color: t.muted, padding: 16 }}>No matches.</Text> : null}
          <FlatList data={results} keyExtractor={(r) => r.key} keyboardShouldPersistTaps="handled" renderItem={({ item, index }) => (
            <Pressable onPress={() => onSelect(index)} style={{ paddingVertical: 10, paddingHorizontal: 16 }} accessibilityRole="button">
              <Text style={{ color: t.muted, fontSize: 11 }}>{item.label}</Text>
              <Text style={{ color: t.chromeText }} numberOfLines={3}>{item.snippet}</Text>
            </Pressable>
          )} />
        </>
      )}
    </Sheet>
  );
}

export function AppearancePanel({ visible, onClose, reflow, pdf }: { visible: boolean; onClose(): void; reflow: boolean; pdf?: boolean }) {
  const t = useAppTheme();
  const s = useSettings((x) => x.settings);
  const update = useSettings((x) => x.update);
  return (
    <Sheet visible={visible} title="Appearance" onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        {pdf ? (
          <View style={{ marginBottom: 14 }}>
            <View style={styles.row}>
              <Text style={{ color: t.chromeText, fontWeight: '600' }}>Read this PDF as</Text>
              <View style={{ width: 180 }}>
                <Segmented options={[{ value: 'page', label: 'Pages' }, { value: 'text', label: 'Text' }]} value={s.pdfView} onChange={(v) => update({ pdfView: v })} />
              </View>
            </View>
            <Text style={{ color: t.muted, fontSize: 12, lineHeight: 17 }}>
              {s.pdfView === 'text'
                ? 'Text view re-flows the words of each page, so the fonts and sizes below apply. Pictures and complex layouts are only shown in Pages view.'
                : 'Pages view shows the printed page. Switch to Text to choose your own font and text size.'}
            </Text>
          </View>
        ) : null}
        {/* Kindle also brings a Bookerly-like font */}
        <ThemePicker value={s.theme} onChange={(v) => update(v === 'kindle' ? { theme: v, fontFamily: 'charter' } : { theme: v })} />
        {pdf && s.pdfView === 'page' ? (
          <View style={[styles.row, { marginTop: 12 }]}>
            <Text style={{ color: t.chromeText }}>Page colours</Text>
            <View style={{ width: 180 }}>
              <Segmented options={[{ value: 'theme', label: 'Theme' }, { value: 'original', label: 'Original' }]} value={s.pdfColors} onChange={(v) => update({ pdfColors: v })} />
            </View>
          </View>
        ) : null}
        <View style={{ height: 16 }} />
        <Text style={{ color: t.muted, marginBottom: 4 }}>Comfort</Text>
        <ComfortControls />
        <View style={{ height: 16 }} />
        {reflow ? <TypographyControls /> : <Text style={{ color: t.muted, lineHeight: 20 }}>{pdf ? 'Pinch outward on a page to zoom in; drag to move around, and pinch back in (or double-tap) to return to page turning.' : "Comic pages are images, so their font can't be changed. Pinch outward on a page to zoom in; pinch back in (or double-tap) to return to page turning."}</Text>}
      </ScrollView>
    </Sheet>
  );
}
